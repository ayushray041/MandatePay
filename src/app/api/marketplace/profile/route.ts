import { adminFirestore } from '@/lib/firebase/admin';
import { authenticateRequest } from '@/lib/api/auth';
import { apiError, apiSuccess } from '@/lib/api/responses';
import { getServerTimestamp } from '@/lib/firebase/firestore';
import { timestampToIso } from '@/lib/mandates/format';
import { ensureAgentRecord } from '@/lib/agents/store';
import { writeAgentActivity } from '@/lib/agents/audit';
import {
  canViewMarketplaceDirectory,
  ensureMarketplaceAgentProfile,
  ensureMarketplaceViewer,
  parseMarketplaceDirectorySettings,
} from '@/lib/marketplace/store';
import { marketplaceDirectorySettingsSchema } from '@/models/marketplace';

export async function GET(request: Request) {
  const authentication = await authenticateRequest(request);
  if (!authentication.authenticated) {
    return authentication.response;
  }
  if (!adminFirestore) {
    return apiError(503, 'SERVICE_UNAVAILABLE', 'Marketplace storage is unavailable.');
  }
  try {
    const agent = await ensureAgentRecord(authentication.user.uid);
    if (!agent) {
      return apiError(404, 'AGENT_NOT_REGISTERED', 'Register an agent before publishing marketplace services.');
    }
    const profile = await ensureMarketplaceAgentProfile(
      adminFirestore,
      authentication.user.uid,
      agent.agentId,
    );
    return apiSuccess({
      agentId: agent.agentId,
      directorySettings: profile.directorySettings,
      verificationStatus: profile.verificationStatus,
      verificationReason: profile.verificationReason ?? null,
      version: profile.version,
      updatedAt: timestampToIso(profile.updatedAt),
    });
  } catch (error: unknown) {
    console.error('Failed to load marketplace profile settings.', error);
    return apiError(500, 'INTERNAL_ERROR', 'Marketplace profile settings could not be loaded.');
  }
}

export async function PATCH(request: Request) {
  const authentication = await authenticateRequest(request);
  if (!authentication.authenticated) {
    return authentication.response;
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, 'INVALID_JSON', 'Marketplace profile settings must be valid JSON.');
  }
  const parsed = marketplaceDirectorySettingsSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, 'INVALID_ARGUMENT', 'Marketplace directory settings are invalid.');
  }
  if (!adminFirestore) {
    return apiError(503, 'SERVICE_UNAVAILABLE', 'Marketplace storage is unavailable.');
  }

  const firestore = adminFirestore;
  const ownerUid = authentication.user.uid;
  try {
    const agent = await ensureAgentRecord(ownerUid);
    if (!agent) {
      return apiError(404, 'AGENT_NOT_REGISTERED', 'Register an agent before changing marketplace settings.');
    }
    const currentProfile = await ensureMarketplaceAgentProfile(firestore, ownerUid, agent.agentId);
    if (parsed.data.visibility === 'private') {
      const identities = await Promise.all(parsed.data.allowlistedAgentIds.map(async (agentId) => (
        firestore.collection('agentIdentities').doc(agentId).get()
      )));
      if (identities.some((identity) => !identity.exists)) {
        return apiError(400, 'INVALID_ALLOWLIST', 'Every allowlisted ID must identify a registered agent.');
      }
    }

    const profileRef = firestore.collection('agentMarketplaceProfiles').doc(agent.agentId);
    const listingsQuery = firestore.collection('agentServiceListings')
      .where('ownerUid', '==', ownerUid)
      .limit(50);
    const organizationMemberRef = parsed.data.visibility === 'organization'
      ? firestore.collection('marketplaceOrganizations')
        .doc(parsed.data.organizationId)
        .collection('members')
        .doc(ownerUid)
      : null;
    const updated = await firestore.runTransaction(async (transaction) => {
      const [profileSnapshot, listingSnapshots, organizationMembership] = await Promise.all([
        transaction.get(profileRef),
        transaction.get(listingsQuery),
        organizationMemberRef ? transaction.get(organizationMemberRef) : Promise.resolve(null),
      ]);
      if (organizationMemberRef && !organizationMembership?.exists) {
        return { error: 'organization_membership_required' as const };
      }
      const storedProfile = profileSnapshot.data();
      if (
        !profileSnapshot.exists
        || !storedProfile
        || storedProfile.ownerId !== ownerUid
        || storedProfile.agentId !== agent.agentId
      ) {
        throw new Error('Marketplace profile ownership changed.');
      }
      const validExistingSettings = parseMarketplaceDirectorySettings(storedProfile.directorySettings);
      if (!validExistingSettings) {
        throw new Error('Stored marketplace directory settings are invalid.');
      }

      const now = getServerTimestamp();
      for (const listingSnapshot of listingSnapshots.docs) {
        const listing = listingSnapshot.data();
        if (listing.agentId !== agent.agentId) {
          continue;
        }
        const version = Number(listing.version);
        if (!Number.isSafeInteger(version) || version < 1) {
          throw new Error('Stored service listing version is invalid.');
        }
        const nextVersion = version + 1;
        const snapshot = {
          ...listing,
          visibility: parsed.data.visibility,
          organizationId: parsed.data.visibility === 'organization'
            ? parsed.data.organizationId
            : null,
          version: nextVersion,
          updatedAt: now,
        };
        const versionRef = listingSnapshot.ref.collection('versions')
          .doc(String(nextVersion).padStart(6, '0'));
        transaction.create(versionRef, {
          version: nextVersion,
          createdBy: ownerUid,
          createdAt: now,
          snapshot,
        });
        transaction.update(listingSnapshot.ref, {
          visibility: snapshot.visibility,
          organizationId: snapshot.organizationId,
          version: nextVersion,
          updatedAt: now,
        });
      }
      const profileVersion = Number(storedProfile.version);
      if (!Number.isSafeInteger(profileVersion) || profileVersion < 1) {
        throw new Error('Stored marketplace profile version is invalid.');
      }
      transaction.update(profileRef, {
        directorySettings: parsed.data,
        version: profileVersion + 1,
        updatedAt: now,
      });
      writeAgentActivity(firestore, transaction, {
        ownerId: ownerUid,
        agentId: agent.agentId,
        actorId: ownerUid,
        action: 'marketplace.directory.updated',
        details: { visibility: parsed.data.visibility },
      });
      return { version: profileVersion + 1, updatedAt: now };
    });
    if ('error' in updated) {
      return apiError(403, 'ORGANIZATION_MEMBERSHIP_REQUIRED', 'Join the organization before publishing its directory.');
    }
    const viewer = await ensureMarketplaceViewer(firestore, ownerUid);
    const directoryAccess = canViewMarketplaceDirectory(parsed.data, ownerUid, viewer);
    return apiSuccess({
      agentId: agent.agentId,
      directorySettings: parsed.data,
      verificationStatus: currentProfile.verificationStatus ?? 'unverified',
      verificationReason: currentProfile.verificationReason ?? null,
      version: updated.version,
      directoryAccessibleToOwner: directoryAccess,
      updatedAt: timestampToIso(updated.updatedAt),
    });
  } catch (error: unknown) {
    console.error('Failed to update marketplace directory settings.', error);
    return apiError(500, 'INTERNAL_ERROR', 'Marketplace directory settings could not be updated.');
  }
}

import 'server-only';
import type { Firestore } from 'firebase-admin/firestore';
import { getServerTimestamp } from '@/lib/firebase/firestore';
import { timestampToIso } from '@/lib/mandates/format';
import {
  agentCapabilityDocumentSchema,
  marketplaceServiceListingSchema,
  type AgentCapabilityDocument,
  type MarketplaceDirectorySettings,
  type MarketplaceListingSearch,
  type MarketplaceServiceListing,
} from '@/models/marketplace';

type StoredData = Record<string, unknown>;

export type MarketplaceViewer = {
  uid: string;
  agentId: string | null;
  organizationIds: Set<string>;
  allowlistedAgentIds: Set<string>;
  blocklistedAgentIds: Set<string>;
};

const directorySettingsDefaults: MarketplaceDirectorySettings = {
  visibility: 'public',
};

function isRecord(value: unknown): value is StoredData {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeCount(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function priceRange(pricing: unknown): { minimum: number | null; maximum: number | null; currency: string | null } {
  if (!isRecord(pricing) || typeof pricing.model !== 'string') {
    return { minimum: null, maximum: null, currency: null };
  }
  if (
    pricing.model === 'fixed'
    || pricing.model === 'hourly'
    || pricing.model === 'from'
  ) {
    const amount = safeCount(pricing.amountMinor);
    return {
      minimum: amount,
      maximum: pricing.model === 'from' ? null : amount,
      currency: typeof pricing.currency === 'string' ? pricing.currency : null,
    };
  }
  if (pricing.model === 'dynamic') {
    return {
      minimum: safeCount(pricing.minimumMinor),
      maximum: safeCount(pricing.maximumMinor),
      currency: typeof pricing.currency === 'string' ? pricing.currency : null,
    };
  }
  return {
    minimum: null,
    maximum: null,
    currency: typeof pricing.currency === 'string' ? pricing.currency : null,
  };
}

function normalizeSearchText(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function dataForSearch(listing: StoredData, agent: StoredData): string {
  const capabilities = Array.isArray(agent.capabilities)
    ? agent.capabilities.flatMap((capability) => (
      isRecord(capability) && typeof capability.description === 'string'
        ? [capability.description]
        : []
    ))
    : [];
  const actions = Array.isArray(listing.actions)
    ? listing.actions.filter((action): action is string => typeof action === 'string')
    : [];
  return normalizeSearchText([
    listing.title,
    listing.description,
    agent.headline,
    agent.bio,
    ...capabilities,
    ...actions,
  ].filter((part): part is string => typeof part === 'string').join(' '));
}

export function parseMarketplaceDirectorySettings(value: unknown): MarketplaceDirectorySettings | null {
  if (!isRecord(value)) {
    return null;
  }
  if (value.visibility === 'private') {
    const allowed = Array.isArray(value.allowlistedAgentIds)
      ? value.allowlistedAgentIds.filter((id): id is string => typeof id === 'string')
      : [];
    return { visibility: 'private', allowlistedAgentIds: allowed };
  }
  if (value.visibility === 'organization' && typeof value.organizationId === 'string') {
    return { visibility: 'organization', organizationId: value.organizationId };
  }
  return value.visibility === 'public' ? directorySettingsDefaults : null;
}

export async function ensureMarketplaceViewer(
  firestore: Firestore,
  uid: string,
): Promise<MarketplaceViewer> {
  const [agentSnapshot, memberships, preferencesSnapshot] = await Promise.all([
    firestore.collection('agents').doc(uid).get(),
    firestore.collectionGroup('members')
      .where('uid', '==', uid)
      .limit(100)
      .get(),
    firestore.collection('marketplacePreferences').doc(uid).get(),
  ]);
  const agentId = agentSnapshot.data()?.agentId;
  const preferences = preferencesSnapshot.data() ?? {};
  const safeIds = (value: unknown) => Array.isArray(value)
    ? new Set(value.filter((id): id is string => typeof id === 'string'))
    : new Set<string>();

  return {
    uid,
    agentId: typeof agentId === 'string' && /^agt_[A-Za-z0-9_-]{32}$/.test(agentId)
      ? agentId
      : null,
    organizationIds: new Set(memberships.docs
      .map((membership) => membership.ref.parent.parent?.id)
      .filter((id): id is string => Boolean(id))),
    allowlistedAgentIds: safeIds(preferences.allowlistedAgentIds),
    blocklistedAgentIds: safeIds(preferences.blocklistedAgentIds),
  };
}

export async function ensureMarketplaceAgentProfile(
  firestore: Firestore,
  ownerUid: string,
  agentId: string,
) {
  const profileRef = firestore.collection('agentMarketplaceProfiles').doc(agentId);
  return firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(profileRef);
    if (snapshot.exists) {
      const current = snapshot.data();
      if (!current || current.ownerId !== ownerUid || current.agentId !== agentId) {
        throw new Error('Marketplace profile ownership is invalid.');
      }
      if (!parseMarketplaceDirectorySettings(current.directorySettings)) {
        throw new Error('Marketplace directory settings are invalid.');
      }
      return current;
    }

    const createdAt = getServerTimestamp();
    const profile = {
      agentId,
      ownerId: ownerUid,
      directorySettings: directorySettingsDefaults,
      verificationStatus: 'unverified',
      verificationReason: null,
      version: 1,
      createdAt,
      updatedAt: createdAt,
    };
    transaction.create(profileRef, profile);
    return profile;
  });
}

export function canViewMarketplaceDirectory(
  settings: MarketplaceDirectorySettings,
  ownerUid: string,
  viewer: MarketplaceViewer,
): boolean {
  if (ownerUid === viewer.uid || settings.visibility === 'public') {
    return true;
  }
  if (settings.visibility === 'private') {
    return viewer.agentId !== null && settings.allowlistedAgentIds.includes(viewer.agentId);
  }
  return viewer.organizationIds.has(settings.organizationId);
}

export async function marketplaceOwnerHasDirectoryAccess(
  firestore: Firestore,
  settings: MarketplaceDirectorySettings,
  ownerUid: string,
): Promise<boolean> {
  if (settings.visibility !== 'organization') {
    return true;
  }
  const membership = await firestore.collection('marketplaceOrganizations')
    .doc(settings.organizationId)
    .collection('members')
    .doc(ownerUid)
    .get();
  return membership.exists && membership.data()?.uid === ownerUid;
}

export function canViewMarketplaceListing(
  listing: StoredData,
  settings: MarketplaceDirectorySettings,
  ownerUid: string,
  viewer: MarketplaceViewer,
): boolean {
  if (!canViewMarketplaceDirectory(settings, ownerUid, viewer)) {
    return false;
  }
  if (listing.visibility !== settings.visibility) {
    return false;
  }
  return settings.visibility !== 'organization'
    || listing.organizationId === settings.organizationId;
}

function metricsFor(value: unknown) {
  const metrics = isRecord(value) ? value : {};
  const reviewCount = safeCount(metrics.reviewCount);
  const completedTransactions = safeCount(metrics.completedTransactions);
  const successfulCaptureAttempts = safeCount(metrics.successfulCaptureAttempts);
  const failedCaptureAttempts = safeCount(metrics.failedCaptureAttempts);
  const ratingTotal = safeCount(metrics.ratingTotal);
  const averageRating = reviewCount > 0
    ? Math.round((ratingTotal / reviewCount) * 10) / 10
    : 0;
  const captureAttempts = successfulCaptureAttempts + failedCaptureAttempts;
  const reliabilityPercent = captureAttempts > 0
    ? Math.round((successfulCaptureAttempts / captureAttempts) * 1000) / 10
    : null;
  return {
    averageRating,
    reviewCount,
    completedTransactions,
    successfulCaptureAttempts,
    failedCaptureAttempts,
    reliabilityPercent,
  };
}

export function formatMarketplaceListing(
  listingId: string,
  listing: StoredData,
  agent: StoredData,
  verificationStatus: 'unverified' | 'verified' | 'rejected',
  metricsData: unknown,
): MarketplaceServiceListing {
  const serviceLevelAgreement = listing.serviceLevelAgreement;
  if (!isRecord(serviceLevelAgreement)) {
    throw new Error('Stored marketplace service-level agreement is invalid.');
  }
  const parsed = marketplaceServiceListingSchema.safeParse({
    listingId,
    agentId: listing.agentId,
    agentName: agent.displayName,
    headline: agent.headline,
    category: listing.category,
    title: listing.title,
    description: listing.description,
    actions: listing.actions,
    pricing: listing.pricing,
    availability: listing.availability,
    serviceLevelAgreement,
    authenticationRequirements: listing.authenticationRequirements,
    protocolVersions: listing.protocolVersions,
    verificationStatus,
    ...metricsFor(metricsData),
    version: listing.version,
    createdAt: timestampToIso(listing.createdAt),
    updatedAt: timestampToIso(listing.updatedAt),
  });
  if (!parsed.success) {
    throw new Error('Stored marketplace listing is invalid.');
  }
  return parsed.data;
}

function recommendationScore(listing: MarketplaceServiceListing): number {
  return (listing.verificationStatus === 'verified' ? 20 : 0)
    + (listing.availability === 'available' ? 8 : listing.availability === 'busy' ? 2 : 0)
    + listing.averageRating * 6
    + Math.min(listing.completedTransactions, 100) * 0.25
    + (listing.reliabilityPercent ?? 0) * 0.1;
}

function priceForSort(listing: MarketplaceServiceListing): number {
  const range = priceRange(listing.pricing);
  return range.minimum ?? Number.MAX_SAFE_INTEGER;
}

function timeForSort(value: string | null): number {
  return value ? Date.parse(value) || 0 : 0;
}

function matchesSearch(
  listing: MarketplaceServiceListing,
  storedListing: StoredData,
  agent: StoredData,
  filters: MarketplaceListingSearch,
  viewer: MarketplaceViewer,
): boolean {
  if (viewer.blocklistedAgentIds.has(listing.agentId)) {
    return false;
  }
  if (
    viewer.allowlistedAgentIds.size > 0
    && !viewer.allowlistedAgentIds.has(listing.agentId)
  ) {
    return false;
  }
  if (filters.category && listing.category !== filters.category) {
    return false;
  }
  if (filters.action && !listing.actions.includes(filters.action)) {
    return false;
  }
  if (filters.availability && listing.availability !== filters.availability) {
    return false;
  }
  if (filters.verified !== undefined && (listing.verificationStatus === 'verified') !== filters.verified) {
    return false;
  }

  const range = priceRange(listing.pricing);
  if (filters.currency && range.currency !== filters.currency) {
    return false;
  }
  if (
    filters.minPriceMinor !== undefined
    && (
      range.minimum === null
      || (range.maximum !== null && range.maximum < filters.minPriceMinor)
    )
  ) {
    return false;
  }
  if (
    filters.maxPriceMinor !== undefined
    && (range.minimum === null || range.minimum > filters.maxPriceMinor)
  ) {
    return false;
  }
  if (filters.q) {
    const query = normalizeSearchText(filters.q);
    if (!query || !dataForSearch(storedListing, agent).includes(query)) {
      return false;
    }
  }
  return true;
}

export async function searchMarketplaceListings(
  firestore: Firestore,
  viewer: MarketplaceViewer,
  filters: MarketplaceListingSearch,
) {
  const snapshot = await firestore.collection('agentServiceListings')
    .where('status', '==', 'published')
    .orderBy('updatedAt', 'desc')
    .limit(500)
    .get();
  const candidates = snapshot.docs
    .map((document) => ({ id: document.id, data: document.data() }))
    .filter(({ data }) => isRecord(data));
  const agentIds = [...new Set(candidates
    .map(({ data }) => data.agentId)
    .filter((id): id is string => typeof id === 'string'))];
  const agentSnapshots = await Promise.all(agentIds.map(async (agentId) => {
    const [profileSnapshot, identitySnapshot] = await Promise.all([
      firestore.collection('agentMarketplaceProfiles').doc(agentId).get(),
      firestore.collection('agentIdentities').doc(agentId).get(),
    ]);
    const profile = profileSnapshot.data();
    const identity = identitySnapshot.data();
    const ownerUid = profile?.ownerId;
    if (
      !profileSnapshot.exists
      || !profile
      || typeof ownerUid !== 'string'
      || !identitySnapshot.exists
      || identity?.agentId !== agentId
      || identity?.agentUid !== ownerUid
      || profile.agentId !== agentId
    ) {
      return [agentId, null] as const;
    }
    const [agentSnapshot, metricsSnapshot] = await Promise.all([
      firestore.collection('agents').doc(ownerUid).get(),
      firestore.collection('marketplaceAgentMetrics').doc(agentId).get(),
    ]);
    const settings = parseMarketplaceDirectorySettings(profile.directorySettings);
    const ownerHasDirectoryAccess = settings
      ? await marketplaceOwnerHasDirectoryAccess(firestore, settings, ownerUid)
      : false;
    return [agentId, {
      marketplaceProfile: profile,
      ownerUid,
      agent: agentSnapshot.data() ?? null,
      metrics: metricsSnapshot.data() ?? null,
      ownerHasDirectoryAccess,
    }] as const;
  }));
  const agentData = new Map(agentSnapshots);
  const results: Array<{
    listing: MarketplaceServiceListing;
    score: number;
  }> = [];

  for (const candidate of candidates) {
    const agentId = candidate.data.agentId;
    if (typeof agentId !== 'string') {
      continue;
    }
    const details = agentData.get(agentId);
    if (!details?.agent || !details.marketplaceProfile) {
      continue;
    }
    const agent = details.agent;
    const settings = parseMarketplaceDirectorySettings(details.marketplaceProfile.directorySettings);
    if (
      !settings
      || !details.ownerHasDirectoryAccess
      || agent.agentId !== agentId
      || agent.ownerId !== details.ownerUid
      || candidate.data.ownerUid !== details.ownerUid
      || agent.status !== 'active'
      || !canViewMarketplaceListing(candidate.data, settings, details.ownerUid, viewer)
    ) {
      continue;
    }
    const verificationStatus = details.marketplaceProfile.verificationStatus === 'verified'
      ? 'verified'
      : details.marketplaceProfile.verificationStatus === 'rejected'
        ? 'rejected'
        : 'unverified';
    const listing = formatMarketplaceListing(
      candidate.id,
      candidate.data,
      agent,
      verificationStatus,
      details.metrics,
    );
    if (matchesSearch(listing, candidate.data, agent, filters, viewer)) {
      results.push({ listing, score: recommendationScore(listing) });
    }
  }

  results.sort((left, right) => {
    switch (filters.sort) {
      case 'newest':
        return timeForSort(right.listing.createdAt) - timeForSort(left.listing.createdAt);
      case 'price_asc':
        return priceForSort(left.listing) - priceForSort(right.listing);
      case 'price_desc':
        return priceForSort(right.listing) - priceForSort(left.listing);
      case 'rating':
        return right.listing.averageRating - left.listing.averageRating
          || right.listing.reviewCount - left.listing.reviewCount;
      case 'reliability':
        return (right.listing.reliabilityPercent ?? -1) - (left.listing.reliabilityPercent ?? -1);
      case 'completed':
        return right.listing.completedTransactions - left.listing.completedTransactions;
      default:
        return right.score - left.score;
    }
  });

  const start = (filters.page - 1) * filters.pageSize;
  return {
    listings: results.slice(start, start + filters.pageSize).map(({ listing }) => listing),
    page: filters.page,
    pageSize: filters.pageSize,
    total: results.length,
    hasMore: start + filters.pageSize < results.length,
    truncated: snapshot.size === 500,
  };
}

export function buildAgentCapabilityDocument(
  agentId: string,
  agent: StoredData,
  services: MarketplaceServiceListing[],
  version: number,
  updatedAt: unknown,
): AgentCapabilityDocument {
  const supportedActions = [...new Set(services.flatMap((service) => service.actions))].sort();
  const authenticationRequirements = [...new Set(
    services.flatMap((service) => service.authenticationRequirements),
  )].sort() as Array<'firebase_id_token' | 'scoped_agent_api_key'>;
  const supportedProtocolVersions = [...new Set(
    services.flatMap((service) => service.protocolVersions),
  )].sort();
  const pricingModels = [...new Set(services.map((service) => service.pricing.model))].sort() as Array<
    'fixed' | 'hourly' | 'from' | 'dynamic' | 'quote'
  >;
  const parsed = agentCapabilityDocumentSchema.safeParse({
    schemaVersion: '1.0',
    agentId,
    displayName: agent.displayName,
    headline: agent.headline,
    services: services.map((service) => ({
      listingId: service.listingId,
      title: service.title,
      category: service.category,
      actions: service.actions,
      pricing: service.pricing,
      availability: service.availability,
      protocolVersions: service.protocolVersions,
      authenticationRequirements: service.authenticationRequirements,
    })),
    supportedActions,
    pricingModels,
    availability: agent.availability,
    supportedCurrencies: Array.isArray(agent.supportedCurrencies) ? agent.supportedCurrencies : [],
    authenticationRequirements,
    supportedProtocolVersions,
    version,
    updatedAt: timestampToIso(updatedAt),
  });
  if (!parsed.success) {
    throw new Error('Agent capability document could not be validated.');
  }
  return parsed.data;
}

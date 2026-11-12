import type { Firestore } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';
import {
  canViewMarketplaceDirectory,
  canViewMarketplaceListing,
  searchMarketplaceListings,
} from '@/lib/marketplace/store';
import {
  marketplaceListingSearchSchema,
  type MarketplaceDirectorySettings,
} from '@/models/marketplace';
import type { MarketplaceViewer } from '@/lib/marketplace/store';

const ownerUid = 'owner-1';
const organizationId = 'A'.repeat(20);
const firstAgentId = `agt_${'A'.repeat(32)}`;
const secondAgentId = `agt_${'B'.repeat(32)}`;

function viewer(overrides: Partial<MarketplaceViewer> = {}): MarketplaceViewer {
  return {
    uid: 'viewer-1',
    agentId: `agt_${'V'.repeat(32)}`,
    organizationIds: new Set(),
    allowlistedAgentIds: new Set(),
    blocklistedAgentIds: new Set(),
    ...overrides,
  };
}

function listing(agentId: string, title: string, amountMinor: number, visibility = 'public') {
  return {
    agentId,
    ownerUid: `owner-${agentId}`,
    status: 'published',
    visibility,
    organizationId: visibility === 'organization' ? organizationId : null,
    category: 'software',
    title,
    description: 'A dependable software service for product teams.',
    actions: ['build_api'],
    pricing: { model: 'fixed', amountMinor, currency: 'USD' },
    availability: 'available',
    serviceLevelAgreement: {
      responseTimeHours: 24,
      deliveryTimeDays: 5,
      includedRevisions: 1,
    },
    authenticationRequirements: ['firebase_id_token'],
    protocolVersions: ['v1.0'],
    version: 1,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  };
}

function inMemoryFirestore(
  records: Map<string, Record<string, unknown>>,
  listingRecords: Array<{ id: string; data: Record<string, unknown> }>,
): Firestore {
  function get(path: string) {
    const data = records.get(path);
    return { exists: data !== undefined, data: () => data };
  }

  const firestore = {
    collection(name: string) {
      return {
        doc(id: string) {
          const path = `${name}/${id}`;
          return {
            get: async () => get(path),
            collection: (subcollection: string) => ({
              doc: (memberId: string) => ({
                get: async () => get(`${path}/${subcollection}/${memberId}`),
              }),
            }),
          };
        },
        where(field: string, _operator: string, value: unknown) {
          return {
            orderBy() {
              return {
                limit(limit: number) {
                  return {
                    get: async () => ({
                      size: Math.min(listingRecords.filter((item) => item.data[field] === value).length, limit),
                      docs: listingRecords
                        .filter((item) => item.data[field] === value)
                        .slice(0, limit)
                        .map((item) => ({ id: item.id, data: () => item.data })),
                    }),
                  };
                },
              };
            },
          };
        },
      };
    },
  };
  return firestore as unknown as Firestore;
}

function searchFixture() {
  const records = new Map<string, Record<string, unknown>>();
  const listings = [
    { id: 'listing-low', data: { ...listing(firstAgentId, 'API integration', 1000), ownerUid: 'owner-first' } },
    { id: 'listing-mid', data: { ...listing(secondAgentId, 'Data workflow', 2000), ownerUid: 'owner-second' } },
    { id: 'listing-high', data: { ...listing(firstAgentId, 'Platform migration', 3000), ownerUid: 'owner-first' } },
  ];
  for (const [agentId, uid, name] of [
    [firstAgentId, 'owner-first', 'First Agent'],
    [secondAgentId, 'owner-second', 'Second Agent'],
  ]) {
    records.set(`agentMarketplaceProfiles/${agentId}`, {
      agentId,
      ownerId: uid,
      directorySettings: { visibility: 'public' },
      verificationStatus: 'unverified',
    });
    records.set(`agentIdentities/${agentId}`, { agentId, agentUid: uid });
    records.set(`agents/${uid}`, {
      agentId,
      ownerId: uid,
      displayName: name,
      headline: 'Reliable software partner',
      bio: 'A trusted provider for software projects and integrations.',
      capabilities: [{ description: 'API development and data workflows.' }],
      status: 'active',
      availability: 'available',
      supportedCurrencies: ['USD'],
    });
  }
  return { firestore: inMemoryFirestore(records, listings), listings, records };
}

describe('marketplace directory and discovery', () => {
  it('enforces public, private allowlist, and organization directory visibility', () => {
    const publicSettings: MarketplaceDirectorySettings = { visibility: 'public' };
    const privateSettings: MarketplaceDirectorySettings = {
      visibility: 'private',
      allowlistedAgentIds: [firstAgentId],
    };
    const organizationSettings: MarketplaceDirectorySettings = {
      visibility: 'organization',
      organizationId,
    };

    expect(canViewMarketplaceDirectory(publicSettings, ownerUid, viewer())).toBe(true);
    expect(canViewMarketplaceDirectory(privateSettings, ownerUid, viewer())).toBe(false);
    expect(canViewMarketplaceDirectory(
      privateSettings,
      ownerUid,
      viewer({ agentId: firstAgentId }),
    )).toBe(true);
    expect(canViewMarketplaceDirectory(
      organizationSettings,
      ownerUid,
      viewer({ organizationIds: new Set([organizationId]) }),
    )).toBe(true);
    expect(canViewMarketplaceListing(
      { visibility: 'organization', organizationId },
      organizationSettings,
      ownerUid,
      viewer({ organizationIds: new Set([organizationId]) }),
    )).toBe(true);
    expect(canViewMarketplaceListing(
      { visibility: 'public', organizationId: null },
      organizationSettings,
      ownerUid,
      viewer({ organizationIds: new Set([organizationId]) }),
    )).toBe(false);
  });

  it('filters, sorts, paginates, and applies agent blocklists to visible listings', async () => {
    const { firestore, listings } = searchFixture();
    const filters = marketplaceListingSearchSchema.parse({
      category: 'software',
      action: 'build_api',
      currency: 'USD',
      minPriceMinor: '1500',
      maxPriceMinor: '3000',
      sort: 'price_asc',
      page: '1',
      pageSize: '1',
    });
    const result = await searchMarketplaceListings(firestore, viewer(), filters);

    expect(result).toMatchObject({
      page: 1,
      pageSize: 1,
      total: 2,
      hasMore: true,
      truncated: false,
    });
    expect(result.listings.map((item) => item.listingId)).toEqual(['listing-mid']);

    const blocked = await searchMarketplaceListings(
      firestore,
      viewer({ blocklistedAgentIds: new Set([secondAgentId]) }),
      { ...filters, minPriceMinor: undefined, maxPriceMinor: undefined, pageSize: 20 },
    );
    expect(blocked.listings.map((item) => item.agentId)).not.toContain(secondAgentId);

    const startingPriceListing = listings.find((item) => item.id === 'listing-high');
    if (!startingPriceListing) {
      throw new Error('Expected listing fixture to exist.');
    }
    startingPriceListing.data.pricing = {
      model: 'from',
      amountMinor: 1000,
      currency: 'USD',
    };
    const startingPriceResults = await searchMarketplaceListings(
      firestore,
      viewer(),
      { ...filters, minPriceMinor: 1500, maxPriceMinor: undefined, pageSize: 20 },
    );
    expect(startingPriceResults.listings.map((item) => item.listingId)).toContain('listing-high');
  });

  it('hides organization listings when the publisher no longer belongs to that organization', async () => {
    const { listings, records } = searchFixture();
    const orgListings = listings.filter(({ data }) => data.agentId === firstAgentId);
    for (const item of orgListings) {
      item.data.visibility = 'organization';
      item.data.organizationId = organizationId;
    }
    records.set(`agentMarketplaceProfiles/${firstAgentId}`, {
      ...records.get(`agentMarketplaceProfiles/${firstAgentId}`),
      directorySettings: { visibility: 'organization', organizationId },
    });
    records.set(`marketplaceOrganizations/${organizationId}/members/owner-first`, {
      uid: 'owner-first',
      role: 'member',
    });
    records.set(`marketplaceOrganizations/${organizationId}/members/viewer-1`, {
      uid: 'viewer-1',
      role: 'member',
    });
    const filters = marketplaceListingSearchSchema.parse({ pageSize: 20 });
    const organizationViewer = viewer({ organizationIds: new Set([organizationId]) });
    const firestore = inMemoryFirestore(records, listings);

    expect((await searchMarketplaceListings(firestore, organizationViewer, filters)).listings)
      .toHaveLength(3);

    records.delete(`marketplaceOrganizations/${organizationId}/members/owner-first`);
    expect((await searchMarketplaceListings(firestore, organizationViewer, filters)).listings)
      .toHaveLength(1);
  });

  it('rejects malformed or contradictory discovery filters', () => {
    expect(marketplaceListingSearchSchema.safeParse({
      q: 'a'.repeat(101),
    }).success).toBe(false);
    expect(marketplaceListingSearchSchema.safeParse({
      minPriceMinor: '500',
      maxPriceMinor: '100',
    }).success).toBe(false);
    expect(marketplaceListingSearchSchema.safeParse({
      sort: 'createdAt desc; DROP',
    }).success).toBe(false);
  });

  it('does not turn punctuation-only search text into an unfiltered discovery query', async () => {
    const { firestore } = searchFixture();
    const filters = marketplaceListingSearchSchema.parse({ q: '!!!', pageSize: 20 });

    const result = await searchMarketplaceListings(firestore, viewer(), filters);

    expect(result.listings).toEqual([]);
    expect(result.total).toBe(0);
  });
});

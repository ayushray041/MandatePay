'use client';

import { z } from 'zod';
import { authenticatedApiRequest } from '@/lib/api/client';
import {
  agentCapabilityDocumentSchema,
  marketplaceAgentDetailSchema,
  marketplaceOrganizationSchema,
  marketplaceOwnerListingSchema,
  marketplacePreferencesSchema,
  marketplaceProfileSettingsResponseSchema,
  marketplaceReviewSchema,
  marketplaceSearchResponseSchema,
  marketplaceServiceListingInputSchema,
  marketplaceServiceListingSchema,
  type MarketplaceDirectorySettings,
  type MarketplacePreferences,
  type MarketplaceServiceListingInput,
} from '@/models/marketplace';

const organizationMemberSchema = z.object({
  uid: z.string(),
  displayName: z.string(),
  role: z.enum(['owner', 'member']),
  createdAt: z.string().nullable(),
}).strict();
const listingHistorySchema = z.array(z.object({
  version: z.number().int().positive(),
  createdAt: z.string().nullable(),
  listing: marketplaceServiceListingSchema,
}).strict());

export type MarketplaceSearchFilters = {
  q?: string;
  category?: string;
  action?: string;
  currency?: string;
  minPriceMinor?: number;
  maxPriceMinor?: number;
  availability?: 'available' | 'busy' | 'paused';
  verified?: boolean;
  sort?: 'recommended' | 'newest' | 'price_asc' | 'price_desc' | 'rating' | 'reliability' | 'completed';
  page?: number;
  pageSize?: number;
};

export async function searchMarketplace(filters: MarketplaceSearchFilters) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== '') {
      query.set(key, String(value));
    }
  }
  return authenticatedApiRequest(
    `/api/marketplace/search?${query.toString()}`,
    marketplaceSearchResponseSchema,
    {},
    'Marketplace search failed.',
  );
}

export async function listMyMarketplaceServices() {
  return authenticatedApiRequest(
    '/api/marketplace/listings/mine',
    z.array(marketplaceOwnerListingSchema),
    {},
    'Your service listings could not be loaded.',
  );
}

export async function createMarketplaceService(input: MarketplaceServiceListingInput) {
  return authenticatedApiRequest(
    '/api/marketplace/listings',
    z.object({
      listing: marketplaceServiceListingSchema,
      status: z.enum(['draft', 'published', 'paused']),
    }).strict(),
    { method: 'POST', body: JSON.stringify(input) },
    'Service listing could not be created.',
  );
}

export async function updateMarketplaceService(
  listingId: string,
  input: MarketplaceServiceListingInput,
) {
  return authenticatedApiRequest(
    `/api/marketplace/listings/${encodeURIComponent(listingId)}`,
    z.object({
      listing: marketplaceServiceListingSchema,
      status: z.enum(['draft', 'published', 'paused']),
    }).strict(),
    { method: 'PATCH', body: JSON.stringify(input) },
    'Service listing could not be updated.',
  );
}

export async function pauseMarketplaceService(listingId: string) {
  return authenticatedApiRequest(
    `/api/marketplace/listings/${encodeURIComponent(listingId)}`,
    z.object({ listingId: z.string(), status: z.literal('paused') }).strict(),
    { method: 'DELETE' },
    'Service listing could not be paused.',
  );
}

export async function getMarketplaceProfileSettings() {
  return authenticatedApiRequest(
    '/api/marketplace/profile',
    marketplaceProfileSettingsResponseSchema,
    {},
    'Marketplace profile settings could not be loaded.',
  );
}

export async function updateMarketplaceDirectorySettings(settings: MarketplaceDirectorySettings) {
  return authenticatedApiRequest(
    '/api/marketplace/profile',
    marketplaceProfileSettingsResponseSchema,
    { method: 'PATCH', body: JSON.stringify(settings) },
    'Marketplace directory settings could not be updated.',
  );
}

export async function getMarketplacePreferences() {
  return authenticatedApiRequest(
    '/api/marketplace/preferences',
    marketplacePreferencesSchema,
    {},
    'Marketplace preferences could not be loaded.',
  );
}

export async function updateMarketplacePreferences(preferences: MarketplacePreferences) {
  return authenticatedApiRequest(
    '/api/marketplace/preferences',
    marketplacePreferencesSchema,
    { method: 'PUT', body: JSON.stringify(preferences) },
    'Marketplace preferences could not be updated.',
  );
}

export async function listMarketplaceOrganizations() {
  return authenticatedApiRequest(
    '/api/marketplace/organizations',
    z.array(marketplaceOrganizationSchema),
    {},
    'Organizations could not be loaded.',
  );
}

export async function createMarketplaceOrganization(name: string) {
  return authenticatedApiRequest(
    '/api/marketplace/organizations',
    marketplaceOrganizationSchema,
    { method: 'POST', body: JSON.stringify({ name }) },
    'Organization could not be created.',
  );
}

export async function listMarketplaceOrganizationMembers(organizationId: string) {
  return authenticatedApiRequest(
    `/api/marketplace/organizations/${encodeURIComponent(organizationId)}/members`,
    z.array(organizationMemberSchema),
    {},
    'Organization members could not be loaded.',
  );
}

export async function addMarketplaceOrganizationMember(organizationId: string, uid: string) {
  return authenticatedApiRequest(
    `/api/marketplace/organizations/${encodeURIComponent(organizationId)}/members`,
    z.object({
      uid: z.string(),
      role: z.literal('member'),
      status: z.literal('active'),
    }).strict(),
    { method: 'POST', body: JSON.stringify({ uid }) },
    'Organization member could not be added.',
  );
}

export async function removeMarketplaceOrganizationMember(organizationId: string, uid: string) {
  return authenticatedApiRequest(
    `/api/marketplace/organizations/${encodeURIComponent(organizationId)}/members/${encodeURIComponent(uid)}`,
    z.object({ uid: z.string(), status: z.literal('removed') }).strict(),
    { method: 'DELETE' },
    'Organization member could not be removed.',
  );
}

export async function getMarketplaceAgent(agentId: string) {
  return authenticatedApiRequest(
    `/api/marketplace/agents/${encodeURIComponent(agentId)}`,
    marketplaceAgentDetailSchema,
    {},
    'Marketplace agent profile could not be loaded.',
  );
}

export async function getAgentCapabilityDocument(agentId: string) {
  return authenticatedApiRequest(
    `/api/marketplace/agents/${encodeURIComponent(agentId)}/capabilities`,
    agentCapabilityDocumentSchema,
    {},
    'Agent capability document could not be loaded.',
  );
}

export async function getMarketplaceListingHistory(listingId: string) {
  return authenticatedApiRequest(
    `/api/marketplace/listings/${encodeURIComponent(listingId)}/versions`,
    listingHistorySchema,
    {},
    'Service listing history could not be loaded.',
  );
}

export async function submitMarketplaceReview(input: {
  paymentId: string;
  rating: number;
  comment: string;
}) {
  return authenticatedApiRequest(
    '/api/marketplace/reviews',
    marketplaceReviewSchema,
    { method: 'POST', body: JSON.stringify(input) },
    'Marketplace review could not be submitted.',
  );
}

export function parseMarketplaceServiceInput(value: unknown) {
  return marketplaceServiceListingInputSchema.safeParse(value);
}

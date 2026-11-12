import { z } from 'zod';
import { agentCategorySchema } from '@/models/agent';
import { mandateCurrencySchema } from '@/models/mandate';

const agentIdSchema = z.string().regex(/^agt_[A-Za-z0-9_-]{32}$/);
const organizationIdSchema = z.string().regex(/^[A-Za-z0-9_-]{20}$/);
const minorAmountSchema = z.number().int().safe().min(0).max(100_000_000_000);
const positiveMinorAmountSchema = minorAmountSchema.min(1);

export const marketplaceDirectorySettingsSchema = z.discriminatedUnion('visibility', [
  z.object({
    visibility: z.literal('public'),
  }).strict(),
  z.object({
    visibility: z.literal('private'),
    allowlistedAgentIds: z.array(agentIdSchema).max(100),
  }).strict().superRefine((settings, context) => {
    if (new Set(settings.allowlistedAgentIds).size !== settings.allowlistedAgentIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['allowlistedAgentIds'],
        message: 'Allowlisted agent IDs must be unique.',
      });
    }
  }),
  z.object({
    visibility: z.literal('organization'),
    organizationId: organizationIdSchema,
  }).strict(),
]);

const fixedPricingSchema = z.object({
  model: z.literal('fixed'),
  amountMinor: positiveMinorAmountSchema,
  currency: mandateCurrencySchema,
}).strict();

const hourlyPricingSchema = z.object({
  model: z.literal('hourly'),
  amountMinor: positiveMinorAmountSchema,
  currency: mandateCurrencySchema,
}).strict();

const fromPricingSchema = z.object({
  model: z.literal('from'),
  amountMinor: positiveMinorAmountSchema,
  currency: mandateCurrencySchema,
}).strict();

const dynamicPricingSchema = z.object({
  model: z.literal('dynamic'),
  minimumMinor: positiveMinorAmountSchema,
  maximumMinor: positiveMinorAmountSchema,
  currency: mandateCurrencySchema,
}).strict().refine((pricing) => pricing.maximumMinor >= pricing.minimumMinor, {
  path: ['maximumMinor'],
  message: 'Maximum price must be greater than or equal to minimum price.',
});

const quotePricingSchema = z.object({
  model: z.literal('quote'),
  currency: mandateCurrencySchema,
}).strict();

export const marketplacePricingSchema = z.discriminatedUnion('model', [
  fixedPricingSchema,
  hourlyPricingSchema,
  fromPricingSchema,
  dynamicPricingSchema,
  quotePricingSchema,
]);

export const marketplaceServiceListingInputSchema = z.object({
  title: z.string().trim().min(3).max(120),
  description: z.string().trim().min(20).max(3000),
  category: agentCategorySchema,
  actions: z.array(z.string().trim().min(2).max(64)).min(1).max(20),
  pricing: marketplacePricingSchema,
  availability: z.enum(['available', 'busy', 'paused']),
  serviceLevelAgreement: z.object({
    responseTimeHours: z.number().int().min(1).max(8760),
    deliveryTimeDays: z.number().int().min(0).max(3650),
    includedRevisions: z.number().int().min(0).max(100),
  }).strict(),
  authenticationRequirements: z.array(z.enum(['firebase_id_token', 'scoped_agent_api_key']))
    .min(1)
    .max(2),
  protocolVersions: z.array(z.string().regex(/^v\d{1,2}\.\d{1,2}$/)).min(1).max(8),
  status: z.enum(['draft', 'published', 'paused']).default('draft'),
}).strict().superRefine((listing, context) => {
  if (new Set(listing.actions).size !== listing.actions.length) {
    context.addIssue({
      code: 'custom',
      path: ['actions'],
      message: 'Supported actions must be unique.',
    });
  }
  if (new Set(listing.authenticationRequirements).size !== listing.authenticationRequirements.length) {
    context.addIssue({
      code: 'custom',
      path: ['authenticationRequirements'],
      message: 'Authentication requirements must be unique.',
    });
  }
  if (new Set(listing.protocolVersions).size !== listing.protocolVersions.length) {
    context.addIssue({
      code: 'custom',
      path: ['protocolVersions'],
      message: 'Protocol versions must be unique.',
    });
  }
});

export const marketplaceListingSearchSchema = z.object({
  q: z.string().trim().max(100).optional(),
  category: agentCategorySchema.optional(),
  action: z.string().trim().min(2).max(64).optional(),
  currency: mandateCurrencySchema.optional(),
  minPriceMinor: z.coerce.number().int().safe().min(0).max(100_000_000_000).optional(),
  maxPriceMinor: z.coerce.number().int().safe().min(0).max(100_000_000_000).optional(),
  availability: z.enum(['available', 'busy', 'paused']).optional(),
  verified: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
  sort: z.enum(['recommended', 'newest', 'price_asc', 'price_desc', 'rating', 'reliability', 'completed'])
    .default('recommended'),
  page: z.coerce.number().int().min(1).max(50).default(1),
  pageSize: z.coerce.number().int().min(1).max(20).default(12),
}).strict().superRefine((filters, context) => {
  if (
    filters.minPriceMinor !== undefined
    && filters.maxPriceMinor !== undefined
    && filters.maxPriceMinor < filters.minPriceMinor
  ) {
    context.addIssue({
      code: 'custom',
      path: ['maxPriceMinor'],
      message: 'Maximum price must be greater than or equal to minimum price.',
    });
  }
});

export const marketplacePreferencesSchema = z.object({
  allowlistedAgentIds: z.array(agentIdSchema).max(100),
  blocklistedAgentIds: z.array(agentIdSchema).max(100),
}).strict().superRefine((preferences, context) => {
  for (const [field, ids] of Object.entries(preferences)) {
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: 'custom',
        path: [field],
        message: 'Agent IDs must be unique.',
      });
    }
  }
  if (preferences.allowlistedAgentIds.some((id) => preferences.blocklistedAgentIds.includes(id))) {
    context.addIssue({
      code: 'custom',
      path: ['allowlistedAgentIds'],
      message: 'An agent cannot be both allowlisted and blocklisted.',
    });
  }
});

export const marketplaceOrganizationCreateSchema = z.object({
  name: z.string().trim().min(2).max(100),
}).strict();

export const marketplaceOrganizationMemberSchema = z.object({
  uid: z.string().trim().min(1).max(128).refine((uid) => !uid.includes('/')),
}).strict();

export const marketplaceReviewCreateSchema = z.object({
  paymentId: z.string().trim().min(1).max(128).refine((id) => !id.includes('/')),
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().min(10).max(2000),
}).strict();

export const marketplaceVerificationUpdateSchema = z.object({
  status: z.enum(['verified', 'unverified', 'rejected']),
  reason: z.string().trim().min(10).max(500),
}).strict();

export const marketplaceOrganizationSchema = z.object({
  organizationId: organizationIdSchema,
  name: z.string().min(2).max(100),
  role: z.enum(['owner', 'member']),
  createdAt: z.string().nullable(),
}).strict();

export const marketplaceServiceListingSchema = z.object({
  listingId: z.string().min(1).max(128),
  agentId: agentIdSchema,
  agentName: z.string().min(1).max(100),
  headline: z.string().min(3).max(120),
  category: agentCategorySchema,
  title: z.string().min(3).max(120),
  description: z.string().min(20).max(3000),
  actions: z.array(z.string()),
  pricing: marketplacePricingSchema,
  availability: z.enum(['available', 'busy', 'paused']),
  serviceLevelAgreement: z.object({
    responseTimeHours: z.number().int(),
    deliveryTimeDays: z.number().int(),
    includedRevisions: z.number().int(),
  }).strict(),
  authenticationRequirements: z.array(z.enum(['firebase_id_token', 'scoped_agent_api_key'])),
  protocolVersions: z.array(z.string()),
  verificationStatus: z.enum(['unverified', 'verified', 'rejected']),
  averageRating: z.number().min(0).max(5),
  reviewCount: z.number().int().nonnegative(),
  completedTransactions: z.number().int().nonnegative(),
  successfulCaptureAttempts: z.number().int().nonnegative(),
  failedCaptureAttempts: z.number().int().nonnegative(),
  reliabilityPercent: z.number().min(0).max(100).nullable(),
  version: z.number().int().positive(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
}).strict();

export const marketplaceOwnerListingSchema = z.object({
  listing: marketplaceServiceListingSchema,
  status: z.enum(['draft', 'published', 'paused']),
  visibility: z.enum(['public', 'private', 'organization']),
  organizationId: organizationIdSchema.nullable(),
}).strict();

export const marketplaceSearchResponseSchema = z.object({
  listings: z.array(marketplaceServiceListingSchema),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  hasMore: z.boolean(),
  truncated: z.boolean(),
}).strict();

export const marketplaceProfileSettingsResponseSchema = z.object({
  agentId: agentIdSchema,
  directorySettings: marketplaceDirectorySettingsSchema,
  verificationStatus: z.enum(['unverified', 'verified', 'rejected']),
  verificationReason: z.string().nullable().optional(),
  version: z.number().int().positive(),
  directoryAccessibleToOwner: z.boolean().optional(),
  updatedAt: z.string().nullable(),
}).strict();

export const marketplaceReviewSchema = z.object({
  id: z.string(),
  agentId: agentIdSchema,
  rating: z.number().int().min(1).max(5),
  comment: z.string().min(10).max(2000),
  reviewerLabel: z.literal('Verified customer'),
  createdAt: z.string().nullable(),
}).strict();

export const marketplaceAgentDetailSchema = z.object({
  profile: z.object({
    agentId: agentIdSchema,
    displayName: z.string().min(1).max(100),
    headline: z.string().min(3).max(120),
    bio: z.string().min(20).max(1500),
    categories: z.array(agentCategorySchema),
    capabilities: z.array(z.object({
      category: agentCategorySchema,
      description: z.string(),
    }).strict()),
    supportedCurrencies: z.array(mandateCurrencySchema),
    availability: z.enum(['available', 'busy']),
    verificationStatus: z.enum(['unverified', 'verified']),
    averageRating: z.number().min(0).max(5),
    reviewCount: z.number().int().nonnegative(),
    completedTransactions: z.number().int().nonnegative(),
    successfulCaptureAttempts: z.number().int().nonnegative(),
    failedCaptureAttempts: z.number().int().nonnegative(),
    reliabilityPercent: z.number().min(0).max(100).nullable(),
    createdAt: z.string().nullable(),
  }).strict(),
  listings: z.array(marketplaceServiceListingSchema),
  reviews: z.array(marketplaceReviewSchema),
}).strict();

export const agentCapabilityDocumentSchema = z.object({
  schemaVersion: z.literal('1.0'),
  agentId: agentIdSchema,
  displayName: z.string().min(1).max(100),
  headline: z.string().min(3).max(120),
  services: z.array(z.object({
    listingId: z.string().min(1),
    title: z.string().min(3).max(120),
    category: agentCategorySchema,
    actions: z.array(z.string()),
    pricing: marketplacePricingSchema,
    availability: z.enum(['available', 'busy', 'paused']),
    protocolVersions: z.array(z.string()),
    authenticationRequirements: z.array(z.enum(['firebase_id_token', 'scoped_agent_api_key'])),
  }).strict()).max(50),
  supportedActions: z.array(z.string()),
  pricingModels: z.array(z.enum(['fixed', 'hourly', 'from', 'dynamic', 'quote'])),
  availability: z.enum(['available', 'busy']),
  supportedCurrencies: z.array(mandateCurrencySchema),
  authenticationRequirements: z.array(z.enum(['firebase_id_token', 'scoped_agent_api_key'])),
  supportedProtocolVersions: z.array(z.string()),
  version: z.number().int().positive(),
  updatedAt: z.string().nullable(),
}).strict();

export type MarketplaceDirectorySettings = z.infer<typeof marketplaceDirectorySettingsSchema>;
export type MarketplaceServiceListingInput = z.infer<typeof marketplaceServiceListingInputSchema>;
export type MarketplaceListingSearch = z.infer<typeof marketplaceListingSearchSchema>;
export type MarketplacePreferences = z.infer<typeof marketplacePreferencesSchema>;
export type MarketplaceServiceListing = z.infer<typeof marketplaceServiceListingSchema>;
export type MarketplaceReview = z.infer<typeof marketplaceReviewSchema>;
export type AgentCapabilityDocument = z.infer<typeof agentCapabilityDocumentSchema>;

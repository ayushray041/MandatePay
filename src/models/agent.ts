import { z } from 'zod';
import { mandateCurrencySchema } from '@/models/mandate';
import { agentCategories, agentCategorySchema } from '@/models/agent-category';

export { agentCategories, agentCategorySchema } from '@/models/agent-category';

const agentProfileFieldsSchema = z.object({
  headline: z.string().trim().min(3).max(120),
  bio: z.string().trim().min(20).max(1500),
  categories: z.array(agentCategorySchema).min(1).max(agentCategories.length),
  capabilities: z
    .array(z.object({
      category: agentCategorySchema,
      description: z.string().trim().min(10).max(500),
    }).strict())
    .min(1)
    .max(12),
  supportedCurrencies: z.array(mandateCurrencySchema).min(1).max(10),
  availability: z.enum(['available', 'busy']),
}).strict();

export const agentProfileCreateSchema = agentProfileFieldsSchema
  .superRefine((profile, context) => {
    if (new Set(profile.categories).size !== profile.categories.length) {
      context.addIssue({
        code: 'custom',
        path: ['categories'],
        message: 'Agent categories must be unique.',
      });
    }
    if (new Set(profile.supportedCurrencies).size !== profile.supportedCurrencies.length) {
      context.addIssue({
        code: 'custom',
        path: ['supportedCurrencies'],
        message: 'Supported currencies must be unique.',
      });
    }
    if (new Set(profile.capabilities.map(({ category }) => category)).size !== profile.capabilities.length) {
      context.addIssue({
        code: 'custom',
        path: ['capabilities'],
        message: 'Each capability category may only be listed once.',
      });
    }
    profile.capabilities.forEach(({ category }, index) => {
      if (!profile.categories.includes(category)) {
        context.addIssue({
          code: 'custom',
          path: ['capabilities', index, 'category'],
          message: 'Capability category must be included in the agent categories.',
        });
      }
    });
  });
export const agentProfileUpdateSchema = agentProfileFieldsSchema
  .partial()
  .refine((profile) => Object.keys(profile).length > 0, {
    message: 'At least one agent profile field must be provided.',
  });

export const agentProfileSchema = agentProfileFieldsSchema.extend({
  uid: z.string().min(1),
  displayName: z.string().min(1).max(100),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
});

export type AgentCategory = z.infer<typeof agentCategorySchema>;
export type AgentProfile = z.infer<typeof agentProfileSchema>;
export type AgentProfileCreateInput = z.infer<typeof agentProfileCreateSchema>;

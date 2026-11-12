import { z } from 'zod';

export const agentCategories = [
  'software',
  'design',
  'writing',
  'marketing',
  'consulting',
  'finance',
  'legal',
  'other',
] as const;

export const agentCategorySchema = z.enum(agentCategories);

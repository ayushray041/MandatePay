import { describe, expect, it } from 'vitest';
import {
  agentProfileCreateSchema,
  agentProfileUpdateSchema,
} from '@/models/agent';

const profile = {
  headline: 'Independent software engineer',
  bio: 'I build reliable backend services for small and growing teams.',
  categories: ['software'],
  capabilities: [{
    category: 'software',
    description: 'API development, integrations, and data workflows.',
  }],
  supportedCurrencies: ['USD', 'EUR'],
  availability: 'available',
};

describe('agent profile schemas', () => {
  it('accepts a complete capability profile without caller-supplied identity', () => {
    expect(agentProfileCreateSchema.safeParse(profile).success).toBe(true);
  });

  it('rejects forged identity, duplicate capabilities, and uncatalogued currencies', () => {
    expect(agentProfileCreateSchema.safeParse({ ...profile, uid: 'another-user' }).success).toBe(false);
    expect(agentProfileCreateSchema.safeParse({
      ...profile,
      categories: ['software', 'software'],
    }).success).toBe(false);
    expect(agentProfileCreateSchema.safeParse({
      ...profile,
      supportedCurrencies: ['ZZZ'],
    }).success).toBe(false);
  });

  it('requires capability categories to appear in the discoverable category list', () => {
    expect(agentProfileCreateSchema.safeParse({
      ...profile,
      capabilities: [{
        category: 'design',
        description: 'Brand and interface design for digital products.',
      }],
    }).success).toBe(false);
  });

  it('rejects empty or unknown-field profile updates', () => {
    expect(agentProfileUpdateSchema.safeParse({}).success).toBe(false);
    expect(agentProfileUpdateSchema.safeParse({ role: 'admin' }).success).toBe(false);
  });
});

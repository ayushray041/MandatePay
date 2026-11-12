import { z } from 'zod';

export const userRoleSchema = z.enum(['client', 'freelancer', 'admin']);
export const selfAssignableUserRoleSchema = z.enum(['client', 'freelancer']);

export const profileCreateSchema = z
  .object({
    displayName: z.string().trim().min(1).max(100),
    role: selfAssignableUserRoleSchema.default('client'),
  })
  .strict();

export const profileUpdateSchema = z
  .object({
    displayName: z.string().trim().min(1).max(100),
  })
  .strict()
  .partial()
  .refine((profile) => Object.keys(profile).length > 0, {
    message: 'At least one permitted profile field must be provided.',
  });

export const userProfileSchema = z.object({
  uid: z.string().min(1),
  email: z.string().email(),
  displayName: z.string().min(1).max(100),
  role: userRoleSchema,
  createdAt: z.unknown(),
  updatedAt: z.unknown(),
});

export type UserProfile = z.infer<typeof userProfileSchema>;

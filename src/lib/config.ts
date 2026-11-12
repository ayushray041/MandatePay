import { z } from 'zod';

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_BASE_URL: z.string().optional(),
  ALLOWED_ORIGINS: z.string().optional(),
  CORS_ALLOWED_ORIGINS: z.string().optional(),
}).passthrough();

const parsedEnvironment = environmentSchema.safeParse(process.env);

export const appEnvironment: z.infer<typeof environmentSchema> = parsedEnvironment.success
  ? parsedEnvironment.data
  : {
      NODE_ENV: 'development',
    };

export function normalizeOrigins(value?: string): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0)
    .map((origin) => (origin === '*' ? '*' : origin.replace(/\/+$/, '')))
    .filter((origin, index, items) => items.indexOf(origin) === index);
}

export function getAllowedOrigins(): string[] {
  const configuredOrigins = [
    ...normalizeOrigins(appEnvironment.ALLOWED_ORIGINS),
    ...normalizeOrigins(appEnvironment.CORS_ALLOWED_ORIGINS),
  ];

  if (appEnvironment.APP_BASE_URL) {
    try {
      configuredOrigins.push(new URL(appEnvironment.APP_BASE_URL).origin);
    } catch {
      // Ignore invalid APP_BASE_URL values, but preserve the rest of the configuration.
    }
  }

  return configuredOrigins.filter((origin, index, items) => items.indexOf(origin) === index);
}

export function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

export function isOriginAllowed(origin: string | null): boolean {
  if (!origin) {
    return true;
  }

  const allowedOrigins = getAllowedOrigins();
  if (allowedOrigins.includes('*')) {
    return true;
  }

  if (allowedOrigins.length === 0) {
    return true;
  }

  try {
    const normalizedOrigin = new URL(origin).origin;
    return allowedOrigins.includes(normalizedOrigin);
  } catch {
    return false;
  }
}

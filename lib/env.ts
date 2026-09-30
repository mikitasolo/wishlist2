/**
 * Environment variable validation schema
 * Validates all required environment variables at application startup
 */

/**
 * How outgoing email leaves the app (`EMAIL_TRANSPORT`):
 *  - `smtp` (the default): sent through the `SMTP_*` server.
 *  - `console`: printed to the server log and never sent — for local dev, so
 *    signing in doesn't need a real SMTP account. Refused in production.
 */
export const EMAIL_TRANSPORTS = ['smtp', 'console'] as const;
export type EmailTransport = (typeof EMAIL_TRANSPORTS)[number];

interface BaseEnv {
  // Database
  MONGODB_URI: string;

  // NextAuth
  NEXTAUTH_SECRET: string;
  NEXTAUTH_URL: string;

  // Email — the From address is needed whichever transport is active.
  EMAIL_FROM: string;

  // Migrations
  MIGRATION_SECRET: string;
}

/** `smtp` mode: every SMTP setting is required and present. */
export interface SmtpEmailEnv {
  EMAIL_TRANSPORT: 'smtp';
  SMTP_HOST: string;
  SMTP_PORT: string;
  SMTP_SECURE: string;
  SMTP_USER: string;
  SMTP_PASSWORD: string;
}

/** `console` mode: nothing is sent, so there is no SMTP config to read. */
export interface ConsoleEmailEnv {
  EMAIL_TRANSPORT: 'console';
}

/** Narrow on `EMAIL_TRANSPORT === 'smtp'` before reading any `SMTP_*` field. */
export type EnvSchema = BaseEnv & (SmtpEmailEnv | ConsoleEmailEnv);

/**
 * Required environment variables grouped by category
 */
const REQUIRED_ENV_VARS = {
  database: ['MONGODB_URI'],
  auth: ['NEXTAUTH_SECRET'],
  email: ['EMAIL_FROM'],
  migrations: ['MIGRATION_SECRET'],
} as const;

/** Only required when `EMAIL_TRANSPORT` is `smtp`. */
export const SMTP_ENV_VARS = [
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_SECURE',
  'SMTP_USER',
  'SMTP_PASSWORD',
] as const;

/**
 * The configured email transport. Unset (or empty) means `smtp`; anything else
 * that isn't a known transport throws rather than silently falling back.
 */
function resolveEmailTransport(): EmailTransport {
  const value = process.env.EMAIL_TRANSPORT;
  if (!value) return 'smtp';
  if ((EMAIL_TRANSPORTS as readonly string[]).includes(value)) return value as EmailTransport;
  throw new Error(
    `Invalid EMAIL_TRANSPORT "${value}": expected "smtp" (the default) or "console".`
  );
}

/**
 * Validate all required environment variables
 * Throws an error with detailed information if any are missing
 *
 * NOTE: This function should only be called server-side.
 * Environment variables are not available in client components unless prefixed with NEXT_PUBLIC_
 */
export function validateEnvVars(): void {
  // Prevent accidental client-side usage
  if (typeof window !== 'undefined') {
    throw new Error(
      'validateEnvVars() should only be called server-side. ' +
        'Environment variables are not available in client components.'
    );
  }

  const transport = resolveEmailTransport();

  // The console transport drops every email, sign-in links included. A
  // production deploy configured that way would look healthy while nobody can
  // sign in, so refuse to start instead.
  if (transport === 'console' && process.env.VERCEL_ENV === 'production') {
    throw new Error(
      'EMAIL_TRANSPORT=console is not allowed in production (VERCEL_ENV=production): ' +
        'it prints emails to the log instead of sending them, so nobody could sign in. ' +
        'Unset EMAIL_TRANSPORT (or set it to "smtp") and configure the SMTP_* variables.'
    );
  }

  const missing: Record<string, string[]> = {};

  const required: Record<string, readonly string[]> = {
    ...REQUIRED_ENV_VARS,
    email:
      transport === 'smtp'
        ? [...SMTP_ENV_VARS, ...REQUIRED_ENV_VARS.email]
        : REQUIRED_ENV_VARS.email,
  };

  // Check each category
  for (const [category, vars] of Object.entries(required)) {
    const categoryMissing: string[] = [];

    for (const envVar of vars) {
      if (!process.env[envVar]) {
        categoryMissing.push(envVar);
      }
    }

    if (categoryMissing.length > 0) {
      missing[category] = categoryMissing;
    }
  }

  // NEXTAUTH_URL can be derived from VERCEL_URL on Vercel deployments
  if (!process.env.NEXTAUTH_URL && !process.env.VERCEL_URL) {
    if (!missing['auth']) missing['auth'] = [];
    missing['auth'].push('NEXTAUTH_URL (or deploy on Vercel where VERCEL_URL is automatic)');
  }

  if (Object.keys(missing).length > 0) {
    const errorMessages = Object.entries(missing).map(([category, vars]) => {
      return `  ${category.toUpperCase()}:\n${vars.map((v) => `    - ${v}`).join('\n')}`;
    });

    throw new Error(
      `Missing required environment variables:\n\n${errorMessages.join('\n\n')}\n\n` +
        `Please set all required environment variables in your Vercel project settings or .env.local file.\n` +
        (transport === 'smtp'
          ? `For local development without SMTP, set EMAIL_TRANSPORT=console.\n`
          : '') +
        `See README.md for setup instructions.`
    );
  }
}

/**
 * Get validated environment variables
 * Throws an error if any required variables are missing
 *
 * NOTE: This function should only be called server-side.
 * Environment variables are not available in client components unless prefixed with NEXT_PUBLIC_
 */
export function getEnvVars(): EnvSchema {
  // Prevent accidental client-side usage
  if (typeof window !== 'undefined') {
    throw new Error(
      'getEnvVars() should only be called server-side. ' +
        'Environment variables are not available in client components.'
    );
  }

  validateEnvVars();

  const nextAuthUrl = process.env.NEXTAUTH_URL || `https://${process.env.VERCEL_URL}`;

  const base: BaseEnv = {
    // Database
    MONGODB_URI: process.env.MONGODB_URI!,

    // NextAuth
    NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET!,
    NEXTAUTH_URL: nextAuthUrl,

    // Email
    EMAIL_FROM: process.env.EMAIL_FROM!,

    // Migrations
    MIGRATION_SECRET: process.env.MIGRATION_SECRET!,
  };

  if (resolveEmailTransport() === 'console') {
    return { ...base, EMAIL_TRANSPORT: 'console' };
  }

  return {
    ...base,
    EMAIL_TRANSPORT: 'smtp',
    SMTP_HOST: process.env.SMTP_HOST!,
    SMTP_PORT: process.env.SMTP_PORT!,
    SMTP_SECURE: process.env.SMTP_SECURE!,
    SMTP_USER: process.env.SMTP_USER!,
    SMTP_PASSWORD: process.env.SMTP_PASSWORD!,
  };
}

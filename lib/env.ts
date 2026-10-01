/**
 * Environment variable validation schema
 * Validates all required environment variables at application startup
 */

/**
 * How outgoing email leaves the app (`EMAIL_TRANSPORT`):
 *  - `smtp` (the default): sent through the `SMTP_*` server.
 *  - `console`: printed to the server log and never sent — for local dev, so
 *    signing in doesn't need a real SMTP account. Only allowed with
 *    `VERCEL_ENV` unset (local dev, CI, E2E) or `development`.
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
 * Cloudflare Turnstile on the sign-in form (`lib/turnstile.ts`): all or nothing.
 * Both set turns it on, neither leaves it off (local dev, CI, E2E). Exactly one
 * is refused by `validateEnvVars`: a secret without a site key would refuse
 * every sign-in (no widget, so no token), and a site key without a secret would
 * show a widget that nothing checks.
 */
export const TURNSTILE_ENV_VARS = [
  'NEXT_PUBLIC_TURNSTILE_SITE_KEY',
  'TURNSTILE_SECRET_KEY',
] as const;

export interface TurnstileKeys {
  siteKey: string;
  secretKey: string;
}

/**
 * The Turnstile keys, or `null` while Turnstile is off. Read at call time, by a
 * computed name, so Next never inlines the public key at build time: the sign-in
 * page renders the widget and the server action checks its token from one read
 * of the same environment. `validateEnvVars` refuses a half config at startup;
 * should one get here anyway (a caller that skipped validation), it reads as
 * off, rather than as a check nobody can pass or a widget nobody checks.
 */
export function getTurnstileKeys(): TurnstileKeys | null {
  const [siteKey, secretKey] = TURNSTILE_ENV_VARS.map((name) => process.env[name]);
  return siteKey && secretKey ? { siteKey, secretKey } : null;
}

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

  // The console transport prints every email, sign-in links included, to the
  // log instead of sending it. On a deployment that means nobody receives a
  // sign-in email, and every magic link sits in the runtime logs as a working
  // credential for anyone who can read them, so refuse to start instead.
  // An allow-list: only unset (local dev, CI, E2E) or `development` passes, so
  // `preview`, `production`, an empty value and anything Vercel adds later fail.
  const vercelEnv = process.env.VERCEL_ENV;
  if (transport === 'console' && vercelEnv !== undefined && vercelEnv !== 'development') {
    throw new Error(
      `EMAIL_TRANSPORT=console is not allowed with VERCEL_ENV="${vercelEnv}", only with ` +
        'VERCEL_ENV unset (local dev) or "development": it prints emails, sign-in links ' +
        'included, to the log instead of sending them, so nobody could sign in and anyone ' +
        'who can read the logs could sign in as the recipient. ' +
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

  // Turnstile is optional, but once one of its keys is set the other is required.
  // Only the names are reported: the secret's value must never reach a log.
  const turnstileSet = TURNSTILE_ENV_VARS.filter((name) => process.env[name]);
  if (turnstileSet.length === 1) {
    const [set] = turnstileSet;
    const unset = TURNSTILE_ENV_VARS.find((name) => name !== set)!;
    missing['turnstile'] = [
      `${unset} (${set} is set: set both to turn Turnstile on, or neither to leave it off)`,
    ];
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

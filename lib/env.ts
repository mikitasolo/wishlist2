/**
 * Environment variable validation schema
 * Validates all required environment variables at application startup
 */

export interface EnvSchema {
  // Database
  MONGODB_URI: string;

  // NextAuth
  NEXTAUTH_SECRET: string;
  NEXTAUTH_URL: string;

  // Email (SMTP)
  SMTP_HOST: string;
  SMTP_PORT: string;
  SMTP_SECURE: string;
  SMTP_USER: string;
  SMTP_PASSWORD: string;
  EMAIL_FROM: string;

  // Migrations
  MIGRATION_SECRET: string;
}

/**
 * Required environment variables grouped by category
 */
const REQUIRED_ENV_VARS = {
  database: ['MONGODB_URI'],
  auth: ['NEXTAUTH_SECRET'],
  email: ['SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASSWORD', 'EMAIL_FROM'],
  migrations: ['MIGRATION_SECRET'],
} as const;

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

  const missing: Record<string, string[]> = {};

  // Check each category
  for (const [category, vars] of Object.entries(REQUIRED_ENV_VARS)) {
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

  return {
    // Database
    MONGODB_URI: process.env.MONGODB_URI!,

    // NextAuth
    NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET!,
    NEXTAUTH_URL: nextAuthUrl,

    // Email
    SMTP_HOST: process.env.SMTP_HOST!,
    SMTP_PORT: process.env.SMTP_PORT!,
    SMTP_SECURE: process.env.SMTP_SECURE!,
    SMTP_USER: process.env.SMTP_USER!,
    SMTP_PASSWORD: process.env.SMTP_PASSWORD!,
    EMAIL_FROM: process.env.EMAIL_FROM!,

    // Migrations
    MIGRATION_SECRET: process.env.MIGRATION_SECRET!,
  };
}

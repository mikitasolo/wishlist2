import 'next-auth';

declare module 'next-auth' {
  // Built by sessionPayload (lib/utils/sessionPayload.ts), an explicit
  // allowlist: add a field there together with what reads it.
  interface Session {
    user: {
      id: string;
      email: string;
      username?: string;
      /** The DB row's `name`, which only an identity provider sets (the magic link never does). */
      name?: string | null;
      image?: string;
      defaultCurrency?: string;
      /** Whether they've answered the dashboard's currency prompt (`User.currencyChosenAt`). */
      currencyChosen?: boolean;
      /**
       * Whether the account's first verified sign-in is under 24h old, which
       * picks the stricter rate-limit tier (`enforce`'s `newAccount`, WIS-42).
       */
      newAccount?: boolean;
    };
  }
}

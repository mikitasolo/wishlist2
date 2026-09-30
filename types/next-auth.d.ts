import 'next-auth';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      email: string;
      username?: string;
      /** Auth.js passes the adapter user through, so this is the DB row's `name` if it has one. */
      name?: string | null;
      image?: string;
      defaultCurrency?: string;
    };
  }
}

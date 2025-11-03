'use client';

import { signIn, signOut, useSession } from 'next-auth/react';

export default function AuthButton() {
  const { data: session, status } = useSession();

  if (status === 'loading') {
    return (
      <div className="h-10 w-24 bg-gray-200 rounded-lg animate-pulse"></div>
    );
  }

  if (session?.user) {
    return (
      <div className="flex items-center gap-4">
        <span className="text-sm text-gray-700">
          {session.user.email}
          {session.user.role === 'admin' && (
            <span className="ml-2 px-2 py-1 bg-primary-600 text-white text-xs rounded-full">
              Admin
            </span>
          )}
        </span>
        <button
          onClick={() => signOut()}
          className="bg-gray-200 text-gray-700 px-4 py-2 rounded-lg font-medium hover:bg-gray-300 transition-colors"
        >
          Sign Out
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => signIn()}
      className="bg-primary-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-primary-700 transition-colors"
    >
      Sign In
    </button>
  );
}


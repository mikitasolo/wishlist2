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
      <div className="flex flex-col sm:flex-row items-center gap-2 sm:gap-4">
        <div className="text-center sm:text-left">
          <span className="text-xs sm:text-sm text-gray-700 block sm:inline">
            {session.user.email}
          </span>
          {session.user.role === 'admin' && (
            <span className="ml-0 sm:ml-2 mt-1 sm:mt-0 inline-block px-2 py-1 bg-primary-600 text-white text-xs rounded-full">
              Admin
            </span>
          )}
        </div>
        <button
          onClick={() => signOut()}
          className="bg-gray-200 text-gray-700 px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg text-xs sm:text-sm font-medium hover:bg-gray-300 transition-colors cursor-pointer w-full sm:w-auto"
        >
          Sign Out
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => signIn()}
      className="bg-primary-600 text-white px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg text-xs sm:text-sm font-medium hover:bg-primary-700 transition-colors cursor-pointer w-full sm:w-auto"
    >
      Sign In
    </button>
  );
}


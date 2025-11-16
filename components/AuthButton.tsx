'use client';

import { useState } from 'react';
import { signIn, signOut, useSession } from 'next-auth/react';

export default function AuthButton() {
  const { data: session, status } = useSession();
  const [isHovered, setIsHovered] = useState(false);

  if (status === 'loading') {
    return <div className="h-10 w-10 bg-gray-200 rounded-full animate-pulse"></div>;
  }

  if (session?.user) {
    return (
      <div className="relative">
        {/* User Icon Button */}
        <button
          onClick={() => setIsHovered(!isHovered)}
          className="w-10 h-10 rounded-full bg-gray-200 text-gray-700 flex items-center justify-center hover:bg-gray-300 transition-colors cursor-pointer text-xl"
          aria-label="User menu"
          aria-expanded={isHovered}
        >
          👤
        </button>

        {/* Dropdown Menu */}
        {isHovered && (
          <>
            {/* Backdrop - closes menu when clicking outside */}
            <div className="fixed inset-0 z-40" onClick={() => setIsHovered(false)} />
            <div className="absolute right-0 mt-2 w-64 bg-white rounded-lg shadow-lg border border-gray-200 py-2 z-50">
              <div className="px-4 py-2 border-b border-gray-200">
                <p className="text-sm text-gray-700 break-words">{session.user.email}</p>
              </div>
              <button
                onClick={() => signOut()}
                className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 transition-colors cursor-pointer"
              >
                Sign Out
              </button>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <button
      onClick={() => signIn()}
      className="h-10 bg-primary-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary-700 transition-colors cursor-pointer w-full sm:w-auto"
    >
      Sign In
    </button>
  );
}

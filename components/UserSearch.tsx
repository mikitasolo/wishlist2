'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useToast } from './ToastProvider';

export default function UserSearch() {
  const router = useRouter();
  const { data: session } = useSession();
  const { showToast } = useToast();
  const [searchEmail, setSearchEmail] = useState('');
  const [isSearching, setIsSearching] = useState(false);

  const handleSearchUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchEmail.trim()) return;

    setIsSearching(true);
    try {
      const response = await fetch(
        `/api/users/search?email=${encodeURIComponent(searchEmail.trim())}`,
        {
          cache: 'no-store',
        }
      );
      const result = await response.json();

      if (result.success && result.data) {
        // If searching for own email, stay on home page
        if (session?.user?.id === result.data._id) {
          showToast('You are already on your home page', 'info');
          setSearchEmail('');
          return;
        }
        router.push(`/users/${result.data._id}`);
        setSearchEmail('');
      } else {
        showToast('User not found', 'error');
      }
    } catch (error) {
      console.error('Error searching for user:', error);
      showToast('Failed to search for user', 'error');
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <form onSubmit={handleSearchUser} className="flex gap-2">
      <input
        type="email"
        value={searchEmail}
        onChange={(e) => setSearchEmail(e.target.value)}
        placeholder="Search user by email..."
        className="h-10 flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none"
        disabled={isSearching}
      />
      <button
        type="submit"
        disabled={isSearching || !searchEmail.trim()}
        className="h-10 px-4 py-2 text-sm bg-primary-600 text-white rounded-lg font-medium hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap"
      >
        {isSearching ? 'Searching...' : 'Search'}
      </button>
    </form>
  );
}

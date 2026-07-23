'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useToast } from './ToastProvider';
import Icon from './Icon';

export default function UserSearch() {
  const router = useRouter();
  const { data: session } = useSession();
  const { showToast } = useToast();
  const [searchTerm, setSearchTerm] = useState('');
  const [isSearching, setIsSearching] = useState(false);

  const handleSearchUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchTerm.trim()) return;

    setIsSearching(true);
    try {
      const response = await fetch(
        `/api/users/search?username=${encodeURIComponent(searchTerm.trim())}`,
        {
          cache: 'no-store',
        }
      );
      const result = await response.json();

      if (result.success && result.data) {
        // If searching for yourself, stay on the home page
        if (session?.user?.id === result.data._id) {
          showToast('That’s you — you’re already home', 'info');
          setSearchTerm('');
          return;
        }
        router.push(`/users/${result.data.username}`);
        setSearchTerm('');
      } else {
        showToast('No one found with that username', 'error');
      }
    } catch (error) {
      console.error('Error searching for user:', error);
      showToast('Failed to search for user', 'error');
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <form
      onSubmit={handleSearchUser}
      className="flex w-full items-center gap-2 rounded-full border border-border-strong bg-surface pl-4 pr-1.5 shadow-xs focus-within:border-border-strong"
      autoComplete="off"
    >
      <Icon name="search" size={17} className="flex-shrink-0 text-muted-foreground" />
      <input
        type="text"
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
        placeholder="Find people by username…"
        className="h-11 min-w-0 flex-1 border-0 bg-transparent text-[15px] outline-none focus-visible:outline-none"
        disabled={isSearching}
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
      />
      <button
        type="submit"
        disabled={isSearching || !searchTerm.trim()}
        className="h-8 flex-shrink-0 rounded-full bg-primary-600 px-4 text-[13px] font-semibold text-white transition-colors hover:bg-primary-500 disabled:opacity-45 disabled:hover:bg-primary-600"
      >
        {isSearching ? 'Searching…' : 'Search'}
      </button>
    </form>
  );
}

import type { Metadata } from 'next';
import PracticeList from '@/components/PracticeList';

// The guided walkthrough's practice list (WIS-436): a made-up friend's list.
export const metadata: Metadata = {
  title: 'Practice list',
  robots: { index: false, follow: false },
};

export default function PracticeFriendListPage() {
  return <PracticeList view="friend" />;
}

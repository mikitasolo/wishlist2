import type { Metadata } from 'next';
import PracticeList from '@/components/PracticeList';

// The guided walkthrough's practice list (WIS-436): one of your own, made up.
export const metadata: Metadata = {
  title: 'Practice list',
  robots: { index: false, follow: false },
};

export default function PracticeOwnListPage() {
  return <PracticeList view="owner" />;
}

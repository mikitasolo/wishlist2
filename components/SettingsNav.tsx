import { BOOKMARKLET_SETTINGS_ID } from '@/lib/utils/tourSteps';

/** The Settings page's sections, in page order: each `id` is on that section's element. */
export const SETTINGS_SECTIONS = [
  { id: 'profile', label: 'Public profile' },
  { id: 'privacy', label: 'Privacy' },
  { id: 'groups', label: 'Groups' },
  { id: 'notifications', label: 'Notifications' },
  { id: BOOKMARKLET_SETTINGS_ID, label: 'Bookmarklet' },
  { id: 'preferences', label: 'Preferences' },
  { id: 'account', label: 'Account' },
] as const;

/**
 * Jump links to the Settings sections, sticky beside the page from `lg` up. At
 * phone and tablet widths the page is one short column and the nav is hidden.
 * Plain anchors: the sections' own `scroll-mt` clears the sticky app header.
 */
export default function SettingsNav() {
  return (
    <nav aria-label="Settings sections" className="sticky top-24 hidden self-start lg:block">
      <ul className="space-y-0.5">
        {SETTINGS_SECTIONS.map((section) => (
          <li key={section.id}>
            <a
              href={`#${section.id}`}
              className="block rounded-lg px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
            >
              {section.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import Button from './Button';
import Icon, { type IconName } from './Icon';
import Menu, { type MenuItem } from './Menu';
import { buttonClassName, CONTROL_ICON_SIZE } from './buttonStyles';
import { useToast } from './ToastProvider';
import {
  canUseShareSheet,
  CREATE_SHARE_LINK_HINT,
  LINK_AUDIENCE_TEXT,
  linkAudience,
  resolveShareUrl,
  shareLinksAudienceText,
  shareOrCopy,
} from '@/lib/utils/shareLink';
import { getVisibility, visibilityMeta, type Visibility } from '@/lib/utils/visibility';

/** What a list's owners are told about its link, and where they invite people. */
export interface ShareOwnerInfo {
  visibility: Visibility;
  archived?: boolean;
  /** Takes the owner to where they invite people by username. */
  onInvite: () => void;
  /**
   * Takes the owner to the list's share links (People's Share links section,
   * or the New link dialog when there are none). Offered only when set.
   */
  onShareLinks?: () => void;
  /** How many of the list's share links work now (WIS-335); unset until they've been read. */
  liveLinkCount?: number;
}

interface ShareButtonProps {
  /** The link to share, a path or a full URL. Defaults to the current page's URL. */
  url?: string;
  /** The title the share sheet offers with the link (a list's name, a profile's handle). */
  title?: string;
  label?: string;
  /**
   * `pill` (the default) is the `sm` pill of a page's header;
   * `button` is a secondary `Button`, to sit beside other buttons (an empty
   * list's Add your first item).
   */
  variant?: 'pill' | 'button';
  className?: string;
  /**
   * Set for a list's owners: Share opens a popover that says who the link opens
   * for (`linkAudience`) and offers Copy link, Share on a touch device, and
   * inviting people. Everyone else gets the plain share, with no popover.
   */
  owner?: ShareOwnerInfo;
}

/** Re-read whether to offer the share sheet when the main pointer changes (a tablet's keyboard). */
function subscribeToPointer(onChange: () => void): () => void {
  if (typeof window.matchMedia !== 'function') return () => {};
  const query = window.matchMedia('(pointer: coarse)');
  query.addEventListener?.('change', onChange);
  return () => query.removeEventListener?.('change', onChange);
}

/** The server can't know the device: it renders no Share, and the browser adds it once hydrated. */
const noShareSheetOnServer = () => false;

/**
 * Shares a list's or a profile's link. On a touch device with the Web Share
 * API it opens the phone's share sheet; elsewhere (or if the sheet fails) it
 * copies the link, confirmed with a toast and a brief check mark. Closing the
 * sheet says nothing. A list's owners get a popover first (`owner`), since
 * they're the ones who need telling that a friends-only or invite-only link
 * won't open for just anyone.
 */
export default function ShareButton({
  url,
  title,
  label = 'Share',
  variant = 'pill',
  className = '',
  owner,
}: ShareButtonProps) {
  const { showToast } = useToast();
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(copiedTimer.current), []);
  // Only the owner's popover renders from it; the plain share decides on click.
  const sheetAvailable = useSyncExternalStore(
    subscribeToPointer,
    canUseShareSheet,
    noShareSheetOnServer
  );

  async function share(sheet: boolean) {
    const outcome = await shareOrCopy({ url: resolveShareUrl(url), title }, { sheet });
    if (outcome === 'copied') {
      setCopied(true);
      showToast('Link copied to clipboard', 'success');
      clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), 2000);
    } else if (outcome === 'failed') {
      showToast('Could not copy the link', 'error');
    } else if (outcome === 'unshared') {
      showToast('Could not share the link', 'error');
    }
  }

  const size = variant === 'pill' ? 'sm' : 'lg';
  const shape = variant === 'pill' ? 'pill' : 'rounded';
  const icon: IconName = copied ? 'check' : 'link';
  const text = copied ? 'Copied' : label;

  if (!owner) {
    // A page header's `sm` pill, or a full-size secondary button.
    return (
      <Button
        variant="secondary"
        size={size}
        shape={shape}
        icon={icon}
        onClick={() => share(canUseShareSheet())}
        className={className}
      >
        {text}
      </Button>
    );
  }

  const audience = linkAudience(owner);
  const items: MenuItem[] = [
    { label: 'Copy link', icon: 'link', onSelect: () => share(false) },
    ...(sheetAvailable
      ? [{ label: 'Share', icon: 'share' as const, onSelect: () => share(true) }]
      : []),
    {
      label: 'Invite people to reserve gifts',
      icon: 'user-plus',
      onSelect: owner.onInvite,
      separated: true,
    },
    ...(owner.onShareLinks
      ? [
          {
            label: 'Share links',
            icon: 'link' as const,
            onSelect: owner.onShareLinks,
            separated: true,
          },
        ]
      : []),
  ];
  // Who else gets in: anyone with a live share link, or, on a list that isn't
  // Public and has none, how to let them.
  const linksLine =
    shareLinksAudienceText(owner.liveLinkCount ?? 0) ??
    (owner.onShareLinks &&
    owner.liveLinkCount === 0 &&
    audience !== 'anyone' &&
    audience !== 'owners'
      ? CREATE_SHARE_LINK_HINT
      : null);

  return (
    <Menu
      label={text}
      items={items}
      trigger={() => (
        <>
          <Icon name={icon} size={CONTROL_ICON_SIZE[size]} className="flex-shrink-0" />
          {text}
        </>
      )}
      triggerClassName={`${buttonClassName({ variant: 'secondary', size, shape })} ${className}`}
      header={
        <p className="flex items-start gap-2 pl-0.5 text-sm text-foreground">
          <Icon
            name={audience === 'owners' ? 'archive' : visibilityMeta[getVisibility(owner)].icon}
            size={16}
            className="mt-0.5 flex-shrink-0 text-muted-foreground"
          />
          <span>
            {LINK_AUDIENCE_TEXT[audience]}
            {linksLine && <span className="mt-1 block text-muted-foreground">{linksLine}</span>}
          </span>
        </p>
      }
      headerDescribesMenu
      menuWidthClassName="w-72"
    />
  );
}

'use client';

import { useId, useImperativeHandle, useRef, useState, type Ref } from 'react';
import Badge from '@/components/Badge';
import Button from '@/components/Button';
import ConfirmDialog from '@/components/ConfirmDialog';
import LoadError from '@/components/LoadError';
import Menu, { type MenuItem } from '@/components/Menu';
import Panel, { PanelRow } from '@/components/Panel';
import { Skeleton } from '@/components/Skeleton';
import ShareLinkDialog, { SHARE_LINK_LEVEL_LABELS } from '@/components/ShareLinkDialog';
import ShareLinkQrDialog from '@/components/ShareLinkQrDialog';
import { iconButtonClassName } from '@/components/buttonStyles';
import { useToast } from '@/components/ToastProvider';
import {
  isLinkLive,
  shareLinkUrl,
  type ShareLinkRow,
  type ShareLinksControl,
} from '@/lib/hooks/useShareLinks';
import { formatLinkExpiry } from '@/lib/utils/shareLinkExpiry';
import type { Occasion } from '@/lib/utils/occasion';
import { plural } from '@/lib/utils/plural';
import type { Visibility } from '@/lib/utils/visibility';

/** What the page can ask of the section: the Share menu's Share links goes here. */
export interface ShareLinksSectionHandle {
  /** Opens New link (not on an archived list). */
  openNewLink: () => void;
  /** Scrolls the section into view and moves focus to its heading. */
  reveal: () => void;
}

/** The id the section is rendered with, for a link or a scroll to it. */
export const SHARE_LINKS_SECTION_ID = 'share-links';

export const REVOKE_LINK_MESSAGE =
  'The link will stop working. People who already joined stay on the list. Chats that already show its preview keep it.';

export const EMPTY_SHARE_LINKS_TEXT =
  'No share links yet. A share link opens this list for anyone who has it, whatever its visibility.';

/** "Revoke "Family chat"?", or, for a link without a label, "Revoke this link?". */
export function revokeLinkTitle(label: string | null): string {
  return label ? `Revoke “${label}”?` : 'Revoke this link?';
}

const linkName = (link: ShareLinkRow) => link.label || 'Untitled link';

const ROW_MENU_TRIGGER = iconButtonClassName({ variant: 'ghost', size: 'sm' });

interface ShareLinksSectionProps {
  control: ShareLinksControl;
  /** The list's name, for the QR code's print card and file names. */
  listName: string;
  archived: boolean;
  visibility: Visibility;
  occasion?: Occasion | null;
  ref?: Ref<ShareLinksSectionHandle>;
  /** The moment rows count expiry from (tests); now by default. */
  now?: Date;
}

/**
 * The Share links section of a list's People tab, for its owners (WIS-335):
 * each link with its label, level (Can view / Can join), expiry, how many
 * joined through it (Join links), and Copy link, QR code (WIS-328), Edit,
 * Preview as visitor and Revoke. New link opens `ShareLinkDialog`; its Create
 * for print goes on to the new link's QR code. An archived list's links are
 * dead until it's unarchived, so it offers only Edit and Revoke, and no New
 * link or QR code.
 * A failed read shows `LoadError`, never an empty section.
 */
export default function ShareLinksSection({
  control,
  listName,
  archived,
  visibility,
  occasion,
  ref,
  now: fixedNow,
}: ShareLinksSectionProps) {
  const { showToast } = useToast();
  const headingId = useId();
  const sectionRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [dialog, setDialog] = useState<
    | { mode: 'create' }
    | { mode: 'edit'; link: ShareLinkRow }
    | { mode: 'qr'; link: ShareLinkRow & { token: string } }
    | null
  >(null);
  const [revoking, setRevoking] = useState<ShareLinkRow | null>(null);
  const now = fixedNow ?? new Date();

  useImperativeHandle(
    ref,
    () => ({
      openNewLink: () => {
        if (!archived) setDialog({ mode: 'create' });
      },
      reveal: () => {
        sectionRef.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
        headingRef.current?.focus({ preventScroll: true });
      },
    }),
    [archived]
  );

  async function copyLink(link: ShareLinkRow) {
    if (!link.token) return;
    try {
      await navigator.clipboard.writeText(
        new URL(shareLinkUrl(link.token), window.location.href).href
      );
      showToast('Link copied to clipboard', 'success');
    } catch {
      showToast('Could not copy the link', 'error');
    }
  }

  const rowItems = (link: ShareLinkRow): MenuItem[] => [
    ...(!archived && link.token && isLinkLive(link, now)
      ? [
          {
            label: 'QR code',
            icon: 'qr-code' as const,
            onSelect: () => setDialog({ mode: 'qr', link: { ...link, token: link.token! } }),
          },
        ]
      : []),
    { label: 'Edit', icon: 'edit', onSelect: () => setDialog({ mode: 'edit', link }) },
    ...(!archived && link.token && isLinkLive(link, now)
      ? [
          {
            label: 'Preview as visitor',
            icon: 'external-link' as const,
            href: `${shareLinkUrl(link.token)}?as=visitor`,
            external: true,
          },
        ]
      : []),
    {
      label: 'Revoke',
      icon: 'trash',
      danger: true,
      separated: true,
      onSelect: () => setRevoking(link),
    },
  ];

  const header = (
    <PanelRow className="flex flex-wrap items-start justify-between gap-3 py-4">
      <div className="min-w-0 flex-1">
        <h2
          id={headingId}
          ref={headingRef}
          tabIndex={-1}
          className="text-lg font-semibold text-foreground"
        >
          Share links
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Secret links that open this list for anyone who has them.
        </p>
      </div>
      {!archived && control.read === 'loaded' && (
        <Button size="sm" icon="plus" onClick={() => setDialog({ mode: 'create' })}>
          New link
        </Button>
      )}
    </PanelRow>
  );

  return (
    <section ref={sectionRef} id={SHARE_LINKS_SECTION_ID} aria-labelledby={headingId}>
      {control.read === 'failed' ? (
        <LoadError title="Couldn’t load this list’s share links" onRetry={control.retry} />
      ) : (
        <Panel variant="list" as="div">
          {header}
          {control.read === 'loading' ? (
            <ShareLinkRowSkeleton />
          ) : control.links.length === 0 ? (
            <PanelRow>
              <p className="text-sm text-muted-foreground">{EMPTY_SHARE_LINKS_TEXT}</p>
            </PanelRow>
          ) : (
            control.links.map((link) => {
              const expiry = formatLinkExpiry(link, now);
              const meta = [
                expiry,
                link.level === 'join'
                  ? `${plural(link.joinedCount, 'person', 'people')} joined`
                  : null,
              ].filter(Boolean);
              return (
                <PanelRow key={link._id} className="flex items-center gap-3 py-4">
                  <div className="min-w-0 flex-1">
                    {/* The label gets the row's width; the level and the rest under it. */}
                    <p className="truncate font-medium text-foreground">{linkName(link)}</p>
                    <div className="mt-1 flex min-w-0 items-center gap-2">
                      <Badge size="sm" tone={link.level === 'join' ? 'info' : 'neutral'}>
                        {SHARE_LINK_LEVEL_LABELS[link.level]}
                      </Badge>
                      {meta.length > 0 && (
                        <p className="truncate text-xs text-muted-foreground">{meta.join(' · ')}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {!archived && link.token && (
                      <Button
                        variant="secondary"
                        size="sm"
                        icon="link"
                        onClick={() => copyLink(link)}
                        aria-label={`Copy link ${linkName(link)}`}
                      >
                        {/* Just the icon on a phone, so the label keeps its room. */}
                        <span className="max-sm:sr-only">Copy link</span>
                      </Button>
                    )}
                    <Menu
                      label={`Actions for ${linkName(link)}`}
                      items={rowItems(link)}
                      triggerClassName={ROW_MENU_TRIGGER}
                    />
                  </div>
                </PanelRow>
              );
            })
          )}
        </Panel>
      )}

      {dialog?.mode === 'create' && (
        <ShareLinkDialog
          mode="create"
          visibility={visibility}
          occasion={occasion}
          // Create for print has moved on to the QR code by the time this closes.
          onClose={() => setDialog((d) => (d?.mode === 'create' ? null : d))}
          onCreate={async (input, options) => {
            const created = await control.create(input);
            if (created?.token && options?.forPrint) {
              setDialog({ mode: 'qr', link: { ...created, token: created.token } });
            }
            return !!created;
          }}
        />
      )}
      {dialog?.mode === 'qr' && (
        <ShareLinkQrDialog
          link={dialog.link}
          listName={listName}
          occasion={occasion}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.mode === 'edit' && (
        <ShareLinkDialog
          mode="edit"
          link={dialog.link}
          visibility={visibility}
          occasion={occasion}
          onClose={() => setDialog(null)}
          onUpdate={control.update}
        />
      )}
      {revoking && (
        <ConfirmDialog
          isOpen
          title={revokeLinkTitle(revoking.label)}
          message={REVOKE_LINK_MESSAGE}
          onConfirm={async () => {
            await control.revoke(revoking._id);
            setRevoking(null);
          }}
          onCancel={() => setRevoking(null)}
          confirmText="Revoke link"
          pendingText="Revoking…"
          cancelText="Cancel"
          type="danger"
          icon="link-off"
        />
      )}
    </section>
  );
}

/** A link row while the list loads: the label and badge line over the meta line. */
function ShareLinkRowSkeleton() {
  return (
    <div className="flex items-center gap-3 px-5 py-4 sm:px-6">
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-48 max-w-full" />
        <Skeleton className="h-3 w-24" />
      </div>
      <Skeleton className="h-9 w-24 rounded-xl" />
    </div>
  );
}

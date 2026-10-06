'use client';

import { useId, useMemo } from 'react';
import { createPortal } from 'react-dom';
import BaseModal from '@/components/BaseModal';
import Badge from '@/components/Badge';
import Button from '@/components/Button';
import Callout from '@/components/Callout';
import Field from '@/components/Field';
import Input from '@/components/Input';
import { SHARE_LINK_LEVEL_LABELS } from '@/components/ShareLinkDialog';
import { useToast } from '@/components/ToastProvider';
import { shareLinkUrl, type ShareLinkRow } from '@/lib/hooks/useShareLinks';
import { useLocalToday } from '@/lib/hooks/useLocalToday';
import { useShareSheetAvailable } from '@/lib/hooks/useShareSheetAvailable';
import { occasionDetails, type Occasion } from '@/lib/utils/occasion';
import { qrFileName, qrShape, qrSvgFile, type QrShape } from '@/lib/utils/qrCode';
import { shareOrCopy } from '@/lib/utils/shareLink';
import { formatLinkExpiry } from '@/lib/utils/shareLinkExpiry';
import type { ShareLinkLevel } from '@/lib/utils/shareLinkFields';

/** What the link lets people do, and that what's been handed out can't be taken back. */
export const LINK_WARNINGS: Record<ShareLinkLevel, string> = {
  view: 'Anyone with this link or its QR code can see the list until you revoke it. Printed cards can’t be recalled.',
  join: 'Anyone with this link or its QR code can join the list until you revoke it. Printed cards can’t be recalled.',
};

/** The printed card's line under the code. */
export const PRINT_CARD_CALLS: Record<ShareLinkLevel, string> = {
  view: 'Scan to see the wishlist',
  join: 'Scan to join the wishlist',
};

/** The class the print card's root carries: while it's mounted, printing prints only it. */
export const PRINT_CARD_CLASS = 'qr-print-root';

/** The PNG's side is at least this many pixels, whole pixels per module. */
const PNG_MIN_PX = 1024;

interface ShareLinkDetailsDialogProps {
  /** A live link with its token: the section opens this for no other. */
  link: ShareLinkRow & { token: string };
  listName: string;
  occasion?: Occasion | null;
  onClose: () => void;
  /** The moment the expiry is read at (tests); now by default. */
  now?: Date;
}

/**
 * A share link, for a list's owners (WIS-341): everything to hand it out in
 * one place, opened from its row's Share and straight after New link. Its full
 * `/l/<token>` URL with Copy link (and Share on a phone, the share sheet), and
 * its QR code (WIS-328), drawn in the browser so the token never goes to a
 * third party, with Download PNG, Download SVG and Print card. The card (the
 * list's name, occasion and the code) is mounted for as long as the dialog is
 * open and is all a print shows. Never for the list's own URL.
 */
export default function ShareLinkDetailsDialog({
  link,
  listName,
  occasion,
  onClose,
  now,
}: ShareLinkDetailsDialogProps) {
  const { showToast } = useToast();
  const titleId = useId();
  const today = useLocalToday();
  const sheetAvailable = useShareSheetAvailable();
  const url = useMemo(
    () => new URL(shareLinkUrl(link.token), window.location.origin).href,
    [link.token]
  );
  const shape = useMemo(() => qrShape(url), [url]);
  const fileName = qrFileName(listName);
  const title = link.label || 'Share link';
  const expiry = formatLinkExpiry(link, now ?? new Date());
  const details = occasion && today ? occasionDetails(occasion, today) : null;
  const occasionLine = details ? [details.kind, details.date].filter(Boolean).join(' · ') : null;

  async function handOut(sheet: boolean) {
    const outcome = await shareOrCopy({ url, title: listName }, { sheet });
    if (outcome === 'copied') showToast('Link copied to clipboard', 'success');
    else if (outcome === 'failed') showToast('Could not copy the link', 'error');
    else if (outcome === 'unshared') showToast('Could not share the link', 'error');
  }

  function downloadSvg() {
    saveFile(new Blob([qrSvgFile(shape)], { type: 'image/svg+xml' }), `${fileName}.svg`);
  }

  async function downloadPng() {
    const blob = await qrPng(shape);
    if (blob) saveFile(blob, `${fileName}.png`);
    else showToast('Couldn’t make the PNG. Try the SVG.', 'error');
  }

  return (
    <>
      <BaseModal isOpen onClose={onClose} title={title} titleId={titleId} size="md">
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Badge size="sm" tone={link.level === 'join' ? 'info' : 'neutral'}>
              {SHARE_LINK_LEVEL_LABELS[link.level]}
            </Badge>
            <p className="text-xs text-muted-foreground">{expiry ?? 'Never expires'}</p>
          </div>

          <div>
            <Field label="Link">
              <Input readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
            </Field>
            <div className="mt-3 flex flex-wrap gap-3">
              <Button size="sm" icon="link" onClick={() => handOut(false)}>
                Copy link
              </Button>
              {sheetAvailable && (
                <Button variant="secondary" size="sm" icon="share" onClick={() => handOut(true)}>
                  Share
                </Button>
              )}
            </div>
          </div>

          <div>
            {/* White whatever the theme: a scanner needs dark modules on light. */}
            <div className="mx-auto w-full max-w-56 overflow-hidden rounded-xl border border-border bg-white">
              <QrSvg shape={shape} label={`QR code for ${title}`} />
            </div>
            <div className="mt-3 flex flex-wrap justify-center gap-3">
              <Button
                variant="secondary"
                size="sm"
                icon="download"
                onClick={downloadPng}
                aria-label="Download PNG"
              >
                PNG
              </Button>
              <Button
                variant="secondary"
                size="sm"
                icon="download"
                onClick={downloadSvg}
                aria-label="Download SVG"
              >
                SVG
              </Button>
              <Button variant="secondary" size="sm" icon="printer" onClick={() => window.print()}>
                Print card
              </Button>
            </div>
          </div>

          <Callout tone="warning">{LINK_WARNINGS[link.level]}</Callout>
        </div>
      </BaseModal>
      {createPortal(
        <div
          className={`${PRINT_CARD_CLASS} hidden min-h-screen flex-col items-center justify-center gap-4 bg-white p-8 text-center text-black print:flex`}
          data-testid="qr-print-card"
        >
          <h1 className="text-3xl font-semibold tracking-tight break-words">{listName}</h1>
          {occasionLine && <p className="text-lg">{occasionLine}</p>}
          <div className="mt-4 w-72">
            <QrSvg shape={shape} />
          </div>
          <p className="text-lg font-medium">{PRINT_CARD_CALLS[link.level]}</p>
          <p className="max-w-sm text-xs break-all">{url}</p>
        </div>,
        document.body
      )}
    </>
  );
}

function QrSvg({ shape, label }: { shape: QrShape; label?: string }) {
  return (
    <svg
      viewBox={`0 0 ${shape.size} ${shape.size}`}
      shapeRendering="crispEdges"
      className="block h-auto w-full"
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
    >
      <rect width={shape.size} height={shape.size} fill="#fff" />
      <path d={shape.path} fill="#000" />
    </svg>
  );
}

/** The code as a PNG, whole pixels per module; null where the browser can't draw it. */
function qrPng(shape: QrShape): Promise<Blob | null> {
  const scale = Math.ceil(PNG_MIN_PX / shape.size);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = shape.size * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.resolve(null);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.scale(scale, scale);
  ctx.fillStyle = '#000';
  ctx.fill(new Path2D(shape.path));
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

function saveFile(blob: Blob, name: string) {
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  // Some browsers start the download after the click returns.
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

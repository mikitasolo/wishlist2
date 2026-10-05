'use client';

import { useId, useMemo } from 'react';
import { createPortal } from 'react-dom';
import BaseModal from '@/components/BaseModal';
import Badge from '@/components/Badge';
import Button from '@/components/Button';
import Callout from '@/components/Callout';
import { SHARE_LINK_LEVEL_LABELS } from '@/components/ShareLinkDialog';
import { useToast } from '@/components/ToastProvider';
import { shareLinkUrl, type ShareLinkRow } from '@/lib/hooks/useShareLinks';
import { useLocalToday } from '@/lib/hooks/useLocalToday';
import { occasionDetails, type Occasion } from '@/lib/utils/occasion';
import { qrFileName, qrShape, qrSvgFile, type QrShape } from '@/lib/utils/qrCode';
import type { ShareLinkLevel } from '@/lib/utils/shareLinkFields';

/** Said by the downloads: what the code lets people do, and that paper can't be taken back. */
export const QR_WARNINGS: Record<ShareLinkLevel, string> = {
  view: 'Anyone who scans this can see the list until you revoke the link. Printed cards can’t be recalled.',
  join: 'Anyone who scans this can join the list until you revoke the link. Printed cards can’t be recalled.',
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

interface ShareLinkQrDialogProps {
  /** A live link with its token: the section offers QR code for no other. */
  link: ShareLinkRow & { token: string };
  listName: string;
  occasion?: Occasion | null;
  onClose: () => void;
}

/**
 * A share link's QR code, for a list's owners (WIS-328): the code for the
 * link's full `/l/<token>` URL, drawn in the browser so the token never goes
 * to a third party, with Download PNG, Download SVG and Print card. The card
 * (the list's name, occasion and the code) is mounted for as long as the
 * dialog is open and is all a print shows. Never for the list's own URL.
 */
export default function ShareLinkQrDialog({
  link,
  listName,
  occasion,
  onClose,
}: ShareLinkQrDialogProps) {
  const { showToast } = useToast();
  const titleId = useId();
  const today = useLocalToday();
  const url = useMemo(
    () => new URL(shareLinkUrl(link.token), window.location.origin).href,
    [link.token]
  );
  const shape = useMemo(() => qrShape(url), [url]);
  const fileName = qrFileName(listName);
  const linkName = link.label || 'Untitled link';
  const details = occasion && today ? occasionDetails(occasion, today) : null;
  const occasionLine = details ? [details.kind, details.date].filter(Boolean).join(' · ') : null;

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
      <BaseModal isOpen onClose={onClose} title="QR code" titleId={titleId} size="md">
        <div className="space-y-4">
          <div className="flex min-w-0 items-center gap-2">
            <p className="truncate font-medium text-foreground">{linkName}</p>
            <Badge size="sm" tone={link.level === 'join' ? 'info' : 'neutral'}>
              {SHARE_LINK_LEVEL_LABELS[link.level]}
            </Badge>
          </div>
          {/* White whatever the theme: a scanner needs dark modules on light. */}
          <div className="mx-auto w-full max-w-64 overflow-hidden rounded-xl border border-border bg-white">
            <QrSvg shape={shape} label={`QR code for ${linkName}`} />
          </div>
          <Callout tone="warning">{QR_WARNINGS[link.level]}</Callout>
          <div className="flex flex-wrap gap-3">
            <Button variant="secondary" size="sm" icon="download" onClick={downloadPng}>
              Download PNG
            </Button>
            <Button variant="secondary" size="sm" icon="download" onClick={downloadSvg}>
              Download SVG
            </Button>
            <Button size="sm" icon="printer" onClick={() => window.print()}>
              Print card
            </Button>
          </div>
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

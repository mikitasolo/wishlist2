'use client';

import { useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import BaseModal from '@/components/BaseModal';
import Badge from '@/components/Badge';
import Button from '@/components/Button';
import Callout from '@/components/Callout';
import Field from '@/components/Field';
import Input from '@/components/Input';
import QrCard from '@/components/QrCard';
import SegmentedControl from '@/components/SegmentedControl';
import Select from '@/components/Select';
import { FIELD_LABEL } from '@/components/fieldStyles';
import { SHARE_LINK_LEVEL_LABELS } from '@/components/ShareLinkDialog';
import { useToast } from '@/components/ToastProvider';
import { shareLinkUrl, type ShareLinkRow } from '@/lib/hooks/useShareLinks';
import { useLocalToday } from '@/lib/hooks/useLocalToday';
import { useShareSheetAvailable } from '@/lib/hooks/useShareSheetAvailable';
import { occasionDetails, type Occasion } from '@/lib/utils/occasion';
import {
  QR_CARD_DESIGNS,
  QR_CARD_DESIGN_LABELS,
  QR_CARD_SIZES,
  QR_CARD_SIZE_SPECS,
  SHEET_GAP,
  cardPixelSize,
  clampCopies,
  defaultCardDesign,
  maxCopiesPerSheet,
  sheetColumns,
  type QrCardDesign,
  type QrCardSize,
} from '@/lib/utils/qrCard';
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

/** What a print gives: the bare code, or the card around it (WIS-346). */
type QrFormat = 'card' | 'code';

const FORMAT_OPTIONS = [
  { value: 'card', label: 'Card' },
  { value: 'code', label: 'QR code only' },
] as const;

const DESIGN_OPTIONS = QR_CARD_DESIGNS.map((d) => ({ value: d, label: QR_CARD_DESIGN_LABELS[d] }));
const SIZE_OPTIONS = QR_CARD_SIZES.map((s) => ({ value: s, label: QR_CARD_SIZE_SPECS[s].label }));

/** The bare code's printed side, in mm. */
const PRINTED_CODE_MM = 70;

/** The default card size: a postcard, two to a sheet. */
const DEFAULT_SIZE: QrCardSize = 'postcard';

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
 * third party. Handing out the code is two steps (WIS-346): how it looks (the
 * bare code, or a card in one of the designs and sizes, some copies to a
 * sheet), then what to do with it (the code: Download PNG, Download SVG,
 * Print; a card: Download PNG (WIS-350), to send it, and Print card, which
 * also saves a PDF from the browser's print dialog). What prints is mounted
 * for as long as the dialog is open and is all a print shows. Never for the
 * list's own URL.
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
  const [format, setFormat] = useState<QrFormat>('card');
  // The occasion's design until one is picked, so it follows an occasion set or changed meanwhile.
  const [pickedDesign, setDesign] = useState<QrCardDesign | null>(null);
  const design = pickedDesign ?? defaultCardDesign(occasion?.kind);
  const [size, setSize] = useState<QrCardSize>(DEFAULT_SIZE);
  const [copies, setCopies] = useState(() => maxCopiesPerSheet(DEFAULT_SIZE));
  const maxCopies = maxCopiesPerSheet(size);
  const previewRef = useRef<SVGSVGElement>(null);
  const [makingPng, setMakingPng] = useState(false);
  const cardProps = {
    shape,
    design,
    size,
    listName,
    occasionLine,
    call: PRINT_CARD_CALLS[link.level],
    url,
  };

  function pickSize(next: QrCardSize) {
    setSize(next);
    // A new size starts on a full sheet of it.
    setCopies(maxCopiesPerSheet(next));
  }

  async function handOut(sheet: boolean) {
    const outcome = await shareOrCopy({ url, title: listName }, { sheet });
    if (outcome === 'copied') showToast('Link copied to clipboard', 'success');
    else if (outcome === 'failed') showToast('Could not copy the link', 'error');
    else if (outcome === 'unshared') showToast('Could not share the link', 'error');
  }

  function downloadSvg() {
    saveFile(new Blob([qrSvgFile(shape)], { type: 'image/svg+xml' }), `${fileName}.svg`);
  }

  /** Saves the PNG `make` draws, or says it couldn't; one at a time. */
  async function savePng(make: () => Promise<Blob | null>, name: string, fallback: string) {
    if (makingPng) return;
    setMakingPng(true);
    try {
      const blob = await make().catch(() => null);
      if (blob) saveFile(blob, name);
      else showToast(`Couldn’t make the PNG. ${fallback}`, 'error');
    } finally {
      setMakingPng(false);
    }
  }

  const downloadPng = () => savePng(() => qrPng(shape), `${fileName}.png`, 'Try the SVG.');

  function downloadCardPng() {
    const svg = previewRef.current;
    return savePng(
      () => (svg ? cardPng(svg, cardPixelSize(size)) : Promise.resolve(null)),
      `${fileName}-card.png`,
      'Try Print card.'
    );
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

          <div className="space-y-4">
            <SegmentedControl
              options={FORMAT_OPTIONS}
              value={format}
              onChange={setFormat}
              ariaLabel="Print as"
            />
            {format === 'card' && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <p className={FIELD_LABEL}>Design</p>
                  <Select
                    value={design}
                    onChange={(v) => setDesign(v as QrCardDesign)}
                    options={DESIGN_OPTIONS}
                    ariaLabel="Design"
                    triggerClassName="w-full"
                  />
                </div>
                <div>
                  <p className={FIELD_LABEL}>Size</p>
                  <Select
                    value={size}
                    onChange={(v) => pickSize(v as QrCardSize)}
                    options={SIZE_OPTIONS}
                    ariaLabel="Size"
                    triggerClassName="w-full"
                  />
                </div>
                {maxCopies > 1 && (
                  <div>
                    <p className={FIELD_LABEL}>Copies per sheet</p>
                    <Select
                      value={String(copies)}
                      onChange={(v) => setCopies(clampCopies(size, Number(v)))}
                      options={Array.from({ length: maxCopies }, (_, i) => ({
                        value: String(i + 1),
                        label: String(i + 1),
                      }))}
                      ariaLabel="Copies per sheet"
                      triggerClassName="w-full"
                    />
                  </div>
                )}
              </div>
            )}

            {/* White whatever the theme: a scanner needs dark modules on light. */}
            {format === 'card' ? (
              <div className="mx-auto w-full max-w-80 overflow-hidden rounded-xl border border-border bg-white">
                <QrCard
                  {...cardProps}
                  ref={previewRef}
                  label={`Card preview for ${title}`}
                  className="w-full"
                />
              </div>
            ) : (
              <div className="mx-auto w-full max-w-56 overflow-hidden rounded-xl border border-border bg-white">
                <QrSvg shape={shape} label={`QR code for ${title}`} />
              </div>
            )}

            <div className="flex flex-wrap justify-center gap-3">
              {format === 'card' ? (
                <>
                  <Button
                    variant="secondary"
                    size="sm"
                    icon="download"
                    onClick={downloadCardPng}
                    disabled={makingPng}
                    aria-label="Download PNG"
                  >
                    PNG
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    icon="printer"
                    onClick={() => window.print()}
                  >
                    Print card
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    variant="secondary"
                    size="sm"
                    icon="download"
                    onClick={downloadPng}
                    disabled={makingPng}
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
                  <Button
                    variant="secondary"
                    size="sm"
                    icon="printer"
                    onClick={() => window.print()}
                  >
                    Print
                  </Button>
                </>
              )}
            </div>
            {format === 'card' && (
              <p className="text-center text-xs text-muted-foreground">
                To save a PDF, pick Save as PDF in the print dialog.
              </p>
            )}
          </div>

          <Callout tone="warning">{LINK_WARNINGS[link.level]}</Callout>
        </div>
      </BaseModal>
      {createPortal(
        <div
          className={`${PRINT_CARD_CLASS} hidden justify-center bg-white print:grid`}
          style={{
            gap: `${SHEET_GAP}mm`,
            gridTemplateColumns:
              format === 'card'
                ? `repeat(${sheetColumns(size, copies)}, ${QR_CARD_SIZE_SPECS[size].width}mm)`
                : `${PRINTED_CODE_MM}mm`,
          }}
          data-testid="qr-print-card"
        >
          {format === 'card' ? (
            Array.from({ length: copies }, (_, i) => (
              // A dashed line round each card to cut along.
              <div key={i} className="qr-print-cut">
                <QrCard {...cardProps} />
              </div>
            ))
          ) : (
            <div className="text-center text-black">
              <QrSvg shape={shape} />
              {/* To type when a scan fails. */}
              <p className="mt-2 text-xs break-all">{url}</p>
            </div>
          )}
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

/**
 * A white `width` × `height` canvas that `draw` paints, as a PNG; null where
 * the browser can't (no 2D context, a canvas too big for it, or one it won't
 * read back).
 */
async function canvasPng(
  width: number,
  height: number,
  draw: (ctx: CanvasRenderingContext2D) => void
): Promise<Blob | null> {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
    draw(ctx);
    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  } catch {
    return null;
  }
}

/** The code as a PNG, whole pixels per module; null where the browser can't draw it. */
function qrPng(shape: QrShape): Promise<Blob | null> {
  const scale = Math.ceil(PNG_MIN_PX / shape.size);
  const side = shape.size * scale;
  return canvasPng(side, side, (ctx) => {
    ctx.scale(scale, scale);
    ctx.fillStyle = '#000';
    ctx.fill(new Path2D(shape.path));
  });
}

/**
 * The card as a PNG of `px` (WIS-350): its own SVG, drawn through an `<img>` onto
 * a canvas, all in the browser. The SVG has no web font or outside image to
 * fetch (its text uses the system stack), so it draws as it shows and leaves
 * the canvas readable. Null where the browser can't draw it.
 */
async function cardPng(
  svg: SVGSVGElement,
  px: { width: number; height: number }
): Promise<Blob | null> {
  const copy = svg.cloneNode(true) as SVGSVGElement;
  copy.setAttribute('width', String(px.width));
  copy.setAttribute('height', String(px.height));
  // The preview's own: its classes and accessible name.
  for (const attr of ['class', 'role', 'aria-label']) copy.removeAttribute(attr);
  const source = URL.createObjectURL(
    new Blob([new XMLSerializer().serializeToString(copy)], { type: 'image/svg+xml' })
  );
  try {
    const img = await new Promise<HTMLImageElement | null>((resolve) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => resolve(null);
      image.src = source;
    });
    if (!img) return null;
    return await canvasPng(px.width, px.height, (ctx) =>
      ctx.drawImage(img, 0, 0, px.width, px.height)
    );
  } finally {
    URL.revokeObjectURL(source);
  }
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

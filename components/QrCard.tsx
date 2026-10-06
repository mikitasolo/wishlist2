import type { ReactNode } from 'react';
import type { QrShape } from '@/lib/utils/qrCode';
import {
  QR_CARD_SIZE_SPECS,
  fitText,
  textEm,
  type QrCardDesign,
  type QrCardSize,
} from '@/lib/utils/qrCard';

/*
 * Paper colours, not theme tokens: a card prints the same whatever the screen's
 * theme. Its meaning never rests on colour (the decoration is all it tints),
 * so it holds up in black and white, and the code itself stays black on white.
 */
const INK = '#1f1d33';
const MUTED = '#5b5973';
const ACCENT = '#5e5ce6';
const ACCENT2 = '#ff375f';
const GOLD = '#b08d57';
const PINE = '#2f7d5b';
const BERRY = '#d1344b';
const SUN = '#f5b700';

/** The app's own type stack, spelled out so the SVG draws the same anywhere. */
const FONT =
  "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

interface QrCardProps {
  shape: QrShape;
  design: QrCardDesign;
  size: QrCardSize;
  listName: string;
  /** "Wedding · Sat 20 Jun", or nothing when the list has no occasion. */
  occasionLine: string | null;
  /** The call to action under the code (`PRINT_CARD_CALLS`). */
  call: string;
  url: string;
  /** An accessible name, for the on-screen preview; the printed copies are hidden. */
  label?: string;
  className?: string;
}

interface Inset {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/**
 * A share link's card (WIS-346): the "Wishlist." wordmark, the list's name, its
 * occasion, the QR code with its quiet zone, the call to action and the URL,
 * in one of the designs, drawn as one SVG in millimetres at its true size. A
 * landscape card puts the code beside the text; a portrait one stacks them.
 * Shows only what the link's visitors can see.
 */
export default function QrCard({
  shape,
  design,
  size,
  listName,
  occasionLine,
  call,
  url,
  label,
  className = '',
}: QrCardProps) {
  const { width: W, height: H } = QR_CARD_SIZE_SPECS[size];
  const u = Math.min(W, H);
  const deco = DECORATIONS[design](W, H, u);
  const pad = 0.07 * u;
  const box = {
    x0: deco.inset.left + pad,
    y0: deco.inset.top + pad,
    x1: W - deco.inset.right - pad,
    y1: H - deco.inset.bottom - pad,
  };
  const landscape = W > H;
  const body = landscape
    ? landscapeBody(box, u, { shape, listName, occasionLine, call, url })
    : portraitBody(box, u, { shape, listName, occasionLine, call, url });

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${W} ${H}`}
      width={`${W}mm`}
      height={`${H}mm`}
      fontFamily={FONT}
      className={`block h-auto max-w-full ${className}`}
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
      data-design={design}
    >
      <rect width={W} height={H} fill="#fff" />
      {deco.node}
      {body}
    </svg>
  );
}

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface Content {
  shape: QrShape;
  listName: string;
  occasionLine: string | null;
  call: string;
  url: string;
}

const LINE = 1.2;

type Anchor = 'start' | 'middle';

function Wordmark({ x, y, size, anchor }: { x: number; y: number; size: number; anchor: Anchor }) {
  return (
    <text
      x={x}
      y={y}
      fontSize={size}
      fontWeight={600}
      letterSpacing={-0.04 * size}
      fill={INK}
      textAnchor={anchor}
    >
      Wishlist<tspan fill={ACCENT}>.</tspan>
    </text>
  );
}

function Lines({
  lines,
  x,
  y,
  size,
  anchor,
  weight = 400,
  fill = INK,
}: {
  lines: string[];
  x: number;
  y: number;
  size: number;
  anchor: Anchor;
  weight?: number;
  fill?: string;
}) {
  return (
    <text x={x} y={y} fontSize={size} fontWeight={weight} fill={fill} textAnchor={anchor}>
      {lines.map((line, i) => (
        <tspan key={i} x={x} dy={i === 0 ? 0 : size * LINE}>
          {line}
        </tspan>
      ))}
    </text>
  );
}

function Code({ shape, x, y, side }: { shape: QrShape; x: number; y: number; side: number }) {
  return (
    <svg
      x={x}
      y={y}
      width={side}
      height={side}
      viewBox={`0 0 ${shape.size} ${shape.size}`}
      shapeRendering="crispEdges"
      data-qr=""
    >
      <rect width={shape.size} height={shape.size} fill="#fff" />
      <path d={shape.path} fill="#000" />
    </svg>
  );
}

/** The URL on one line across `width`: smaller rather than cut, it's there to be typed. */
function urlSize(url: string, width: number, max: number): number {
  return Math.min(max, width / textEm(url));
}

/** A line of `text` at `max`, smaller if that's what it takes to fit `width`. */
function OneLine({
  text,
  x,
  y,
  width,
  max,
  anchor,
  weight = 400,
  fill = MUTED,
}: {
  text: string;
  x: number;
  y: number;
  width: number;
  max: number;
  anchor: Anchor;
  weight?: number;
  fill?: string;
}) {
  const { size, lines } = fitText(text, { width, max, min: max * 0.6, maxLines: 1 });
  return (
    <text x={x} y={y} fontSize={size} fontWeight={weight} fill={fill} textAnchor={anchor}>
      {lines[0]}
    </text>
  );
}

function landscapeBody(box: Box, u: number, c: Content): ReactNode {
  const w = box.x1 - box.x0;
  const urlFont = urlSize(c.url, w, 0.045 * u);
  const urlY = box.y1;
  const top = box.y0;
  const bottom = urlY - urlFont * 1.6;
  const side = Math.min(bottom - top, w * 0.45);
  const textW = w - side - 0.06 * u;
  const wm = 0.075 * u;
  const titleTop = top + wm * 1.9;
  const title = fitText(c.listName, { width: textW, max: 0.12 * u, min: 0.07 * u, maxLines: 2 });
  const occ = 0.058 * u;
  const occY =
    titleTop +
    title.size * 0.8 +
    (Math.max(1, title.lines.length) - 1) * title.size * LINE +
    occ * 1.5;
  const callSize = 0.062 * u;
  return (
    <g>
      <Wordmark x={box.x0} y={top + wm * 0.8} size={wm} anchor="start" />
      <Lines
        lines={title.lines}
        x={box.x0}
        y={titleTop + title.size * 0.8}
        size={title.size}
        anchor="start"
        weight={600}
      />
      {c.occasionLine && (
        <OneLine text={c.occasionLine} x={box.x0} y={occY} width={textW} max={occ} anchor="start" />
      )}
      <OneLine
        text={c.call}
        x={box.x0}
        y={bottom - callSize * 0.2}
        width={textW}
        max={callSize}
        anchor="start"
        weight={600}
        fill={ACCENT}
      />
      <Code shape={c.shape} x={box.x1 - side} y={top + (bottom - top - side) / 2} side={side} />
      <text x={box.x0} y={urlY} fontSize={urlFont} fill={MUTED}>
        {c.url}
      </text>
    </g>
  );
}

function portraitBody(box: Box, u: number, c: Content): ReactNode {
  const w = box.x1 - box.x0;
  const cx = (box.x0 + box.x1) / 2;
  const wm = 0.07 * u;
  let y = box.y0 + wm * 0.8;
  const wordmarkY = y;
  y += wm * 1.4;
  const title = fitText(c.listName, { width: w, max: 0.1 * u, min: 0.06 * u, maxLines: 2 });
  const titleY = y + title.size * 0.8;
  y = titleY + (Math.max(1, title.lines.length) - 1) * title.size * LINE;
  const occ = 0.055 * u;
  const occY = c.occasionLine ? y + occ * 1.7 : y;
  y = occY + 0.06 * u;
  const urlFont = urlSize(c.url, w, 0.04 * u);
  const urlY = box.y1;
  const callSize = 0.065 * u;
  const callY = urlY - urlFont * 2;
  const room = callY - callSize * 1.4 - y;
  const side = Math.min(room, w * 0.8);
  return (
    <g>
      <Wordmark x={cx} y={wordmarkY} size={wm} anchor="middle" />
      <Lines lines={title.lines} x={cx} y={titleY} size={title.size} anchor="middle" weight={600} />
      {c.occasionLine && (
        <OneLine text={c.occasionLine} x={cx} y={occY} width={w} max={occ} anchor="middle" />
      )}
      <Code shape={c.shape} x={cx - side / 2} y={y + (room - side) / 2} side={side} />
      <OneLine
        text={c.call}
        x={cx}
        y={callY}
        width={w}
        max={callSize}
        anchor="middle"
        weight={600}
        fill={ACCENT}
      />
      <text x={cx} y={urlY} fontSize={urlFont} fill={MUTED} textAnchor="middle">
        {c.url}
      </text>
    </g>
  );
}

type Decoration = (W: number, H: number, u: number) => { node: ReactNode; inset: Inset };

const NONE: Inset = { top: 0, right: 0, bottom: 0, left: 0 };

/** A pseudo-random sequence from a seed, so a design draws the same every time. */
function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function frame(W: number, H: number, u: number, color: string, double: boolean): ReactNode {
  const m = 0.035 * u;
  const r = 0.03 * u;
  return (
    <g fill="none" stroke={color}>
      <rect x={m} y={m} width={W - 2 * m} height={H - 2 * m} rx={r} strokeWidth={0.012 * u} />
      {double && (
        <rect
          x={m * 1.8}
          y={m * 1.8}
          width={W - 3.6 * m}
          height={H - 3.6 * m}
          rx={r * 0.6}
          strokeWidth={0.005 * u}
        />
      )}
    </g>
  );
}

const DECORATIONS: Record<QrCardDesign, Decoration> = {
  classic: (W, H, u) => ({
    node: frame(W, H, u, ACCENT, true),
    inset: { top: 0.05 * u, right: 0.05 * u, bottom: 0.05 * u, left: 0.05 * u },
  }),

  confetti: (W, H, u) => {
    const band = 0.13 * u;
    const rand = seeded(7);
    const colors = [ACCENT, ACCENT2, SUN, PINE];
    const pieces: ReactNode[] = [];
    const n = Math.round(W / (0.06 * u));
    for (let i = 0; i < n; i++) {
      const x = ((i + 0.2 + rand() * 0.6) / n) * W;
      const y = band * (0.2 + rand() * 0.6);
      const s = 0.018 * u + rand() * 0.014 * u;
      const fill = colors[i % colors.length];
      const turn = Math.round(rand() * 180);
      pieces.push(
        i % 3 === 0 ? (
          <circle key={i} cx={x} cy={y} r={s / 2} fill={fill} />
        ) : (
          <rect
            key={i}
            x={x - s / 2}
            y={y - s / 4}
            width={s}
            height={s / 2}
            fill={fill}
            transform={`rotate(${turn} ${x} ${y})`}
          />
        )
      );
    }
    return { node: <g>{pieces}</g>, inset: { ...NONE, top: band * 0.8 } };
  },

  ribbon: (W, H, u) => {
    const rw = 0.07 * u;
    const loop = 0.09 * u;
    // Far enough in that the bow's left loop (and its stroke) stays on the card.
    const x = Math.max(0.08 * u + 0.02 * W, loop * 1.8 - rw / 2 + 0.03 * u);
    const by = 0.2 * H;
    return {
      node: (
        <g>
          <rect x={x} y={0} width={rw} height={H} fill={ACCENT2} />
          <g fill="none" stroke={ACCENT2} strokeWidth={0.025 * u}>
            <ellipse cx={x + rw / 2 - loop * 0.8} cy={by - loop * 0.3} rx={loop} ry={loop * 0.55} />
            <ellipse cx={x + rw / 2 + loop * 0.8} cy={by - loop * 0.3} rx={loop} ry={loop * 0.55} />
          </g>
          <circle
            cx={x + rw / 2}
            cy={by}
            r={rw * 0.55}
            fill={ACCENT2}
            stroke="#fff"
            strokeWidth={0.008 * u}
          />
        </g>
      ),
      inset: { ...NONE, left: x + rw + loop * 0.9 },
    };
  },

  birthday: (W, _H, u) => {
    const band = 0.14 * u;
    const colors = [ACCENT2, SUN, ACCENT, PINE];
    const flag = 0.07 * u;
    const n = Math.max(4, Math.floor(W / (flag * 1.25)));
    const sag = band * 0.25;
    const lineY = (t: number) => band * 0.15 + sag * 4 * t * (1 - t);
    const flags: ReactNode[] = [];
    for (let i = 0; i < n; i++) {
      const t0 = (i + 0.1) / n;
      const t1 = (i + 0.9) / n;
      const tm = (i + 0.5) / n;
      const x0 = t0 * W;
      const x1 = t1 * W;
      const xm = tm * W;
      flags.push(
        <path
          key={i}
          d={`M${x0} ${lineY(t0)}L${x1} ${lineY(t1)}L${xm} ${lineY(tm) + flag}z`}
          fill={colors[i % colors.length]}
        />
      );
    }
    return {
      node: (
        <g>
          <path
            d={`M0 ${lineY(0)}Q${W / 2} ${lineY(0) + sag * 2} ${W} ${lineY(1)}`}
            fill="none"
            stroke={MUTED}
            strokeWidth={0.006 * u}
          />
          {flags}
        </g>
      ),
      inset: { ...NONE, top: band + sag * 0.3 },
    };
  },

  wedding: (W, H, u) => {
    // Two rings on the frame's bottom edge, clear of the URL above it.
    const r = 0.035 * u;
    const cx = W / 2;
    const cy = H - 0.035 * u;
    return {
      node: (
        <g>
          {frame(W, H, u, GOLD, true)}
          <rect x={cx - r * 2} y={cy - r * 1.2} width={r * 4} height={r * 2.4} fill="#fff" />
          <g fill="none" stroke={GOLD} strokeWidth={0.008 * u}>
            <circle cx={cx - r * 0.6} cy={cy} r={r} />
            <circle cx={cx + r * 0.6} cy={cy} r={r} />
          </g>
        </g>
      ),
      inset: { top: 0.05 * u, right: 0.05 * u, bottom: 0.07 * u, left: 0.05 * u },
    };
  },

  holiday: (W, _H, u) => {
    const band = 0.13 * u;
    const rand = seeded(11);
    const n = Math.max(4, Math.round(W / (0.1 * u)));
    const marks: ReactNode[] = [];
    for (let i = 0; i < n; i++) {
      const x = ((i + 0.5) / n) * W;
      const y = band * (0.35 + rand() * 0.3);
      const r = 0.022 * u + rand() * 0.012 * u;
      if (i % 2 === 0) {
        // A snowflake: three strokes through its centre.
        marks.push(
          <g key={i} stroke={PINE} strokeWidth={0.006 * u} strokeLinecap="round">
            {[0, 60, 120].map((a) => (
              <line
                key={a}
                x1={x - r}
                y1={y}
                x2={x + r}
                y2={y}
                transform={`rotate(${a} ${x} ${y})`}
              />
            ))}
          </g>
        );
      } else {
        marks.push(<path key={i} d={star(x, y, r)} fill={i % 4 === 1 ? BERRY : SUN} />);
      }
    }
    return { node: <g>{marks}</g>, inset: { ...NONE, top: band * 0.85 } };
  },
};

/** A five-pointed star's path, centred on (x, y) with outer radius r. */
function star(x: number, y: number, r: number): string {
  let d = '';
  for (let i = 0; i < 10; i++) {
    const a = (Math.PI / 5) * i - Math.PI / 2;
    const rr = i % 2 === 0 ? r : r * 0.45;
    d += `${i === 0 ? 'M' : 'L'}${(x + rr * Math.cos(a)).toFixed(3)} ${(y + rr * Math.sin(a)).toFixed(3)}`;
  }
  return `${d}z`;
}

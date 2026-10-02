import type { ReactElement } from 'react';

// Reading a share card's element tree (lib/og/cards.tsx) without drawing it:
// its function components are called, the way Satori would, so the text in a
// component's props shows up too.

type Node = unknown;

function expand(node: Node): Node {
  if (node == null || typeof node !== 'object' || Array.isArray(node)) return node;
  const el = node as { type?: unknown; props?: Record<string, unknown> };
  if (typeof el.type === 'function') {
    return expand((el.type as (props: unknown) => Node)(el.props ?? {}));
  }
  return node;
}

function walk(node: Node, visit: (el: ReactElement<Record<string, unknown>>) => void): void {
  const expanded = expand(node);
  if (expanded == null || typeof expanded !== 'object') return;
  if (Array.isArray(expanded)) {
    expanded.forEach((child) => walk(child, visit));
    return;
  }
  const el = expanded as ReactElement<Record<string, unknown>>;
  visit(el);
  walk(el.props?.children, visit);
}

/** Every piece of text on the card, one entry per text node (or per element's joined text). */
export function cardText(node: Node): string[] {
  const out: string[] = [];
  walk(node, (el) => {
    const { children } = el.props ?? {};
    const parts = (Array.isArray(children) ? children : [children]).filter(
      (c) => typeof c === 'string' || typeof c === 'number'
    );
    if (parts.length) out.push(parts.join(''));
  });
  return out;
}

/** The `src` of every image on the card (logo, photo). */
export function cardImages(node: Node): string[] {
  const out: string[] = [];
  walk(node, (el) => {
    if (el.type === 'img' && typeof el.props?.src === 'string') out.push(el.props.src);
  });
  return out;
}

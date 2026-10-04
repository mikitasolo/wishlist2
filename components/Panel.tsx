import type { ComponentPropsWithRef, ReactNode } from 'react';

type PanelElement = 'section' | 'div' | 'form';

type PanelProps = Omit<ComponentPropsWithRef<'section'>, 'title'> & {
  /** The panel's heading (`text-lg` semibold). Leave it out for a panel that lays out its own. */
  title?: ReactNode;
  /** A line or two under the title. */
  description?: ReactNode;
  /** The title's heading level: 2 on a page (the default), 3 under a page's own h2. */
  level?: 2 | 3;
  /** The title's id, for an `aria-labelledby`. */
  titleId?: string;
  /**
   * `list`: a header (title and description) over rows divided by a line, each
   * a `PanelRow` (the owners, the members). The default holds a form or text.
   */
  variant?: 'default' | 'list';
  /** `form` makes the panel the form (pass `onSubmit`); `section` by default. */
  as?: PanelElement;
};

const SURFACE = 'rounded-2xl border border-border bg-surface shadow-sm';
/** A list panel's header and rows share this inset. */
const INSET = 'px-5 sm:px-6';

/**
 * A titled block of a page: the Settings and Welcome forms, a list's People tab's
 * people and Invite someone, its Settings tab's sections, the
 * dashboard's currency prompt. `rounded-2xl border bg-surface shadow-sm`,
 * padded `p-5 sm:p-6`, with a `text-lg` title, a muted description under it and
 * the content at `mt-5`. A `list` panel has a bordered header and divided rows
 * (`PanelRow`) instead. A sub-section inside a panel is a `PanelSection`.
 */
export default function Panel({
  title,
  description,
  level = 2,
  titleId,
  variant = 'default',
  as = 'section',
  className = '',
  children,
  ...props
}: PanelProps) {
  const Heading = `h${level}` as const;
  // One set of props for whichever element it renders as.
  const Tag = as as 'section';
  const heading = (title || description) && (
    <>
      {title && (
        <Heading id={titleId} className="text-lg font-semibold text-foreground">
          {title}
        </Heading>
      )}
      {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
    </>
  );

  if (variant === 'list') {
    return (
      <Tag className={`${SURFACE} ${className}`} {...props}>
        {heading && <div className={`border-b border-border py-4 ${INSET}`}>{heading}</div>}
        {/* No overflow-hidden on the panel: a row's menu opens in place and spills past its
            bottom edge. So the first and last row keep the panel's corners themselves. */}
        <div className="divide-y divide-border [&>:first-child]:rounded-t-[inherit] [&>:last-child]:rounded-b-[inherit]">
          {children}
        </div>
      </Tag>
    );
  }
  return (
    <Tag className={`${SURFACE} p-5 sm:p-6 ${className}`} {...props}>
      {heading}
      {heading ? <div className="mt-5">{children}</div> : children}
    </Tag>
  );
}

/** One row of a `list` panel, inset like its header. Lay out its content with `className`. */
export function PanelRow({
  className = '',
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return <div className={`py-4 ${INSET} ${className}`}>{children}</div>;
}

/**
 * A sub-section of a panel, under a line: a `text-base` title, a muted
 * description and its content (the list settings' Archive, Feature and Danger
 * zone).
 */
export function PanelSection({
  title,
  description,
  children,
  className = '',
}: {
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`mt-6 border-t border-border pt-6 ${className}`}>
      {/* Flat, so the title, the description and the content are siblings. */}
      <h3
        className={`text-base font-semibold text-foreground ${children && !description ? 'mb-4' : ''}`}
      >
        {title}
      </h3>
      {description && (
        <p className={`mt-1 text-sm text-muted-foreground ${children ? 'mb-4' : ''}`}>
          {description}
        </p>
      )}
      {children}
    </div>
  );
}

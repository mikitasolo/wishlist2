import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { isLocalDevRuntime } from '@/lib/env';

/**
 * The email gallery (WIS-375): every email the app sends, rendered from
 * fixture data (`lib/emailTemplates/fixtures.ts`) through its real template,
 * in light and dark. Nothing is read from the database and nothing is sent.
 *
 * Local dev only, gated exactly as `EMAIL_TRANSPORT=console` is
 * (`isLocalDevRuntime`: `VERCEL_ENV` unset or `development`); on Preview and
 * Production it's the app's plain 404, and its title isn't set either. The gate
 * runs per request, never baked in at build, and the templates load only once
 * it has passed.
 */
export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  if (!isLocalDevRuntime()) notFound();
  return { title: 'Email gallery', robots: { index: false, follow: false } };
}

const SCHEMES = ['light', 'dark'] as const;

export default async function EmailGallery() {
  if (!isLocalDevRuntime()) notFound();
  const { galleryEntries } = await import('@/lib/emailTemplates/gallery');
  const entries = galleryEntries(process.env.NEXTAUTH_URL ?? 'http://localhost:3000');

  return (
    <main className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6 lg:px-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold text-foreground">Email gallery</h1>
        <p className="text-sm text-muted-foreground">
          Every email, rendered from made-up data through its real template. Local dev only: nothing
          here is sent, and its unsubscribe links are unsigned.
        </p>
        <nav aria-label="Emails">
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {entries.map(({ fixture }) => (
              <li key={fixture.id}>
                <a href={`#${fixture.id}`} className="text-accent underline">
                  {fixture.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </header>

      {entries.map(({ fixture, email, preview }) => (
        <section
          key={fixture.id}
          id={fixture.id}
          aria-labelledby={`${fixture.id}-title`}
          className="scroll-mt-4 space-y-3 border-t border-border pt-6"
        >
          <h2 id={`${fixture.id}-title`} className="text-lg font-semibold text-foreground">
            {fixture.label}
          </h2>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Subject</dt>
            <dd className="text-foreground">{email.subject}</dd>
            <dt className="text-muted-foreground">Link</dt>
            <dd className="break-all text-foreground">{email.link}</dd>
            <dt className="text-muted-foreground">List-Unsubscribe</dt>
            <dd className="break-all text-foreground">
              {email.unsubscribe ? `<${email.unsubscribe.oneClick}>` : 'none'}
            </dd>
          </dl>
          <div className="grid gap-4 lg:grid-cols-2">
            {SCHEMES.map((scheme) => (
              <figure key={scheme} className="space-y-1">
                <figcaption className="text-sm text-muted-foreground">
                  {scheme === 'light' ? 'Light' : 'Dark'}
                </figcaption>
                <iframe
                  title={`${fixture.label}, ${scheme}`}
                  srcDoc={preview}
                  sandbox=""
                  loading="lazy"
                  // An iframe's prefers-color-scheme follows its own color-scheme,
                  // so this shows the email's dark-mode styles as a mail client would.
                  style={{ colorScheme: scheme }}
                  className="h-[46rem] w-full rounded-lg border border-border"
                />
              </figure>
            ))}
          </div>
          <details>
            <summary className="cursor-pointer text-sm text-muted-foreground">Plain text</summary>
            <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded-lg border border-border bg-surface p-4 text-sm text-foreground">
              {email.text}
            </pre>
          </details>
        </section>
      ))}
    </main>
  );
}

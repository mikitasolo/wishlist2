import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import { isLocalDevRuntime, validateEnvVars } from '@/lib/env';
import { EMAIL_FIXTURES } from '@/lib/emailTemplates/fixtures';
import { galleryEntries } from '@/lib/emailTemplates/gallery';

/**
 * The dev-only email gallery (`/dev/emails`, WIS-375): a 404 wherever
 * `EMAIL_TRANSPORT=console` is refused, and fixture data only where it exists.
 */

const NOT_FOUND = 'NEXT_HTTP_ERROR_FALLBACK;404';
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error(NOT_FOUND);
  }),
}));

// The real renderer, watched: the page must not even load it behind the gate.
const { renderedGallery } = vi.hoisted(() => ({ renderedGallery: vi.fn() }));
vi.mock('@/lib/emailTemplates/gallery', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/emailTemplates/gallery')>();
  return {
    ...real,
    galleryEntries: (siteUrl: string) => {
      renderedGallery(siteUrl);
      return real.galleryEntries(siteUrl);
    },
  };
});

const SITE = 'http://localhost:3000';

async function loadPage() {
  vi.resetModules();
  return import('@/app/dev/emails/page');
}

beforeEach(() => {
  renderedGallery.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('isLocalDevRuntime', () => {
  it.each([
    [undefined, true],
    ['development', true],
    ['preview', false],
    ['production', false],
    ['', false],
    ['Production', false],
    ['staging', false],
  ])('VERCEL_ENV=%j → %s', (vercelEnv, allowed) => {
    expect(isLocalDevRuntime(vercelEnv)).toBe(allowed);
  });

  it.each([undefined, 'development', 'preview', 'production', ''])(
    'admits exactly where EMAIL_TRANSPORT=console is allowed (VERCEL_ENV=%j)',
    (vercelEnv) => {
      vi.stubEnv('VERCEL_ENV', vercelEnv);
      vi.stubEnv('EMAIL_TRANSPORT', 'console');
      const consoleAllowed = (() => {
        try {
          validateEnvVars();
          return true;
        } catch (error) {
          if (String(error).includes('EMAIL_TRANSPORT=console is not allowed')) return false;
          throw error;
        }
      })();
      expect(isLocalDevRuntime()).toBe(consoleAllowed);
    }
  );
});

describe('/dev/emails', () => {
  it.each(['production', 'preview', ''])(
    'is a 404, title included, with VERCEL_ENV=%j, and never renders an email',
    async (vercelEnv) => {
      vi.stubEnv('VERCEL_ENV', vercelEnv);
      const { default: EmailGallery, generateMetadata } = await loadPage();

      await expect(EmailGallery()).rejects.toThrow(NOT_FOUND);
      await expect(generateMetadata()).rejects.toThrow(NOT_FOUND);
      expect(renderedGallery).not.toHaveBeenCalled();
    }
  );

  it.each(['production', 'preview', ''])(
    'gates the whole /dev segment too with VERCEL_ENV=%j',
    async (vercelEnv) => {
      vi.stubEnv('VERCEL_ENV', vercelEnv);
      vi.resetModules();
      const { default: DevLayout } = await import('@/app/dev/layout');
      expect(() => DevLayout({ children: 'page' })).toThrow(NOT_FOUND);
    }
  );

  it.each([undefined, 'development'])('lets /dev through with VERCEL_ENV=%j', async (vercelEnv) => {
    vi.stubEnv('VERCEL_ENV', vercelEnv);
    vi.resetModules();
    const { default: DevLayout } = await import('@/app/dev/layout');
    expect(DevLayout({ children: 'page' })).toBe('page');
  });

  it('decides per request, not once at build', async () => {
    const { default: EmailGallery } = await loadPage();
    vi.stubEnv('VERCEL_ENV', 'production');
    await expect(EmailGallery()).rejects.toThrow(NOT_FOUND);
    vi.stubEnv('VERCEL_ENV', 'development');
    await expect(EmailGallery()).resolves.toBeTruthy();
  });

  it.each([undefined, 'development'])(
    'renders every email from fixtures with VERCEL_ENV=%j',
    async (vercelEnv) => {
      vi.stubEnv('VERCEL_ENV', vercelEnv);
      vi.stubEnv('NEXTAUTH_URL', SITE);
      const { default: EmailGallery, generateMetadata } = await loadPage();

      await expect(generateMetadata()).resolves.toMatchObject({ title: 'Email gallery' });
      const markup = renderToStaticMarkup((await EmailGallery()) as ReactElement);
      expect(renderedGallery).toHaveBeenCalledWith(SITE);
      for (const { fixture, email } of galleryEntries(SITE)) {
        expect(markup).toContain(`id="${fixture.id}"`);
        expect(markup).toContain(renderToStaticMarkup(<>{email.subject}</>));
      }
      // Each email twice, light and dark, sandboxed.
      expect(markup.match(/<iframe /g)).toHaveLength(EMAIL_FIXTURES.length * 2);
      expect(markup).toContain('color-scheme:dark');
      expect(markup).not.toMatch(/<iframe [^>]*sandbox="[^"]*allow-scripts/);
    }
  );
});

describe('galleryEntries', () => {
  const entries = galleryEntries(SITE);

  it('renders every fixture', () => {
    expect(entries.map((entry) => entry.fixture.id)).toEqual(EMAIL_FIXTURES.map((f) => f.id));
  });

  it('shows the logo inline, as no attachment comes with a preview', () => {
    for (const { email, previews } of entries) {
      expect(email.html).toContain('cid:wishlist-logo');
      for (const preview of Object.values(previews)) {
        expect(preview).not.toContain('cid:');
        expect(preview).toContain('data:image/png;base64,');
      }
    }
  });

  it('forces each scheme, whatever the browser prefers, and changes nothing else', () => {
    for (const { email, previews } of entries) {
      expect(email.html).toContain('@media (prefers-color-scheme: dark)');
      expect(previews.dark).not.toContain('prefers-color-scheme: dark');
      expect(previews.light).not.toContain('prefers-color-scheme: dark');
      expect(previews.dark).toContain('@media all {');
      expect(previews.light).toContain('@media not all {');
      const unforced = (html: string) =>
        html.replace(/@media (not )?all \{/, '@media (prefers-color-scheme: dark) {');
      expect(unforced(previews.dark)).toBe(unforced(previews.light));
    }
  });

  it('carries made-up unsubscribe links that are not signed for anyone', () => {
    const unsubscribed = entries.filter((entry) => entry.email.unsubscribe);
    expect(unsubscribed.length).toBe(entries.length - 1); // all but the sign-in link
    for (const { email } of unsubscribed) {
      expect(email.unsubscribe!.page).toMatch(/[?&]fixture=1$/);
      expect(email.unsubscribe!.page).not.toMatch(/[?&][ut]=/);
      expect(email.unsubscribe!.oneClick).not.toMatch(/[?&][ut]=/);
    }
  });
});

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { fetchHtmlSafely } from '@/lib/utils/ssrf';
import { parseLinkMetadata } from '@/lib/utils/linkPreview';

// POST /api/import/link - fetch a user-supplied product URL server-side and
// return its Open Graph metadata to pre-fill the item form. SSRF-guarded by
// fetchHtmlSafely (URL/redirect validation, public-IP-only, size/type/timeout).
export async function POST(request: NextRequest) {
  // Auth-only: never let an anonymous caller use the server as a fetch proxy.
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const url = typeof body?.url === 'string' ? body.url.trim() : '';
  if (!url) {
    return NextResponse.json({ success: false, error: 'Enter a link to import.' }, { status: 400 });
  }

  try {
    const { html, finalUrl } = await fetchHtmlSafely(url);
    const meta = parseLinkMetadata(html, finalUrl);
    return NextResponse.json(
      {
        success: true,
        data: {
          title: meta.title,
          imageUrl: meta.imageUrl,
          description: meta.description,
          price: meta.price,
          link: finalUrl,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    // Guard rejections carry a user-friendly message; anything else is generic.
    const message = error instanceof Error ? error.message : 'Could not import that link.';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { enforce, userKey } from '@/lib/rateLimit';
import { fetchPublicBytes, SafeFetchError, type SafeFetchFailure } from '@/lib/utils/safeFetch';
import { sniffUploadImageType } from '@/lib/utils/uploadImageFormat';
// Loading the pipeline also runs its process-wide libvips loader block.
import { storeUploadImage, UPLOAD_MAX_BYTES } from '@/lib/utils/uploadPipeline';

// undici's pinned Agent and node:dns need Node, never the edge runtime.
export const runtime = 'nodejs';
// Up to 10 s of fetching (SAFE_FETCH_TIMEOUT_MS), then the re-encode, the
// quota check and the blob write.
export const maxDuration = 30;

/**
 * Every failure to get an image out of the URL says this, and nothing else:
 * not the upstream status, its body, an address, or whether the host resolved,
 * so the endpoint can't be used to map a network.
 */
const FROM_URL_FAILED = "Couldn't fetch the image";

type RefusalReason = SafeFetchFailure | 'bad_request' | 'not_an_image' | 'unprocessable';

function failed(reason: RefusalReason) {
  // A coarse reason only: never the URL or its host, which can name a person.
  console.warn(JSON.stringify({ event: 'upload_from_url_refused', reason }));
  return NextResponse.json(
    { success: false, error: FROM_URL_FAILED },
    { status: reason === 'bad_request' ? 400 : 422 }
  );
}

// POST /api/upload/from-url - re-host an image from its URL (WIS-366).
// Body: { url, page? }: the image's https URL, and the product page it's on
// (only its origin is sent on, as Referer, for CDNs that check it). Answers as
// `POST /api/upload` does: an upload no record holds yet, which a form gives
// back through `DELETE /api/upload` if it isn't saved.
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    // Its own budget before any fetch, since each call is a request our server
    // makes; the upload one only once there's an image to store, so URLs that
    // lead nowhere don't use up the user's file uploads.
    const tier = { newAccount: session.user.newAccount };
    const limited = await enforce('uploadFromUrl', userKey(session.user.id), tier);
    if (limited) return limited;

    const body: unknown = await request.json().catch(() => null);
    const fields = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
    if (typeof fields.url !== 'string') return failed('bad_request');
    const page = typeof fields.page === 'string' ? fields.page : undefined;

    let input: Buffer;
    try {
      input = await fetchPublicBytes(fields.url, { referer: page, maxBytes: UPLOAD_MAX_BYTES });
    } catch (error) {
      return failed(error instanceof SafeFetchError ? error.reason : 'network');
    }

    // The remote `Content-Type` is the remote server's say-so; the bytes decide.
    const type = sniffUploadImageType(input);
    if (!type) return failed('not_an_image');

    const uploadLimited = await enforce('upload', userKey(session.user.id), tier);
    if (uploadLimited) return uploadLimited;

    const stored = await storeUploadImage(session.user.id, input, type);
    if (!stored.ok) {
      if (stored.reason === 'quota') {
        return NextResponse.json(
          {
            success: false,
            error: 'Upload quota reached. Delete or replace some existing images to free up space.',
          },
          { status: 413 }
        );
      }
      return failed(stored.reason === 'unsupported' ? 'not_an_image' : 'unprocessable');
    }

    return NextResponse.json({ success: true, url: stored.url }, { status: 200 });
  } catch (error) {
    // No message: it could carry the blob path, which names the user.
    console.error('Upload from a URL failed:', error instanceof Error ? error.name : 'unknown');
    return NextResponse.json(
      { success: false, error: 'Upload failed. Please try again.' },
      { status: 500 }
    );
  }
}

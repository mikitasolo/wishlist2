import { NextRequest, NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import sharp from 'sharp';
import { auth } from '@/lib/auth';
import { enforce, userKey } from '@/lib/rateLimit';
import { getUserUploadBytes, USER_UPLOAD_QUOTA_BYTES } from '@/lib/utils/blob';

// Max upload size. Vercel serverless functions cap the request body at ~4.5MB,
// so we validate a little under that.
const MAX_BYTES = 4 * 1024 * 1024;
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'];

// Re-encode an image with sharp to strip ALL metadata (EXIF/GPS/etc.) — sharp
// drops metadata unless explicitly asked to keep it, and `.rotate()` bakes in
// the EXIF orientation before that tag is discarded so the image still looks
// right. Returns the sanitized bytes and the output content type.
async function sanitizeImage(
  input: Buffer,
  type: string
): Promise<{ data: Buffer; contentType: string; ext: string }> {
  const animated = type === 'image/gif' || type === 'image/webp';
  // Orientation only applies to still images; rotating an animation can break frames.
  const base = sharp(input, { animated, failOn: 'none' });
  const pipeline = animated ? base : base.rotate();

  switch (type) {
    case 'image/png':
      return { data: await pipeline.png().toBuffer(), contentType: 'image/png', ext: 'png' };
    case 'image/webp':
      return {
        data: await pipeline.webp({ quality: 82 }).toBuffer(),
        contentType: 'image/webp',
        ext: 'webp',
      };
    case 'image/avif':
      return {
        data: await pipeline.avif({ quality: 60 }).toBuffer(),
        contentType: 'image/avif',
        ext: 'avif',
      };
    case 'image/gif':
      return { data: await pipeline.gif().toBuffer(), contentType: 'image/gif', ext: 'gif' };
    default:
      // JPEG (and anything else that slipped through) → normalized JPEG.
      return {
        data: await pipeline.jpeg({ quality: 85 }).toBuffer(),
        contentType: 'image/jpeg',
        ext: 'jpg',
      };
  }
}

// POST /api/upload - upload an image to Vercel Blob, returns its public URL.
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    // Blob storage/bandwidth costs money — cap uploads per user.
    const limited = await enforce('upload', userKey(session.user.id));
    if (limited) return limited;

    const form = await request.formData();
    const file = form.get('file');

    if (!(file instanceof File)) {
      return NextResponse.json({ success: false, error: 'No file provided' }, { status: 400 });
    }
    if (!ALLOWED.includes(file.type)) {
      return NextResponse.json(
        { success: false, error: 'Unsupported file type. Use JPEG, PNG, WebP, GIF, or AVIF.' },
        { status: 400 }
      );
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { success: false, error: 'Image is too large (max 4MB).' },
        { status: 400 }
      );
    }

    // Strip metadata before anything touches storage.
    let sanitized;
    try {
      sanitized = await sanitizeImage(Buffer.from(await file.arrayBuffer()), file.type);
    } catch {
      return NextResponse.json(
        { success: false, error: 'That image could not be processed. Try a different file.' },
        { status: 400 }
      );
    }

    // Per-user quota check against actual stored usage (self-healing, no counter drift).
    const used = await getUserUploadBytes(session.user.id);
    if (used + sanitized.data.length > USER_UPLOAD_QUOTA_BYTES) {
      return NextResponse.json(
        {
          success: false,
          error: 'Upload quota reached. Delete or replace some existing images to free up space.',
        },
        { status: 413 }
      );
    }

    const blob = await put(`uploads/${session.user.id}/image.${sanitized.ext}`, sanitized.data, {
      access: 'public',
      addRandomSuffix: true,
      contentType: sanitized.contentType,
    });

    return NextResponse.json({ success: true, url: blob.url }, { status: 200 });
  } catch (error) {
    console.error('Upload error:', error);
    // Most common cause: BLOB_READ_WRITE_TOKEN not configured.
    return NextResponse.json(
      { success: false, error: 'Upload failed. Please try again.' },
      { status: 500 }
    );
  }
}

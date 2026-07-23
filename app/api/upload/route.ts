import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { put } from '@vercel/blob';
import { authOptions } from '@/lib/auth';

// Max upload size. Vercel serverless functions cap the request body at ~4.5MB,
// so we validate a little under that.
const MAX_BYTES = 4 * 1024 * 1024;
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'];

// POST /api/upload - upload an image to Vercel Blob, returns its public URL.
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

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

    const ext = file.type.split('/')[1] || 'png';
    const blob = await put(`uploads/${session.user.id}/image.${ext}`, file, {
      access: 'public',
      addRandomSuffix: true,
      contentType: file.type,
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

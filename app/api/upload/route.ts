import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { enforce, userKey } from '@/lib/rateLimit';
import connectDB from '@/lib/mongodb';
import { releaseUnsavedUpload } from '@/lib/utils/unsavedUploads';
import { isUploadImageType } from '@/lib/utils/uploadImageFormat';
// Loading the pipeline also runs its process-wide libvips loader block.
import { storeUploadImage, UPLOAD_MAX_BYTES } from '@/lib/utils/uploadPipeline';

function unsupportedType() {
  return NextResponse.json(
    { success: false, error: 'Unsupported file type. Use JPEG, PNG, WebP, GIF, or AVIF.' },
    { status: 400 }
  );
}

// POST /api/upload - upload an image to Vercel Blob, returns its public URL.
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    // Blob storage/bandwidth costs money — cap uploads per user.
    const limited = await enforce('upload', userKey(session.user.id), {
      newAccount: session.user.newAccount,
    });
    if (limited) return limited;

    const form = await request.formData();
    const file = form.get('file');

    if (!(file instanceof File)) {
      return NextResponse.json({ success: false, error: 'No file provided' }, { status: 400 });
    }
    const type = file.type;
    if (!isUploadImageType(type)) return unsupportedType();
    if (file.size > UPLOAD_MAX_BYTES) {
      return NextResponse.json(
        { success: false, error: 'Image is too large (max 4MB).' },
        { status: 400 }
      );
    }

    const input = Buffer.from(await file.arrayBuffer());
    const stored = await storeUploadImage(session.user.id, input, type);
    if (!stored.ok) {
      switch (stored.reason) {
        case 'unsupported':
          return unsupportedType();
        case 'unprocessable':
          return NextResponse.json(
            { success: false, error: 'That image could not be processed. Try a different file.' },
            { status: 400 }
          );
        case 'quota':
          return NextResponse.json(
            {
              success: false,
              error:
                'Upload quota reached. Delete or replace some existing images to free up space.',
            },
            { status: 413 }
          );
      }
    }

    return NextResponse.json({ success: true, url: stored.url }, { status: 200 });
  } catch (error) {
    console.error('Upload error:', error);
    // Most common cause: BLOB_READ_WRITE_TOKEN not configured.
    return NextResponse.json(
      { success: false, error: 'Upload failed. Please try again.' },
      { status: 500 }
    );
  }
}

// DELETE /api/upload - give back an upload no form ended up saving (WIS-181).
// Body: { url }. Frees it only when it's in the caller's own uploads folder and
// nothing shows it (`releaseUnsavedUpload`). Any URL of theirs gets the same
// answer, freed or not, so it never says whether a record shows the image.
export async function DELETE(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const limited = await enforce('uploadRelease', userKey(session.user.id));
    if (limited) return limited;

    const body: unknown = await request.json().catch(() => null);
    const url =
      body && typeof body === 'object' && 'url' in body && typeof body.url === 'string'
        ? body.url
        : null;
    if (!url) {
      return NextResponse.json({ success: false, error: 'No image given' }, { status: 400 });
    }

    await connectDB();
    await releaseUnsavedUpload(url, session.user.id);
    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    // No URL in the line: an uploads folder names its user.
    console.error('Releasing an upload failed:', error instanceof Error ? error.name : 'unknown');
    return NextResponse.json(
      { success: false, error: 'Could not release the image.' },
      { status: 500 }
    );
  }
}

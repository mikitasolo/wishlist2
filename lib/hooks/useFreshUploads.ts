'use client';

import { useEffect, useState } from 'react';
import { createFreshUploads, releaseUpload, type FreshUploads } from '@/lib/utils/freshUploads';

/**
 * The uploads a form holds that no save has taken yet (`createFreshUploads`),
 * handed back to the server when the form lets go of them. Closed when the
 * component unmounts, or while `open` is false (a modal that stays mounted
 * while it's closed), which hands back everything still unsaved.
 */
export function useFreshUploads(open = true): FreshUploads {
  const [uploads] = useState(() => createFreshUploads(releaseUpload));
  useEffect(() => {
    if (!open) {
      uploads.close();
      return;
    }
    uploads.open();
    return () => uploads.close();
  }, [open, uploads]);
  return uploads;
}

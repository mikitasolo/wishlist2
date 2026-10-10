'use client';

import { lazyDialog } from '@/components/lazyDialog';

// Dialogs used by more than one screen, declared once (WIS-438).
export const CreateWishlistModal = lazyDialog(() => import('@/components/CreateWishlistModal'));
export const StartFromListModal = lazyDialog(() => import('@/components/StartFromListModal'));

'use client';

import { useState } from 'react';
import Icon from './Icon';
import { useToast } from './ToastProvider';

interface ShareButtonProps {
  /** URL to copy. Defaults to the current page URL. */
  url?: string;
  label?: string;
  className?: string;
}

/**
 * Copies a link to the clipboard and confirms with a toast + a brief
 * check-mark state. Used to share wishlist and profile pages.
 */
export default function ShareButton({ url, label = 'Share', className = '' }: ShareButtonProps) {
  const { showToast } = useToast();
  const [copied, setCopied] = useState(false);

  async function copy() {
    const link = url ?? (typeof window !== 'undefined' ? window.location.href : '');
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      showToast('Link copied to clipboard', 'success');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      showToast('Could not copy the link', 'error');
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label="Copy link to share"
      className={`inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-surface px-3.5 text-[13px] font-semibold text-foreground shadow-xs transition-colors hover:bg-surface-hover ${className}`}
    >
      <Icon name={copied ? 'check' : 'link'} size={15} />
      {copied ? 'Copied' : label}
    </button>
  );
}

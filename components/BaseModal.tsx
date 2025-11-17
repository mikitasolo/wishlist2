'use client';

import { useEffect, useCallback, ReactNode } from 'react';

interface BaseModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  titleId: string;
  children: ReactNode;
  isSubmitting?: boolean;
  // Optional: function to check if close should be intercepted
  shouldInterceptClose?: () => boolean;
  // Optional: function to handle intercepted close (e.g., show confirmation)
  onInterceptClose?: () => void;
}

export default function BaseModal({
  isOpen,
  onClose,
  title,
  titleId,
  children,
  isSubmitting = false,
  shouldInterceptClose,
  onInterceptClose,
}: BaseModalProps) {
  const handleClose = useCallback(() => {
    if (shouldInterceptClose && shouldInterceptClose() && onInterceptClose) {
      onInterceptClose();
    } else {
      onClose();
    }
  }, [shouldInterceptClose, onInterceptClose, onClose]);

  // Handle Escape key press
  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSubmitting) {
        handleClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, isSubmitting, handleClose]);

  // Prevent body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      // Save the current scroll position
      const scrollY = window.scrollY;
      
      // Prevent scrolling on body
      document.body.style.overflow = 'hidden';
      document.body.style.position = 'fixed';
      document.body.style.top = `-${scrollY}px`;
      document.body.style.width = '100%';
      
      // Also prevent scrolling on html element (for better mobile support)
      document.documentElement.style.overflow = 'hidden';
      
      return () => {
        // Restore scrolling
        document.body.style.overflow = '';
        document.body.style.position = '';
        document.body.style.top = '';
        document.body.style.width = '';
        document.documentElement.style.overflow = '';
        
        // Restore scroll position
        window.scrollTo(0, scrollY);
      };
    }
  }, [isOpen]);

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // Only close if clicking the backdrop itself, not the modal content
    if (e.target === e.currentTarget && !isSubmitting) {
      handleClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50"
      onClick={handleBackdropClick}
      style={{ touchAction: 'none' }}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-4 sm:p-6 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={{ touchAction: 'pan-y' }}
      >
        <div className="flex justify-between items-center mb-4 sm:mb-6">
          <h2 id={titleId} className="text-xl sm:text-2xl font-bold text-gray-800">
            {title}
          </h2>
          <button
            onClick={handleClose}
            className="text-gray-500 hover:text-gray-700 text-2xl leading-none cursor-pointer"
            disabled={isSubmitting}
            aria-label="Close modal"
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

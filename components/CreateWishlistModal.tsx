'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from './ToastProvider';

interface CreateWishlistModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function CreateWishlistModal({ isOpen, onClose }: CreateWishlistModalProps) {
  const router = useRouter();
  const { showToast } = useToast();
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    isPublic: true,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const firstInputRef = useRef<HTMLInputElement>(null);

  // Reset form when modal closes
  useEffect(() => {
    if (!isOpen) {
      setFormData({
        name: '',
        description: '',
        isPublic: true,
      });
    }
  }, [isOpen]);

  // Focus first input when modal opens
  useEffect(() => {
    if (isOpen && firstInputRef.current) {
      setTimeout(() => firstInputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  // Handle Escape key press
  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSubmitting) {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, isSubmitting, onClose]);

  // Prevent body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const response = await fetch('/api/wishlists', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      });

      const result = await response.json();

      if (result.success) {
        showToast('Wishlist created successfully', 'success');
        onClose();
        router.push(`/wishlists/${result.data._id}`);
      } else {
        showToast(result.error || 'Failed to create wishlist', 'error');
      }
    } catch (error) {
      console.error('Error creating wishlist:', error);
      showToast('Failed to create wishlist', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // Only close if clicking the backdrop itself, not the modal content
    if (e.target === e.currentTarget && !isSubmitting) {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50"
      onClick={handleBackdropClick}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-4 sm:p-6 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-wishlist-title"
      >
        <div className="flex justify-between items-center mb-4 sm:mb-6">
          <h2 id="create-wishlist-title" className="text-xl sm:text-2xl font-bold text-gray-800">
            Create New Wishlist
          </h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 text-2xl leading-none cursor-pointer"
            disabled={isSubmitting}
            aria-label="Close modal"
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">
              Wishlist Name *
            </label>
            <input
              type="text"
              id="name"
              required
              ref={firstInputRef}
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none"
              placeholder="My Wishlist"
              disabled={isSubmitting}
              aria-required="true"
            />
          </div>

          <div>
            <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-1">
              Description
            </label>
            <textarea
              id="description"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none"
              placeholder="Optional description"
              rows={3}
              disabled={isSubmitting}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Visibility</label>
            <p className="text-xs text-gray-500 mb-2">
              Controls whether the wishlist will be visible on your profile page for non-members
            </p>
            <div className="relative flex items-center justify-between p-1 bg-gray-100 rounded-lg">
              {/* Sliding indicator */}
              <div
                className={`absolute top-1 bottom-1 left-1 bg-white rounded-md shadow-sm transition-transform duration-300 ease-in-out ${
                  formData.isPublic ? 'translate-x-0' : 'translate-x-[calc(100%+0.5rem)]'
                }`}
                style={{ width: 'calc(50% - 0.25rem)' }}
              />
              <button
                type="button"
                onClick={() => setFormData({ ...formData, isPublic: true })}
                disabled={isSubmitting}
                className={`relative z-10 flex-1 px-4 py-2 text-sm font-medium rounded-md transition-colors duration-300 cursor-pointer ${
                  formData.isPublic
                    ? 'text-gray-900'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                Public
              </button>
              <button
                type="button"
                onClick={() => setFormData({ ...formData, isPublic: false })}
                disabled={isSubmitting}
                className={`relative z-10 flex-1 px-4 py-2 text-sm font-medium rounded-md transition-colors duration-300 cursor-pointer ${
                  !formData.isPublic
                    ? 'text-gray-900'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                Private
              </button>
            </div>
          </div>

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-medium cursor-pointer"
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors font-medium disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Creating...' : 'Create Wishlist'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

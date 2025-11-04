'use client';

import { useState, useEffect } from 'react';
import { IItem } from '@/models/Item';

interface EditItemModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (updates: Partial<IItem>) => Promise<void>;
  item: IItem;
}

export default function EditItemModal({ isOpen, onClose, onSave, item }: EditItemModalProps) {
  const [formData, setFormData] = useState({
    name: item.name,
    imageUrl: item.imageUrl,
    price: item.price || '',
    link: item.link || '',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Update form when item changes
  useEffect(() => {
    setFormData({
      name: item.name,
      imageUrl: item.imageUrl,
      price: item.price || '',
      link: item.link || '',
    });
  }, [item]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      await onSave({
        name: formData.name,
        imageUrl: formData.imageUrl,
        price: formData.price || undefined,
        link: formData.link || undefined,
      });
      
      onClose();
    } catch (error) {
      console.error('Error updating item:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold text-gray-800">Edit Item</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 text-2xl leading-none"
            disabled={isSubmitting}
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">
              Item Name *
            </label>
            <input
              type="text"
              id="name"
              required
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none"
              placeholder="Enter item name"
              disabled={isSubmitting}
            />
          </div>

          <div>
            <label htmlFor="imageUrl" className="block text-sm font-medium text-gray-700 mb-1">
              Image URL *
            </label>
            <input
              type="url"
              id="imageUrl"
              required
              value={formData.imageUrl}
              onChange={(e) => setFormData({ ...formData, imageUrl: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none"
              placeholder="https://example.com/image.jpg"
              disabled={isSubmitting}
            />
          </div>

          <div>
            <label htmlFor="price" className="block text-sm font-medium text-gray-700 mb-1">
              Price
            </label>
            <input
              type="text"
              id="price"
              value={formData.price}
              onChange={(e) => setFormData({ ...formData, price: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none"
              placeholder="$99.99"
              disabled={isSubmitting}
            />
          </div>

          <div>
            <label htmlFor="link" className="block text-sm font-medium text-gray-700 mb-1">
              Product Link
            </label>
            <input
              type="url"
              id="link"
              value={formData.link}
              onChange={(e) => setFormData({ ...formData, link: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none"
              placeholder="https://example.com/product"
              disabled={isSubmitting}
            />
          </div>

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-medium"
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors font-medium disabled:opacity-50"
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}


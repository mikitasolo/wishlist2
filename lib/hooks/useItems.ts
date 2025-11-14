/**
 * Reusable API hooks for wishlist items
 */

import { useCallback } from 'react';
import { IItem } from '@/models/Item';
import { deduplicateRequest, createRequestKey } from '@/lib/utils/requestDeduplication';

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Hook for updating an item
 */
export function useUpdateItem(
  onSuccess?: (updatedItem: IItem) => void,
  onError?: (error: string) => void
) {
  return useCallback(async (id: string, updates: Partial<IItem>): Promise<IItem | null> => {
    const requestKey = createRequestKey(`/api/items/${id}`, 'PATCH', updates);
    
    try {
      const data = await deduplicateRequest(requestKey, async () => {
        const response = await fetch(`/api/items/${id}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(updates),
        });

        const result: ApiResponse<IItem> = await response.json();
        
        if (!result.success) {
          if (response.status === 403 && result.error?.includes('archived')) {
            throw new Error(result.error);
          }
          throw new Error(result.error || 'Failed to update item');
        }
        
        return result.data!;
      });
      
      onSuccess?.(data);
      return data;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to update item';
      onError?.(errorMessage);
      console.error('Error updating item:', error);
      return null;
    }
  }, [onSuccess, onError]);
}

/**
 * Hook for creating an item
 */
export function useCreateItem(
  onSuccess?: (newItem: IItem) => void,
  onError?: (error: string) => void
) {
  return useCallback(async (wishlistId: string, newItem: {
    name: string;
    imageUrl: string;
    priceInCents?: number;
    link?: string;
  }): Promise<IItem | null> => {
    const requestKey = createRequestKey(`/api/wishlists/${wishlistId}/items`, 'POST', newItem);
    
    try {
      const data = await deduplicateRequest(requestKey, async () => {
        const response = await fetch(`/api/wishlists/${wishlistId}/items`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(newItem),
        });

        const result: ApiResponse<IItem> = await response.json();
        
        if (!result.success) {
          throw new Error(result.error || 'Failed to create item');
        }
        
        return result.data!;
      });
      
      onSuccess?.(data);
      return data;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to create item';
      onError?.(errorMessage);
      console.error('Error creating item:', error);
      return null;
    }
  }, [onSuccess, onError]);
}

/**
 * Hook for deleting an item
 */
export function useDeleteItem(
  onSuccess?: () => void,
  onError?: (error: string) => void
) {
  return useCallback(async (id: string): Promise<boolean> => {
    const requestKey = createRequestKey(`/api/items/${id}`, 'DELETE');
    
    try {
      await deduplicateRequest(requestKey, async () => {
        const response = await fetch(`/api/items/${id}`, {
          method: 'DELETE',
        });

        const result: ApiResponse<void> = await response.json();
        
        if (!result.success) {
          throw new Error(result.error || 'Failed to delete item');
        }
      });
      
      onSuccess?.();
      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to delete item';
      onError?.(errorMessage);
      console.error('Error deleting item:', error);
      return false;
    }
  }, [onSuccess, onError]);
}

/**
 * Hook for fetching items
 */
export function useFetchItems() {
  return useCallback(async (wishlistId: string): Promise<IItem[]> => {
    const requestKey = createRequestKey(`/api/wishlists/${wishlistId}/items`, 'GET');
    
    try {
      const data = await deduplicateRequest(requestKey, async () => {
        const response = await fetch(`/api/wishlists/${wishlistId}/items`, { cache: 'no-store' });
        const result: ApiResponse<IItem[]> = await response.json();
        
        if (!result.success) {
          throw new Error(result.error || 'Failed to fetch items');
        }
        
        return result.data || [];
      });
      
      return data;
    } catch (error) {
      console.error('Error fetching items:', error);
      return [];
    }
  }, []);
}


'use client';

import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useCallback, useMemo } from 'react';
import { IItem } from '@/models/Item';
import { IUser } from '@/models/User';
import AddItemModal from '@/components/AddItemModal';
import EditItemModal from '@/components/EditItemModal';
import ConfirmDialog from '@/components/ConfirmDialog';
import { useToast } from '@/components/ToastProvider';
import { formatPrice } from '@/lib/utils/currency';
import { useFetchItems, useCreateItem, useUpdateItem, useDeleteItem } from '@/lib/hooks/useItems';
import Image from 'next/image';

// Admin table row component with image loading state
function AdminItemRow({
  item,
  onEdit,
  onDelete,
  onToggleComplete,
}: {
  item: IItem;
  onEdit: () => void;
  onDelete: () => void;
  onToggleComplete: () => void;
}) {
  const [imageLoading, setImageLoading] = useState(true);

  return (
    <tr className="hover:bg-gray-50">
      <td className="px-3 sm:px-6 py-3 sm:py-4">
        <div className="flex items-center">
          <div className="relative h-10 w-10 sm:h-12 sm:w-12 flex-shrink-0">
            {imageLoading && (
              <div className="absolute inset-0 bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200 animate-pulse rounded-lg" />
            )}
            <Image
              src={item.imageUrl}
              alt={item.name}
              width={48}
              height={48}
              className={`h-10 w-10 sm:h-12 sm:w-12 rounded-lg object-cover flex-shrink-0 transition-opacity duration-300 ${
                imageLoading ? 'opacity-0' : 'opacity-100'
              }`}
              onLoad={() => setImageLoading(false)}
              onError={() => setImageLoading(false)}
            />
          </div>
          <div className="ml-2 sm:ml-4 min-w-0 max-w-xs">
            <div 
              className="text-xs sm:text-sm font-medium text-gray-900 truncate"
              title={item.name}
            >
              {item.name}
            </div>
          </div>
        </div>
      </td>
      <td className="px-3 sm:px-6 py-3 sm:py-4 whitespace-nowrap text-xs sm:text-sm text-gray-900">
        {formatPrice(item.priceInCents)}
      </td>
      <td className="px-3 sm:px-6 py-3 sm:py-4 whitespace-nowrap">
        <button
          onClick={onToggleComplete}
          className="group relative cursor-pointer"
        >
          <div className="flex flex-col sm:flex-row gap-1 sm:gap-2 items-start sm:items-center">
            {item.status === 'available' && (
              <span className="px-2 py-1 text-xs font-semibold rounded-full bg-blue-100 text-blue-800 group-hover:bg-blue-200 transition-colors">
                Available
              </span>
            )}
            {item.status === 'completed' && (
              <span className="px-2 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-800 group-hover:bg-green-200 transition-colors">
                Completed
              </span>
            )}
            <span className="text-xs text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity hidden sm:inline">
              {item.status === 'completed' ? '→ Mark available' : '→ Mark completed'}
            </span>
          </div>
        </button>
      </td>
      <td className="px-3 sm:px-6 py-3 sm:py-4 whitespace-nowrap text-xs sm:text-sm">
        {item.link ? (
          <a
            href={item.link}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary-600 hover:underline"
          >
            View
          </a>
        ) : (
          '-'
        )}
      </td>
      <td className="px-3 sm:px-6 py-3 sm:py-4 whitespace-nowrap text-right text-xs sm:text-sm font-medium">
        <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 justify-end">
          <button
            onClick={onEdit}
            className="text-primary-600 hover:text-primary-900 cursor-pointer"
          >
            Edit
          </button>
          <button
            onClick={onDelete}
            className="text-red-600 hover:text-red-900 cursor-pointer"
          >
            Delete
          </button>
        </div>
      </td>
    </tr>
  );
}

export default function AdminPanel() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { showToast } = useToast();
  const [activeTab, setActiveTab] = useState<'items' | 'users'>('items');
  const [items, setItems] = useState<IItem[]>([]);
  const [users, setUsers] = useState<IUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [itemToEdit, setItemToEdit] = useState<IItem | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'user' | 'admin'>('user');
  const [isInviting, setIsInviting] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<string | null>(null);

  // API hooks
  const fetchItemsHook = useFetchItems();
  
  const createItemHook = useCreateItem(
    (newItem) => {
      // Success callback - optimistic update already done, just confirm
      showToast('Item added successfully', 'success');
    },
    (error) => {
      // Error callback - rollback optimistic update
      setItems((prevItems) => prevItems.filter((item) => item._id !== 'temp-id'));
      showToast(error, 'error');
    }
  );

  const updateItemHook = useUpdateItem(
    (updatedItem) => {
      // Success callback - update with server response
      setItems((prevItems) =>
        prevItems.map((item) => (item._id === updatedItem._id ? updatedItem : item))
      );
      showToast('Item updated successfully', 'success');
    },
    (error) => {
      // Error callback - rollback optimistic update
      fetchItemsHook(true).then((data) => setItems(data));
      showToast(error, 'error');
    }
  );

  const deleteItemHook = useDeleteItem(
    () => {
      // Success callback - optimistic update already done, just confirm
      showToast('Item deleted successfully', 'success');
    },
    (error) => {
      // Error callback - rollback optimistic update
      fetchItemsHook(true).then((data) => setItems(data));
      showToast(error, 'error');
    }
  );

  // Memoized fetch functions
  const fetchItems = useCallback(async () => {
    try {
      const data = await fetchItemsHook(false);
      setItems(data);
    } catch (error) {
      console.error('Error fetching items:', error);
    }
  }, [fetchItemsHook]);

  const fetchUsers = useCallback(async () => {
    try {
      const response = await fetch('/api/invite');
      const data = await response.json();
      if (data.success) {
        setUsers(data.data);
      }
    } catch (error) {
      console.error('Error fetching users:', error);
    }
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    await Promise.all([fetchItems(), fetchUsers()]);
    setLoading(false);
  }, [fetchItems, fetchUsers]);

  useEffect(() => {
    if (status === 'loading') return;
    
    if (!session?.user || session.user.role !== 'admin') {
      router.push('/');
      return;
    }

    // Only fetch once when component mounts and user is authenticated
    if (items.length === 0 && users.length === 0) {
      fetchData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, router, session?.user]);

  // Memoized handlers with optimistic updates
  const handleAddItem = useCallback(async (newItem: {
    name: string;
    imageUrl: string;
    priceInCents?: number;
    link?: string;
  }) => {
    // Optimistic update - add temporary item
    const tempItem: IItem = {
      ...newItem,
      _id: 'temp-id',
      status: 'available',
      createdAt: new Date(),
      updatedAt: new Date(),
    } as IItem;
    setItems((prevItems) => [tempItem, ...prevItems]);

    // Call the hook - it will handle success/error via callbacks
    const result = await createItemHook(newItem);
    if (result) {
      // Replace temp item with real item
      setItems((prevItems) =>
        prevItems.map((item) => (item._id === 'temp-id' ? result : item))
      );
    }
  }, [createItemHook]);

  const handleEditItem = useCallback(async (updates: Partial<IItem>) => {
    if (!itemToEdit) return;

    // Optimistic update
    setItems((prevItems) =>
      prevItems.map((item) =>
        item._id === itemToEdit._id ? { ...item, ...updates } : item
      )
    );

    // Call the hook - it will handle success/error via callbacks
    await updateItemHook(itemToEdit._id!, updates);
  }, [itemToEdit, updateItemHook]);

  const handleToggleComplete = useCallback(async (itemId: string, currentStatus: string) => {
    const newStatus = currentStatus === 'completed' ? 'available' : 'completed';
    
    // Optimistic update
    setItems((prevItems) =>
      prevItems.map((item) =>
        item._id === itemId ? { ...item, status: newStatus as 'available' | 'completed' } : item
      )
    );

    // Call the hook - it will handle success/error via callbacks
    await updateItemHook(itemId, { status: newStatus });
    
    showToast(
      `Item ${newStatus === 'completed' ? 'completed' : 'marked as available'}`,
      'success'
    );
  }, [updateItemHook, showToast]);

  const handleDeleteItem = useCallback(async () => {
    if (!itemToDelete) return;

    // Optimistic update - remove item immediately
    const itemToRemove = items.find((item) => item._id === itemToDelete);
    setItems((prevItems) => prevItems.filter((item) => item._id !== itemToDelete));
    setItemToDelete(null);

    // Call the hook - it will handle success/error via callbacks
    const success = await deleteItemHook(itemToDelete);
    if (!success && itemToRemove) {
      // Rollback on error
      setItems((prevItems) => [...prevItems, itemToRemove]);
    }
  }, [itemToDelete, items, deleteItemHook]);

  const handleInviteUser = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setIsInviting(true);

    // Optimistic update
    const tempUser: IUser = {
      _id: 'temp-id',
      email: inviteEmail,
      role: inviteRole,
      emailVerified: undefined,
      isArchived: false,
      isInvited: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as IUser;
    setUsers((prevUsers) => [tempUser, ...prevUsers]);
    const email = inviteEmail;
    setInviteEmail('');
    setInviteRole('user');

    try {
      const response = await fetch('/api/invite', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, role: inviteRole }),
      });

      const data = await response.json();
      if (data.success) {
        // Replace temp user with real user
        setUsers((prevUsers) =>
          prevUsers.map((user) => (user._id === 'temp-id' ? data.data : user))
        );
        showToast(`Invitation sent to ${email}`, 'success');
      } else {
        // Rollback on error
        setUsers((prevUsers) => prevUsers.filter((user) => user._id !== 'temp-id'));
        showToast(data.error || 'Failed to invite user', 'error');
      }
    } catch (error) {
      // Rollback on error
      setUsers((prevUsers) => prevUsers.filter((user) => user._id !== 'temp-id'));
      console.error('Error inviting user:', error);
      showToast('Failed to invite user', 'error');
    } finally {
      setIsInviting(false);
    }
  }, [inviteEmail, inviteRole, showToast]);

  const handleToggleArchive = useCallback(async (userId: string, currentStatus: boolean) => {
    // Optimistic update
    setUsers((prevUsers) =>
      prevUsers.map((user) =>
        user._id === userId ? { ...user, isArchived: !currentStatus } : user
      )
    );

    try {
      const response = await fetch('/api/invite', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ userId, isArchived: !currentStatus }),
      });

      const data = await response.json();
      if (data.success) {
        // Update with server response
        setUsers((prevUsers) =>
          prevUsers.map((user) => (user._id === userId ? data.data : user))
        );
        showToast(
          `User ${!currentStatus ? 'archived' : 'unarchived'} successfully`,
          'success'
        );
      } else {
        // Rollback on error
        setUsers((prevUsers) =>
          prevUsers.map((user) =>
            user._id === userId ? { ...user, isArchived: currentStatus } : user
          )
        );
        showToast(data.error || 'Failed to update user', 'error');
      }
    } catch (error) {
      // Rollback on error
      setUsers((prevUsers) =>
        prevUsers.map((user) =>
          user._id === userId ? { ...user, isArchived: currentStatus } : user
        )
      );
      console.error('Error updating user:', error);
      showToast('Failed to update user', 'error');
    }
  }, [showToast]);

  // Memoized handlers for AdminItemRow callbacks
  const handleEditClick = useCallback((item: IItem) => {
    setItemToEdit(item);
  }, []);

  const handleDeleteClick = useCallback((itemId: string) => {
    setItemToDelete(itemId);
  }, []);

  const handleToggleCompleteClick = useCallback((itemId: string, currentStatus: string) => {
    handleToggleComplete(itemId, currentStatus);
  }, [handleToggleComplete]);

  if (status === 'loading' || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-pink-100 to-white">
      <div className="max-w-7xl mx-auto px-4 py-4 sm:py-6 lg:py-8 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center mb-6 sm:mb-8 gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-gray-900 mb-1 sm:mb-2">Admin Panel</h1>
            <p className="text-sm sm:text-base text-gray-600">Manage wishlist items and users</p>
          </div>
          <button
            onClick={() => router.push('/')}
            className="bg-gray-200 text-gray-700 px-3 sm:px-4 py-2 rounded-lg text-sm sm:text-base font-medium hover:bg-gray-300 transition-colors cursor-pointer w-full sm:w-auto"
          >
            ← Back to Wishlist
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 sm:gap-4 mb-6 sm:mb-8 border-b border-gray-200 overflow-x-auto">
          <button
            onClick={() => setActiveTab('items')}
            className={`pb-3 px-3 sm:px-4 text-sm sm:text-base font-medium transition-colors cursor-pointer whitespace-nowrap flex-shrink-0 ${
              activeTab === 'items'
                ? 'text-primary-600 border-b-2 border-primary-600'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Items ({items.length})
          </button>
          <button
            onClick={() => setActiveTab('users')}
            className={`pb-3 px-3 sm:px-4 text-sm sm:text-base font-medium transition-colors cursor-pointer whitespace-nowrap flex-shrink-0 ${
              activeTab === 'users'
                ? 'text-primary-600 border-b-2 border-primary-600'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Users ({users.length})
          </button>
        </div>

        {/* Items Tab */}
        {activeTab === 'items' && (
          <div>
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center mb-4 sm:mb-6 gap-3 sm:gap-0">
              <h2 className="text-xl sm:text-2xl font-semibold text-gray-900">Wishlist Items</h2>
              <button
                onClick={() => setIsAddModalOpen(true)}
                className="bg-primary-600 text-white px-4 sm:px-6 py-2 rounded-lg text-sm sm:text-base font-medium hover:bg-primary-700 transition-colors cursor-pointer w-full sm:w-auto"
              >
                + Add Item
              </button>
            </div>

            {items.length === 0 ? (
              <div className="bg-white rounded-xl p-8 sm:p-12 text-center">
                <div className="text-4xl sm:text-6xl mb-4">📦</div>
                <p className="text-sm sm:text-base text-gray-600">No items yet. Add your first item!</p>
              </div>
            ) : (
              <div className="bg-white rounded-xl shadow-md overflow-hidden">
                <div className="overflow-x-auto -mx-4 sm:mx-0">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Item
                        </th>
                        <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Price
                        </th>
                        <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Status
                        </th>
                        <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Link
                        </th>
                        <th className="px-3 sm:px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {items.map((item) => (
                        <AdminItemRow
                          key={item._id}
                          item={item}
                          onEdit={() => handleEditClick(item)}
                          onDelete={() => handleDeleteClick(item._id!)}
                          onToggleComplete={() => handleToggleCompleteClick(item._id!, item.status)}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Users Tab */}
        {activeTab === 'users' && (
          <div>
            <h2 className="text-xl sm:text-2xl font-semibold text-gray-900 mb-4 sm:mb-6">Invite Users</h2>

            {/* Invite Form */}
            <div className="bg-white rounded-xl shadow-md p-4 sm:p-6 mb-6 sm:mb-8">
              <h3 className="text-base sm:text-lg font-semibold text-gray-900 mb-3 sm:mb-4">Send Invitation</h3>
              <form onSubmit={handleInviteUser} className="flex flex-col sm:flex-row gap-3 sm:gap-4">
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="Email address"
                  required
                  className="flex-1 px-3 sm:px-4 py-2 text-sm sm:text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none"
                  disabled={isInviting}
                />
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as 'user' | 'admin')}
                  className="pl-3 pr-8 sm:pr-12 py-2 text-sm sm:text-base border border-gray-300 rounded-lg bg-white text-gray-700 font-medium focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none appearance-none bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20fill%3D%22none%22%20viewBox%3D%220%200%2020%2020%22%3E%3Cpath%20stroke%3D%22%236b7280%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%20stroke-width%3D%221.5%22%20d%3D%22M6%208l4%204%204-4%22%2F%3E%3C%2Fsvg%3E')] bg-[length:1.5em_1.5em] bg-[right_0.5rem_center] bg-no-repeat"
                  disabled={isInviting}
                >
                  <option value="user">User</option>
                  <option value="admin">Admin</option>
                </select>
                <button
                  type="submit"
                  disabled={isInviting}
                  className="bg-primary-600 text-white px-4 sm:px-6 py-2 rounded-lg text-sm sm:text-base font-medium hover:bg-primary-700 transition-colors disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed w-full sm:w-auto"
                >
                  {isInviting ? 'Inviting...' : 'Invite'}
                </button>
              </form>
            </div>

            {/* Users List */}
            <div className="bg-white rounded-xl shadow-md overflow-hidden">
              <div className="overflow-x-auto -mx-4 sm:mx-0">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Email
                      </th>
                      <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Role
                      </th>
                      <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider hidden md:table-cell">
                        Email Verified
                      </th>
                      <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Status
                      </th>
                      <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider hidden lg:table-cell">
                        Invited By
                      </th>
                      <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider hidden lg:table-cell">
                        Joined
                      </th>
                      <th className="px-3 sm:px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {users.map((user) => (
                      <tr key={user._id} className={`hover:bg-gray-50 ${user.isArchived ? 'opacity-60' : ''}`}>
                        <td className="px-3 sm:px-6 py-3 sm:py-4 whitespace-nowrap text-xs sm:text-sm text-gray-900">
                          <div className="max-w-[150px] sm:max-w-none truncate">
                            {user.email}
                            {user.email === session?.user?.email && (
                              <span className="ml-2 text-xs text-gray-500">(you)</span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 sm:px-6 py-3 sm:py-4 whitespace-nowrap">
                          <span
                            className={`px-2 py-1 text-xs font-semibold rounded-full ${
                              user.role === 'admin'
                                ? 'bg-primary-100 text-primary-800'
                                : 'bg-gray-100 text-gray-800'
                            }`}
                          >
                            {user.role}
                          </span>
                        </td>
                        <td className="px-3 sm:px-6 py-3 sm:py-4 whitespace-nowrap hidden md:table-cell">
                          <span
                            className={`px-2 py-1 text-xs font-semibold rounded-full ${
                              user.emailVerified
                                ? 'bg-green-100 text-green-800'
                                : 'bg-yellow-100 text-yellow-800'
                            }`}
                          >
                            {user.emailVerified ? 'Verified' : 'Not Verified'}
                          </span>
                        </td>
                        <td className="px-3 sm:px-6 py-3 sm:py-4 whitespace-nowrap">
                          <span
                            className={`px-2 py-1 text-xs font-semibold rounded-full ${
                              user.isArchived
                                ? 'bg-red-100 text-red-800'
                                : 'bg-green-100 text-green-800'
                            }`}
                          >
                            {user.isArchived ? 'Archived' : 'Active'}
                          </span>
                        </td>
                        <td className="px-3 sm:px-6 py-3 sm:py-4 whitespace-nowrap text-xs sm:text-sm text-gray-600 hidden lg:table-cell">
                          {user.invitedBy || '-'}
                        </td>
                        <td className="px-3 sm:px-6 py-3 sm:py-4 whitespace-nowrap text-xs sm:text-sm text-gray-600 hidden lg:table-cell">
                          {user.createdAt ? new Date(user.createdAt).toLocaleDateString() : '-'}
                        </td>
                        <td className="px-3 sm:px-6 py-3 sm:py-4 whitespace-nowrap text-right text-xs sm:text-sm font-medium">
                          {user.email !== session?.user?.email && (
                            <button
                              onClick={() => handleToggleArchive(user._id, user.isArchived)}
                              className={`cursor-pointer ${
                                user.isArchived
                                  ? 'text-green-600 hover:text-green-900'
                                  : 'text-red-600 hover:text-red-900'
                              }`}
                            >
                              {user.isArchived ? 'Unarchive' : 'Archive'}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Add Item Modal */}
      <AddItemModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onAdd={handleAddItem}
      />

      {/* Edit Item Modal */}
      {itemToEdit && (
        <EditItemModal
          isOpen={!!itemToEdit}
          onClose={() => setItemToEdit(null)}
          onSave={handleEditItem}
          item={itemToEdit}
        />
      )}

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={!!itemToDelete}
        title="Delete Item"
        message="Are you sure you want to delete this item? This action cannot be undone."
        onConfirm={handleDeleteItem}
        onCancel={() => setItemToDelete(null)}
        confirmText="Delete"
        cancelText="Cancel"
        type="danger"
      />
    </div>
  );
}


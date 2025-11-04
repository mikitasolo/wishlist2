'use client';

import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { IItem } from '@/models/Item';
import { IUser } from '@/models/User';
import AddItemModal from '@/components/AddItemModal';
import EditItemModal from '@/components/EditItemModal';
import ConfirmDialog from '@/components/ConfirmDialog';
import { useToast } from '@/components/ToastProvider';

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
  }, [status]);

  const fetchData = async () => {
    setLoading(true);
    await Promise.all([fetchItems(), fetchUsers()]);
    setLoading(false);
  };

  const fetchItems = async () => {
    try {
      const response = await fetch('/api/items');
      const data = await response.json();
      if (data.success) {
        setItems(data.data);
      }
    } catch (error) {
      console.error('Error fetching items:', error);
    }
  };

  const fetchUsers = async () => {
    try {
      const response = await fetch('/api/invite');
      const data = await response.json();
      if (data.success) {
        setUsers(data.data);
      }
    } catch (error) {
      console.error('Error fetching users:', error);
    }
  };

  const handleAddItem = async (newItem: {
    name: string;
    imageUrl: string;
    price?: string;
    link?: string;
  }) => {
    try {
      const response = await fetch('/api/items', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(newItem),
      });

      const data = await response.json();
      if (data.success) {
        setItems([data.data, ...items]);
        showToast('Item added successfully', 'success');
      } else {
        showToast('Failed to add item', 'error');
      }
    } catch (error) {
      console.error('Error adding item:', error);
      showToast('Failed to add item', 'error');
    }
  };

  const handleEditItem = async (updates: Partial<IItem>) => {
    if (!itemToEdit) return;

    try {
      const response = await fetch(`/api/items/${itemToEdit._id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updates),
      });

      const data = await response.json();
      if (data.success) {
        setItems(items.map((item) => (item._id === itemToEdit._id ? data.data : item)));
        showToast('Item updated successfully', 'success');
      } else {
        showToast('Failed to update item', 'error');
      }
    } catch (error) {
      console.error('Error updating item:', error);
      showToast('Failed to update item', 'error');
    }
  };

  const handleDeleteItem = async () => {
    if (!itemToDelete) return;

    try {
      const response = await fetch(`/api/items/${itemToDelete}`, {
        method: 'DELETE',
      });

      const data = await response.json();
      if (data.success) {
        setItems(items.filter((item) => item._id !== itemToDelete));
        showToast('Item deleted successfully', 'success');
      } else {
        showToast('Failed to delete item', 'error');
      }
    } catch (error) {
      console.error('Error deleting item:', error);
      showToast('Failed to delete item', 'error');
    } finally {
      setItemToDelete(null);
    }
  };

  const handleInviteUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsInviting(true);

    try {
      const response = await fetch('/api/invite', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      });

      const data = await response.json();
      if (data.success) {
        setUsers([data.data, ...users]);
        const email = inviteEmail;
        setInviteEmail('');
        setInviteRole('user');
        showToast(`Invitation sent to ${email}`, 'success');
      } else {
        showToast(data.error || 'Failed to invite user', 'error');
      }
    } catch (error) {
      console.error('Error inviting user:', error);
      showToast('Failed to invite user', 'error');
    } finally {
      setIsInviting(false);
    }
  };

  const handleToggleArchive = async (userId: string, currentStatus: boolean) => {
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
        setUsers(users.map((user) => (user._id === userId ? data.data : user)));
        showToast(
          `User ${!currentStatus ? 'archived' : 'unarchived'} successfully`,
          'success'
        );
      } else {
        showToast(data.error || 'Failed to update user', 'error');
      }
    } catch (error) {
      console.error('Error updating user:', error);
      showToast('Failed to update user', 'error');
    }
  };

  if (status === 'loading' || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-pink-100 to-white">
      <div className="max-w-7xl mx-auto px-4 py-8 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-4xl font-bold text-gray-900 mb-2">Admin Panel</h1>
            <p className="text-gray-600">Manage wishlist items and users</p>
          </div>
          <button
            onClick={() => router.push('/')}
            className="bg-gray-200 text-gray-700 px-4 py-2 rounded-lg font-medium hover:bg-gray-300 transition-colors"
          >
            ← Back to Wishlist
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-4 mb-8 border-b border-gray-200">
          <button
            onClick={() => setActiveTab('items')}
            className={`pb-3 px-4 font-medium transition-colors ${
              activeTab === 'items'
                ? 'text-primary-600 border-b-2 border-primary-600'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Items ({items.length})
          </button>
          <button
            onClick={() => setActiveTab('users')}
            className={`pb-3 px-4 font-medium transition-colors ${
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
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-semibold text-gray-900">Wishlist Items</h2>
              <button
                onClick={() => setIsAddModalOpen(true)}
                className="bg-primary-600 text-white px-6 py-2 rounded-lg font-medium hover:bg-primary-700 transition-colors"
              >
                + Add Item
              </button>
            </div>

            {items.length === 0 ? (
              <div className="bg-white rounded-xl p-12 text-center">
                <div className="text-6xl mb-4">📦</div>
                <p className="text-gray-600">No items yet. Add your first item!</p>
              </div>
            ) : (
              <div className="bg-white rounded-xl shadow-md overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Item
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Price
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Status
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Link
                        </th>
                        <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {items.map((item) => (
                        <tr key={item._id} className="hover:bg-gray-50">
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="flex items-center">
                              <img
                                src={item.imageUrl}
                                alt={item.name}
                                className="h-12 w-12 rounded-lg object-cover"
                              />
                              <div className="ml-4">
                                <div className="text-sm font-medium text-gray-900">
                                  {item.name}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            {item.price || '-'}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="flex gap-2">
                              {item.status === 'available' && (
                                <span className="px-2 py-1 text-xs font-semibold rounded-full bg-blue-100 text-blue-800">
                                  Available
                                </span>
                              )}
                              {item.status === 'completed' && (
                                <span className="px-2 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-800">
                                  Completed
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm">
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
                          <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                            <div className="flex gap-3 justify-end">
                              <button
                                onClick={() => setItemToEdit(item)}
                                className="text-primary-600 hover:text-primary-900"
                              >
                                Edit
                              </button>
                              <button
                                onClick={() => setItemToDelete(item._id)}
                                className="text-red-600 hover:text-red-900"
                              >
                                Delete
                              </button>
                            </div>
                          </td>
                        </tr>
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
            <h2 className="text-2xl font-semibold text-gray-900 mb-6">Invite Users</h2>

            {/* Invite Form */}
            <div className="bg-white rounded-xl shadow-md p-6 mb-8">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Send Invitation</h3>
              <form onSubmit={handleInviteUser} className="flex gap-4">
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="Email address"
                  required
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none"
                  disabled={isInviting}
                />
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as 'user' | 'admin')}
                  className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none"
                  disabled={isInviting}
                >
                  <option value="user">User</option>
                  <option value="admin">Admin</option>
                </select>
                <button
                  type="submit"
                  disabled={isInviting}
                  className="bg-primary-600 text-white px-6 py-2 rounded-lg font-medium hover:bg-primary-700 transition-colors disabled:opacity-50"
                >
                  {isInviting ? 'Inviting...' : 'Invite'}
                </button>
              </form>
            </div>

            {/* Users List */}
            <div className="bg-white rounded-xl shadow-md overflow-hidden">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Email
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Role
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Status
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Invited By
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Joined
                      </th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {users.map((user) => (
                      <tr key={user._id} className={`hover:bg-gray-50 ${user.isArchived ? 'opacity-60' : ''}`}>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {user.email}
                          {user.email === session?.user?.email && (
                            <span className="ml-2 text-xs text-gray-500">(you)</span>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
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
                        <td className="px-6 py-4 whitespace-nowrap">
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
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                          {user.invitedBy || '-'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                          {user.createdAt ? new Date(user.createdAt).toLocaleDateString() : '-'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                          {user.email !== session?.user?.email && (
                            <button
                              onClick={() => handleToggleArchive(user._id, user.isArchived)}
                              className={`${
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


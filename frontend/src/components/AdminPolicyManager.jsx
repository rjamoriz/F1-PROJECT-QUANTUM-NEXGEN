import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { BACKEND_API_BASE } from '../config/endpoints';
import { useAuth } from './AuthenticationUI';

function parseAllowedCars(input) {
  const source = Array.isArray(input) ? input.join(',') : String(input || '');
  return [...new Set(
    source
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
  )];
}

const AdminPolicyManager = () => {
  const { user } = useAuth();
  const [users, setUsers] = useState([]);
  const [inputByUser, setInputByUser] = useState({});
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState({});
  const [error, setError] = useState('');
  const [statusMessage, setStatusMessage] = useState('');

  const isAdmin = String(user?.role || '').toLowerCase() === 'admin';

  const syncInputFromUsers = useCallback((nextUsers = []) => {
    setInputByUser((previous) => {
      const next = { ...previous };
      nextUsers.forEach((entry) => {
        const key = String(entry.id || '');
        if (!key) return;
        if (!Object.prototype.hasOwnProperty.call(next, key)) {
          next[key] = Array.isArray(entry.allowed_car_ids) ? entry.allowed_car_ids.join(', ') : '';
        }
      });
      return next;
    });
  }, []);

  const loadUsers = useCallback(async () => {
    if (!isAdmin) {
      return;
    }
    setIsLoading(true);
    try {
      const response = await axios.get(`${BACKEND_API_BASE}/api/auth/admin/users`);
      const nextUsers = Array.isArray(response?.data?.users) ? response.data.users : [];
      setUsers(nextUsers);
      syncInputFromUsers(nextUsers);
      setError('');
    } catch (requestError) {
      setError(requestError?.response?.data?.message || requestError?.message || 'Failed to load user policies');
    } finally {
      setIsLoading(false);
    }
  }, [isAdmin, syncInputFromUsers]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const summary = useMemo(() => {
    const adminCount = users.filter((entry) => String(entry.role || '').toLowerCase() === 'admin').length;
    const nonAdminCount = Math.max(users.length - adminCount, 0);
    return {
      total: users.length,
      admin: adminCount,
      nonAdmin: nonAdminCount,
    };
  }, [users]);

  const updatePolicy = async (targetUser) => {
    const targetId = String(targetUser?.id || '');
    if (!targetId) return;

    const allowedCars = parseAllowedCars(inputByUser[targetId]);
    if (allowedCars.length === 0) {
      setError('allowed_car_ids cannot be empty');
      return;
    }

    setIsSaving((previous) => ({ ...previous, [targetId]: true }));
    try {
      const response = await axios.patch(`${BACKEND_API_BASE}/api/auth/admin/users/${targetId}/policy`, {
        allowed_car_ids: allowedCars,
      });
      const updatedUser = response?.data?.user;
      const revokedSessions = Number(response?.data?.revoked_sessions || 0);
      if (updatedUser) {
        setUsers((previous) => previous.map((entry) => (entry.id === targetId ? updatedUser : entry)));
        setInputByUser((previous) => ({
          ...previous,
          [targetId]: Array.isArray(updatedUser.allowed_car_ids) ? updatedUser.allowed_car_ids.join(', ') : '',
        }));
      }
      setStatusMessage(
        `Policy updated for ${updatedUser?.email || targetUser?.email}. Revoked sessions: ${revokedSessions}.`
      );
      setError('');
    } catch (requestError) {
      setError(requestError?.response?.data?.message || requestError?.message || 'Failed to update policy');
      setStatusMessage('');
    } finally {
      setIsSaving((previous) => ({ ...previous, [targetId]: false }));
    }
  };

  if (!isAdmin) {
    return (
      <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
        Admin policy manager is only available to users with the `admin` role.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
      <div className="mb-4">
        <h3 className="text-xl font-semibold">Admin Policy Manager</h3>
        <p className="text-sm text-gray-600">
          Update `allowed_car_ids` and trigger token-version/session invalidation for controlled access rollout.
        </p>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-3 text-sm md:grid-cols-3">
        <div className="rounded border border-gray-200 bg-gray-50 p-3">
          <span className="font-semibold">Users:</span> {summary.total}
        </div>
        <div className="rounded border border-gray-200 bg-gray-50 p-3">
          <span className="font-semibold">Admins:</span> {summary.admin}
        </div>
        <div className="rounded border border-gray-200 bg-gray-50 p-3">
          <span className="font-semibold">Engineers/Viewers:</span> {summary.nonAdmin}
        </div>
      </div>

      {error ? (
        <div className="mb-4 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      ) : null}
      {statusMessage ? (
        <div className="mb-4 rounded border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-700">
          {statusMessage}
        </div>
      ) : null}

      <div className="mb-4 flex items-center gap-2">
        <button
          onClick={loadUsers}
          disabled={isLoading}
          className={`rounded px-3 py-2 text-sm font-medium ${
            isLoading
              ? 'cursor-not-allowed bg-gray-300 text-gray-600'
              : 'bg-blue-600 text-white hover:bg-blue-700'
          }`}
        >
          {isLoading ? 'Loading...' : 'Reload Users'}
        </button>
      </div>

      <div className="space-y-3">
        {users.map((entry) => {
          const userId = String(entry.id || '');
          const saving = Boolean(isSaving[userId]);
          const isSelf = String(entry.id || '') === String(user?.id || '');
          return (
            <div key={userId} className="rounded border border-gray-200 p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm">
                <div>
                  <span className="font-semibold">{entry.name}</span>
                  <span className="ml-2 text-gray-600">{entry.email}</span>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span className="rounded bg-gray-100 px-2 py-1">{entry.role}</span>
                  <span className="rounded bg-gray-100 px-2 py-1">token_v{entry.token_version}</span>
                  {isSelf ? <span className="rounded bg-blue-100 px-2 py-1 text-blue-700">You</span> : null}
                </div>
              </div>

              <div className="flex flex-col gap-2 md:flex-row md:items-center">
                <input
                  type="text"
                  value={inputByUser[userId] || ''}
                  onChange={(event) => {
                    const nextValue = event.target.value;
                    setInputByUser((previous) => ({ ...previous, [userId]: nextValue }));
                  }}
                  className="w-full rounded border px-3 py-2 text-sm"
                  placeholder="car-44, car-16"
                  disabled={saving}
                />
                <button
                  onClick={() => updatePolicy(entry)}
                  disabled={saving}
                  className={`rounded px-3 py-2 text-sm font-medium ${
                    saving
                      ? 'cursor-not-allowed bg-gray-300 text-gray-600'
                      : 'bg-indigo-600 text-white hover:bg-indigo-700'
                  }`}
                >
                  {saving ? 'Updating...' : 'Apply + Revoke Tokens'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default AdminPolicyManager;

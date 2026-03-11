'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { postJson, getJson } from '@/lib/api-client';
import {
  AUTH_EVENTS,
  clearStoredAuth,
  persistAuthBundle,
  readStoredAuth,
  sessionRevocationMessage,
} from '@/lib/auth-session';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState('');
  const [user, setUser] = useState(null);
  const [isHydratingUser, setIsHydratingUser] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [bannerMessage, setBannerMessage] = useState('');

  useEffect(() => {
    const stored = readStoredAuth();
    if (stored.accessToken) {
      setToken(stored.accessToken);
      setIsHydratingUser(true);
    }
    setAuthReady(true);
  }, []);

  useEffect(() => {
    const handleSessionUpdated = (event) => {
      const nextToken = String(event?.detail?.access_token || readStoredAuth().accessToken || '').trim();
      if (nextToken) {
        setBannerMessage('');
        setToken(nextToken);
      }
    };
    const handleSessionRevoked = (event) => {
      setToken('');
      setUser(null);
      setIsHydratingUser(false);
      const nextMessage = sessionRevocationMessage(event?.detail?.reason);
      setBannerMessage(nextMessage);
    };

    if (typeof window !== 'undefined') {
      window.addEventListener(AUTH_EVENTS.sessionUpdated, handleSessionUpdated);
      window.addEventListener(AUTH_EVENTS.sessionRevoked, handleSessionRevoked);
    }

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener(AUTH_EVENTS.sessionUpdated, handleSessionUpdated);
        window.removeEventListener(AUTH_EVENTS.sessionRevoked, handleSessionRevoked);
      }
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!token) {
      setIsHydratingUser(false);
      setUser(null);
      return () => {
        cancelled = true;
      };
    }

    setIsHydratingUser(true);
    const hydrateCurrentUser = async () => {
      try {
        const response = await getJson('/api/auth/me');
        if (!cancelled) {
          setUser(response?.user || null);
          setBannerMessage('');
        }
      } catch (error) {
        if (!cancelled) {
          setUser(null);
          if (Number(error?.status || 0) === 401) {
            clearStoredAuth(error?.reason || 'invalid_token');
          }
        }
      } finally {
        if (!cancelled) {
          setIsHydratingUser(false);
        }
      }
    };

    hydrateCurrentUser();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const login = async (email, password) => {
    try {
      const response = await postJson(
        '/api/auth/login',
        { email, password },
        { __skipAuthRefresh: true }
      );
      const persisted = persistAuthBundle(response || {});
      setToken(persisted.accessToken || '');
      setUser(response?.user || null);
      setBannerMessage('');
      return { success: true, user: response?.user || null };
    } catch (error) {
      return {
        success: false,
        error: error?.message || 'Login failed',
      };
    }
  };

  const register = async (name, email, password, role = 'engineer') => {
    try {
      const response = await postJson(
        '/api/auth/register',
        { name, email, password, role },
        { __skipAuthRefresh: true }
      );
      const persisted = persistAuthBundle(response || {});
      setToken(persisted.accessToken || '');
      setUser(response?.user || null);
      setBannerMessage('');
      return { success: true, user: response?.user || null };
    } catch (error) {
      return {
        success: false,
        error: error?.message || 'Registration failed',
      };
    }
  };

  const logout = async () => {
    const refreshToken = readStoredAuth().refreshToken;
    try {
      await postJson(
        '/api/auth/logout',
        refreshToken ? { refresh_token: refreshToken } : {},
        { __skipAuthRefresh: true }
      );
    } catch (_error) {
      // no-op: local logout always proceeds
    }
    clearStoredAuth('manual_logout');
    setToken('');
    setUser(null);
    setIsHydratingUser(false);
  };

  const logoutAll = async () => {
    try {
      await postJson('/api/auth/logout-all', {}, { __skipAuthRefresh: true });
    } catch (_error) {
      // no-op: local revocation still applies
    }
    clearStoredAuth('manual_logout');
    setToken('');
    setUser(null);
    setIsHydratingUser(false);
  };

  const value = useMemo(() => ({
    token,
    user,
    authReady,
    isHydratingUser,
    bannerMessage,
    setBannerMessage,
    login,
    register,
    logout,
    logoutAll,
  }), [token, user, authReady, isHydratingUser, bannerMessage]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}

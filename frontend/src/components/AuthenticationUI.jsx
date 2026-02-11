/**
 * Authentication UI Component
 * JWT-based authentication with role-based access control
 */

import React, { useState, useContext, createContext } from 'react';
import axios from 'axios';
import { User, Lock, Mail, Shield, LogIn, LogOut, UserPlus } from './lucideShim';
import { BACKEND_API_BASE } from '../config/endpoints';

// Auth Context
const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem('auth_token'));

  const login = async (email, password) => {
    try {
      const response = await axios.post(`${BACKEND_API_BASE}/api/auth/login`, {
        email,
        password
      });
      
      const { token, user } = response.data;
      setToken(token);
      setUser(user);
      localStorage.setItem('auth_token', token);
      axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
      
      return { success: true };
    } catch (error) {
      return { success: false, error: error.response?.data?.message || 'Login failed' };
    }
  };

  const register = async (name, email, password, role = 'engineer') => {
    try {
      const response = await axios.post(`${BACKEND_API_BASE}/api/auth/register`, {
        name,
        email,
        password,
        role
      });
      
      const { token, user } = response.data;
      setToken(token);
      setUser(user);
      localStorage.setItem('auth_token', token);
      axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
      
      return { success: true };
    } catch (error) {
      return { success: false, error: error.response?.data?.message || 'Registration failed' };
    }
  };

  const logout = () => {
    setToken(null);
    setUser(null);
    localStorage.removeItem('auth_token');
    delete axios.defaults.headers.common['Authorization'];
  };

  return (
    <AuthContext.Provider value={{ user, token, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};

// Login Component
const LoginForm = ({ onSwitchToRegister }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { login } = useAuth();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    const result = await login(email, password);
    
    if (!result.success) {
      setError(result.error);
    }
    
    setIsLoading(false);
  };

  return (
    <div className="w-full max-w-md p-8 bg-white rounded-lg shadow-lg">
      <div className="flex items-center justify-center mb-6">
        <Shield className="w-12 h-12 text-purple-600" />
      </div>
      
      <h2 className="text-2xl font-bold text-center mb-6">Login to Quantum-Aero</h2>

      {error && (
        <div className="mb-4 p-3 bg-red-100 border border-red-300 rounded text-red-700 text-sm">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">Email</label>
          <div className="relative">
            <Mail className="absolute left-3 top-3 w-5 h-5 text-gray-400" />
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full pl-10 pr-3 py-2 border rounded focus:ring-2 focus:ring-purple-500"
              placeholder="engineer@f1team.com"
              required
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Password</label>
          <div className="relative">
            <Lock className="absolute left-3 top-3 w-5 h-5 text-gray-400" />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full pl-10 pr-3 py-2 border rounded focus:ring-2 focus:ring-purple-500"
              placeholder="••••••••"
              required
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={isLoading}
          className={`w-full py-3 rounded font-semibold flex items-center justify-center gap-2 ${
            isLoading
              ? 'bg-gray-400 cursor-not-allowed'
              : 'bg-purple-600 hover:bg-purple-700 text-white'
          }`}
        >
          <LogIn className="w-5 h-5" />
          {isLoading ? 'Logging in...' : 'Login'}
        </button>
      </form>

      <div className="mt-6 text-center">
        <button
          onClick={onSwitchToRegister}
          className="text-purple-600 hover:text-purple-700 text-sm font-medium"
        >
          Don't have an account? Register
        </button>
      </div>

      {/* Demo Credentials */}
      <div className="mt-6 p-3 bg-gray-50 rounded text-xs text-gray-600">
        <strong>Demo Credentials:</strong><br />
        Admin: admin@qaero.com / admin123<br />
        Engineer: engineer@qaero.com / engineer123<br />
        Viewer: viewer@qaero.com / viewer123
      </div>
    </div>
  );
};

// Register Component
const RegisterForm = ({ onSwitchToLogin }) => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [role, setRole] = useState('engineer');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { register } = useAuth();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    setIsLoading(true);

    const result = await register(name, email, password, role);
    
    if (!result.success) {
      setError(result.error);
    }
    
    setIsLoading(false);
  };

  return (
    <div className="w-full max-w-md p-8 bg-white rounded-lg shadow-lg">
      <div className="flex items-center justify-center mb-6">
        <UserPlus className="w-12 h-12 text-purple-600" />
      </div>
      
      <h2 className="text-2xl font-bold text-center mb-6">Register for Quantum-Aero</h2>

      {error && (
        <div className="mb-4 p-3 bg-red-100 border border-red-300 rounded text-red-700 text-sm">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">Full Name</label>
          <div className="relative">
            <User className="absolute left-3 top-3 w-5 h-5 text-gray-400" />
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full pl-10 pr-3 py-2 border rounded focus:ring-2 focus:ring-purple-500"
              placeholder="John Doe"
              required
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Email</label>
          <div className="relative">
            <Mail className="absolute left-3 top-3 w-5 h-5 text-gray-400" />
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full pl-10 pr-3 py-2 border rounded focus:ring-2 focus:ring-purple-500"
              placeholder="engineer@f1team.com"
              required
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Role</label>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="w-full px-3 py-2 border rounded focus:ring-2 focus:ring-purple-500"
          >
            <option value="engineer">Engineer</option>
            <option value="admin">Admin</option>
            <option value="viewer">Viewer</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Password</label>
          <div className="relative">
            <Lock className="absolute left-3 top-3 w-5 h-5 text-gray-400" />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full pl-10 pr-3 py-2 border rounded focus:ring-2 focus:ring-purple-500"
              placeholder="••••••••"
              required
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Confirm Password</label>
          <div className="relative">
            <Lock className="absolute left-3 top-3 w-5 h-5 text-gray-400" />
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full pl-10 pr-3 py-2 border rounded focus:ring-2 focus:ring-purple-500"
              placeholder="••••••••"
              required
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={isLoading}
          className={`w-full py-3 rounded font-semibold flex items-center justify-center gap-2 ${
            isLoading
              ? 'bg-gray-400 cursor-not-allowed'
              : 'bg-purple-600 hover:bg-purple-700 text-white'
          }`}
        >
          <UserPlus className="w-5 h-5" />
          {isLoading ? 'Registering...' : 'Register'}
        </button>
      </form>

      <div className="mt-6 text-center">
        <button
          onClick={onSwitchToLogin}
          className="text-purple-600 hover:text-purple-700 text-sm font-medium"
        >
          Already have an account? Login
        </button>
      </div>
    </div>
  );
};

// Main Authentication UI
const AuthenticationUI = () => {
  const [showRegister, setShowRegister] = useState(false);
  const { user, logout } = useAuth();

  if (user) {
    return (
      <div className="w-full max-w-md p-8 bg-white rounded-lg shadow-lg">
        <div className="flex items-center justify-center mb-6">
          <User className="w-12 h-12 text-green-600" />
        </div>
        
        <h2 className="text-2xl font-bold text-center mb-6">Welcome Back!</h2>

        <div className="space-y-4">
          <div className="p-4 bg-green-50 border border-green-200 rounded">
            <div className="text-sm text-gray-600 mb-1">Name</div>
            <div className="font-semibold">{user.name}</div>
          </div>

          <div className="p-4 bg-blue-50 border border-blue-200 rounded">
            <div className="text-sm text-gray-600 mb-1">Email</div>
            <div className="font-semibold">{user.email}</div>
          </div>

          <div className="p-4 bg-purple-50 border border-purple-200 rounded">
            <div className="text-sm text-gray-600 mb-1">Role</div>
            <div className="font-semibold capitalize flex items-center gap-2">
              <Shield className="w-4 h-4" />
              {user.role}
            </div>
          </div>

          <button
            onClick={logout}
            className="w-full py-3 bg-red-600 hover:bg-red-700 text-white rounded font-semibold flex items-center justify-center gap-2"
          >
            <LogOut className="w-5 h-5" />
            Logout
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-purple-900 to-blue-900 p-4">
      {showRegister ? (
        <RegisterForm onSwitchToLogin={() => setShowRegister(false)} />
      ) : (
        <LoginForm onSwitchToRegister={() => setShowRegister(true)} />
      )}
    </div>
  );
};

export default AuthenticationUI;

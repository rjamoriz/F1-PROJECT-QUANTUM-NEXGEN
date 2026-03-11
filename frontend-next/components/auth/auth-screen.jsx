'use client';

import { useState } from 'react';
import { Lock, LogIn, Mail, Shield, User, UserPlus } from 'lucide-react';
import { useAuth } from '@/components/auth/auth-provider';

function LoginForm({ onSwitch }) {
  const { login } = useAuth();
  const [email, setEmail] = useState('engineer@qaero.com');
  const [password, setPassword] = useState('engineer123');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    setLoading(true);
    const result = await login(email, password);
    if (!result.success) {
      setError(result.error || 'Login failed');
    }
    setLoading(false);
  };

  return (
    <form className="qa-auth-card qa-glass" onSubmit={submit}>
      <div className="qa-auth-icon">
        <Shield size={28} />
      </div>
      <h2>Login to Quantum-Aero</h2>
      <p>Use persisted sessions with automatic token rotation.</p>

      {error ? <p className="qa-inline-error">{error}</p> : null}

      <label className="qa-auth-label">
        <span>Email</span>
        <div className="qa-auth-input-wrap">
          <Mail size={16} />
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </div>
      </label>

      <label className="qa-auth-label">
        <span>Password</span>
        <div className="qa-auth-input-wrap">
          <Lock size={16} />
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </div>
      </label>

      <button type="submit" className="qa-primary-btn qa-auth-submit" disabled={loading}>
        <LogIn size={16} />
        {loading ? 'Signing In...' : 'Sign In'}
      </button>

      <button type="button" className="qa-link-btn" onClick={onSwitch}>
        Need an account? Register
      </button>

      <div className="qa-auth-hint">
        <strong>Demo users:</strong>
        <span>admin@qaero.com / admin123</span>
        <span>engineer@qaero.com / engineer123</span>
        <span>viewer@qaero.com / viewer123</span>
      </div>
    </form>
  );
}

function RegisterForm({ onSwitch }) {
  const { register } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [role, setRole] = useState('engineer');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    setLoading(true);
    const result = await register(name, email, password, role);
    if (!result.success) {
      setError(result.error || 'Registration failed');
    }
    setLoading(false);
  };

  return (
    <form className="qa-auth-card qa-glass" onSubmit={submit}>
      <div className="qa-auth-icon">
        <UserPlus size={28} />
      </div>
      <h2>Create Account</h2>
      <p>Register a dashboard identity with role-aware car access policy.</p>

      {error ? <p className="qa-inline-error">{error}</p> : null}

      <label className="qa-auth-label">
        <span>Name</span>
        <div className="qa-auth-input-wrap">
          <User size={16} />
          <input
            type="text"
            autoComplete="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
          />
        </div>
      </label>

      <label className="qa-auth-label">
        <span>Email</span>
        <div className="qa-auth-input-wrap">
          <Mail size={16} />
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </div>
      </label>

      <label className="qa-auth-label">
        <span>Password</span>
        <div className="qa-auth-input-wrap">
          <Lock size={16} />
          <input
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </div>
      </label>

      <label className="qa-auth-label">
        <span>Confirm Password</span>
        <div className="qa-auth-input-wrap">
          <Lock size={16} />
          <input
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            required
          />
        </div>
      </label>

      <label className="qa-auth-label">
        <span>Role</span>
        <div className="qa-auth-input-wrap">
          <Shield size={16} />
          <select value={role} onChange={(event) => setRole(event.target.value)}>
            <option value="engineer">Engineer</option>
            <option value="viewer">Viewer</option>
            <option value="admin">Admin</option>
          </select>
        </div>
      </label>

      <button type="submit" className="qa-primary-btn qa-auth-submit" disabled={loading}>
        <UserPlus size={16} />
        {loading ? 'Creating Account...' : 'Create Account'}
      </button>

      <button type="button" className="qa-link-btn" onClick={onSwitch}>
        Already have an account? Login
      </button>
    </form>
  );
}

export default function AuthScreen() {
  const { bannerMessage } = useAuth();
  const [mode, setMode] = useState('login');

  return (
    <div className="qa-auth-shell">
      <div className="qa-bg-orb qa-bg-orb-a" />
      <div className="qa-bg-orb qa-bg-orb-b" />
      <div className="qa-bg-grid" />

      <div className="qa-auth-stage">
        <div className="qa-auth-copy qa-glass">
          <p className="qa-kicker">Quantum-Aero F1</p>
          <h1>Session-Aware Control Deck</h1>
          <p>
            Full auth lifecycle parity in the Next.js shell:
            JWT access, refresh rotation, and forced logout signaling.
          </p>
          {bannerMessage ? (
            <p className="qa-inline-error qa-auth-banner">{bannerMessage}</p>
          ) : null}
        </div>

        {mode === 'login' ? (
          <LoginForm onSwitch={() => setMode('register')} />
        ) : (
          <RegisterForm onSwitch={() => setMode('login')} />
        )}
      </div>
    </div>
  );
}

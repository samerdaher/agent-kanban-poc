'use client';

import { useState } from 'react';

export default function LoginPage() {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/auth/${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mode === 'signup' ? { email, name, password } : { email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Something went wrong.');
        setBusy(false);
        return;
      }
      window.location.href = '/';
    } catch {
      setError('Network error — is the server running?');
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="logo" style={{ justifyContent: 'center', fontSize: 22, marginBottom: 4 }}>
          <span className="dot" /> AgentBoard
        </div>
        <p className="auth-tagline">One Trigger · Full Context · Real Output</p>

        <div className="type-toggle" style={{ marginBottom: 18 }}>
          <button
            type="button"
            className={mode === 'login' ? 'sel-agent' : ''}
            onClick={() => setMode('login')}
          >
            Sign in
          </button>
          <button
            type="button"
            className={mode === 'signup' ? 'sel-agent' : ''}
            onClick={() => setMode('signup')}
          >
            Create account
          </button>
        </div>

        <form onSubmit={submit}>
          {mode === 'signup' && (
            <div className="field">
              <label>Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ada Lovelace"
                autoFocus
              />
            </div>
          )}
          <div className="field">
            <label>Email</label>
            <input
              type="text"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              autoFocus={mode === 'login'}
            />
          </div>
          <div className="field">
            <label>Password</label>
            <input
              type="password"
              className="pw"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === 'signup' ? 'At least 8 characters' : 'Your password'}
            />
          </div>

          {error && <div className="auth-error">{error}</div>}

          <button className="btn primary auth-submit" disabled={busy || !email || !password} type="submit">
            {busy ? 'Working…' : mode === 'login' ? 'Sign in' : 'Create account & workspace'}
          </button>
        </form>

        <p className="auth-hint">
          {mode === 'signup'
            ? 'A demo workspace is created for you so you can try the agent flows immediately.'
            : 'New here? Create an account — it takes ten seconds.'}
        </p>
      </div>
    </div>
  );
}

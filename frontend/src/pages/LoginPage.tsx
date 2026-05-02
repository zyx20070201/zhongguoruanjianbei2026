import { FormEvent, useEffect, useState } from 'react';
import { ArrowRight, KeyRound, Mail, UserRound } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import ThemeToggle from '../components/ThemeToggle';
import { useAuthStore } from '../store/authStore';

type AuthMode = 'login' | 'register';

const getErrorMessage = (error: unknown, fallback: string) => {
  if (error && typeof error === 'object' && 'response' in error) {
    const response = (error as { response?: { data?: { error?: string } } }).response;
    if (response?.data?.error) return response.data.error;
  }

  if (error instanceof Error) return error.message;
  return fallback;
};

export default function LoginPage() {
  const [mode, setMode] = useState<AuthMode>('login');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const { user, loading, login, register, hydrate } = useAuthStore();

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (user) {
      navigate('/workspaces', { replace: true });
    }
  }, [navigate, user]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    try {
      if (mode === 'login') {
        await login(identifier.trim(), password);
      } else {
        if (password !== confirmPassword) {
          setError('Passwords do not match');
          return;
        }

        await register({
          username: username.trim(),
          email: email.trim(),
          password
        });
      }

      navigate('/workspaces', { replace: true });
    } catch (submitError) {
      setError(
        getErrorMessage(
          submitError,
          mode === 'login' ? 'Unable to sign in right now' : 'Unable to create your account right now'
        )
      );
    }
  };

  return (
    <div className="workspace-shell flex min-h-full flex-1 bg-[#fbfbfa] text-[#202124]">
      <div className="absolute right-6 top-5">
        <ThemeToggle />
      </div>
      <div className="workspace-main mx-auto flex w-full max-w-5xl flex-1 flex-col items-center justify-center px-6 py-10">
        <div className="workspace-hero mb-10 text-center">
          <p className="mb-4 text-sm font-medium text-[#777b80]">AI Learning Workspace</p>
          <h1 className="text-4xl font-semibold tracking-normal text-[#202124] md:text-5xl">
            Ready when you are.
          </h1>
        </div>

        <div className="workspace-composer w-full max-w-md rounded-[28px] border border-[#deded9] bg-white p-6 shadow-[0_24px_70px_rgba(0,0,0,0.10)]">
            <div className="flex rounded-2xl bg-[var(--app-bg-elevated)] p-1">
              <button
                type="button"
                onClick={() => {
                  setMode('login');
                  setError(null);
                }}
                className={`flex-1 rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
                  mode === 'login'
                    ? 'bg-[var(--app-surface-strong)] text-[var(--app-text)] shadow-sm'
                    : 'text-[var(--app-muted)]'
                }`}
              >
                Login
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('register');
                  setError(null);
                }}
                className={`flex-1 rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
                  mode === 'register'
                    ? 'bg-[var(--app-surface-strong)] text-[var(--app-text)] shadow-sm'
                    : 'text-[var(--app-muted)]'
                }`}
              >
                Register
              </button>
            </div>

            <div className="mt-8">
              <h2 className="text-2xl font-semibold text-[var(--app-text)]">
                {mode === 'login' ? 'Welcome back' : 'Create your account'}
              </h2>
            </div>

            <form onSubmit={handleSubmit} className="mt-8 space-y-4">
              {mode === 'register' && (
                <label className="block">
                <span className="mb-2 block text-sm font-medium text-[var(--app-text)]">Username</span>
                  <div className="flex items-center rounded-2xl border border-[#deded9] bg-white px-4 shadow-sm transition focus-within:border-[#c8c8c2]">
                    <UserRound className="h-4 w-4 text-[var(--app-muted)]" />
                    <input
                      type="text"
                      value={username}
                      onChange={(event) => setUsername(event.target.value)}
                      className="w-full rounded-2xl border-0 bg-transparent px-3 py-3.5 text-sm text-[var(--app-text)] outline-none"
                      placeholder="yourname"
                      required
                    />
                  </div>
                </label>
              )}

              <label className="block">
                <span className="mb-2 block text-sm font-medium text-[var(--app-text)]">
                  {mode === 'login' ? 'Email or Username' : 'Email'}
                </span>
                <div className="flex items-center rounded-2xl border border-[#deded9] bg-white px-4 shadow-sm transition focus-within:border-[#c8c8c2]">
                  <Mail className="h-4 w-4 text-[var(--app-muted)]" />
                  <input
                    type={mode === 'login' ? 'text' : 'email'}
                    value={mode === 'login' ? identifier : email}
                    onChange={(event) =>
                      mode === 'login'
                        ? setIdentifier(event.target.value)
                        : setEmail(event.target.value)
                    }
                    className="w-full rounded-2xl border-0 bg-transparent px-3 py-3.5 text-sm text-[var(--app-text)] outline-none"
                    placeholder={mode === 'login' ? 'name or email@example.com' : 'email@example.com'}
                    required
                  />
                </div>
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-medium text-[var(--app-text)]">Password</span>
                <div className="flex items-center rounded-2xl border border-[#deded9] bg-white px-4 shadow-sm transition focus-within:border-[#c8c8c2]">
                  <KeyRound className="h-4 w-4 text-[var(--app-muted)]" />
                  <input
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className="w-full rounded-2xl border-0 bg-transparent px-3 py-3.5 text-sm text-[var(--app-text)] outline-none"
                    placeholder="At least 6 characters"
                    required
                  />
                </div>
              </label>

              {mode === 'register' && (
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-[var(--app-text)]">Confirm Password</span>
                  <div className="flex items-center rounded-2xl border border-[#deded9] bg-white px-4 shadow-sm transition focus-within:border-[#c8c8c2]">
                    <KeyRound className="h-4 w-4 text-[var(--app-muted)]" />
                    <input
                      type="password"
                      value={confirmPassword}
                      onChange={(event) => setConfirmPassword(event.target.value)}
                      className="w-full rounded-2xl border-0 bg-transparent px-3 py-3.5 text-sm text-[var(--app-text)] outline-none"
                      placeholder="Repeat your password"
                      required
                    />
                  </div>
                </label>
              )}

              {error && (
                <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[#202124] px-5 py-3.5 text-sm font-medium text-white transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span>{loading ? 'Please wait...' : mode === 'login' ? 'Login' : 'Create Account'}</span>
                {!loading && <ArrowRight className="h-4 w-4" />}
              </button>
            </form>
        </div>
      </div>
    </div>
  );
}

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
    <div className="flex min-h-full flex-1 bg-[radial-gradient(circle_at_top,_rgba(90,166,255,0.18),_transparent_38%),linear-gradient(180deg,var(--app-bg)_0%,var(--app-bg)_45%,var(--app-bg-elevated)_100%)]">
      <div className="mx-auto flex w-full max-w-6xl flex-1 items-center px-6 py-10 lg:px-10">
        <div className="grid w-full gap-8 lg:grid-cols-[1.1fr_0.9fr]">
          <section className="relative flex flex-col justify-center rounded-[2rem] border border-[var(--app-border)] bg-[var(--app-surface)] p-8 shadow-[0_30px_80px_rgba(15,23,42,0.10)] backdrop-blur md:p-12">
            <div className="absolute right-6 top-6">
              <ThemeToggle />
            </div>
            <div className="inline-flex w-fit items-center gap-2 rounded-full border border-[var(--app-border)] bg-[var(--app-accent-soft)] px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--app-accent)]">
              Study Workspace
            </div>
            <h1 className="mt-6 max-w-xl text-4xl font-semibold tracking-tight text-[var(--app-text)] md:text-5xl">
              Sign in to keep your courses, files and workbenches in sync.
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-8 text-[var(--app-muted)]">
              Use your email and password to manage learning workspaces, continue recent tasks,
              and open the same study context across dashboard, workspace and workbench pages.
            </p>
            <div className="mt-10 grid gap-4 sm:grid-cols-3">
              <div className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface-strong)] p-4 shadow-sm">
                <div className="text-sm font-semibold text-[var(--app-text)]">Email Login</div>
                <div className="mt-2 text-sm leading-6 text-[var(--app-muted)]">
                  Sign in with email or username plus password.
                </div>
              </div>
              <div className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface-strong)] p-4 shadow-sm">
                <div className="text-sm font-semibold text-[var(--app-text)]">Workspace Memory</div>
                <div className="mt-2 text-sm leading-6 text-[var(--app-muted)]">
                  Your recent workspaces stay available after refresh.
                </div>
              </div>
              <div className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface-strong)] p-4 shadow-sm">
                <div className="text-sm font-semibold text-[var(--app-text)]">Workbench Continuity</div>
                <div className="mt-2 text-sm leading-6 text-[var(--app-muted)]">
                  Jump back into resource previews and notes without losing state.
                </div>
              </div>
            </div>
          </section>

          <section className="rounded-[2rem] border border-[var(--app-border)] bg-[var(--app-surface-strong)] p-6 shadow-[0_24px_70px_rgba(15,23,42,0.10)] md:p-8">
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
              <p className="mt-2 text-sm text-[var(--app-muted)]">
                {mode === 'login'
                  ? 'Use your email or username and password to continue.'
                  : 'Register with username, email and password.'}
              </p>
            </div>

            <form onSubmit={handleSubmit} className="mt-8 space-y-4">
              {mode === 'register' && (
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-[var(--app-text)]">Username</span>
                  <div className="flex items-center rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface-strong)] px-4 shadow-sm focus-within:border-[var(--app-accent)] focus-within:ring-4 focus-within:ring-[var(--app-accent-soft)]">
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
                <div className="flex items-center rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface-strong)] px-4 shadow-sm focus-within:border-[var(--app-accent)] focus-within:ring-4 focus-within:ring-[var(--app-accent-soft)]">
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
                <div className="flex items-center rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface-strong)] px-4 shadow-sm focus-within:border-[var(--app-accent)] focus-within:ring-4 focus-within:ring-[var(--app-accent-soft)]">
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
                  <div className="flex items-center rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface-strong)] px-4 shadow-sm focus-within:border-[var(--app-accent)] focus-within:ring-4 focus-within:ring-[var(--app-accent-soft)]">
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
                className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[var(--app-accent)] px-5 py-3.5 text-sm font-medium text-white transition-colors hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span>{loading ? 'Please wait...' : mode === 'login' ? 'Login' : 'Create Account'}</span>
                {!loading && <ArrowRight className="h-4 w-4" />}
              </button>
            </form>
          </section>
        </div>
      </div>
    </div>
  );
}

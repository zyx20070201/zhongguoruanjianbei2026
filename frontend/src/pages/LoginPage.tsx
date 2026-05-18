import { FormEvent, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Building2, Globe2, KeyRound, Mail, UserRound } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { authApi } from '../services/authApi';
import { useAuthStore } from '../store/authStore';

type AuthMode = 'login' | 'register' | 'reset' | 'verify';

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
  const [resetToken, setResetToken] = useState('');
  const [resetNewPassword, setResetNewPassword] = useState('');
  const [verifyToken, setVerifyToken] = useState('');
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const { user, loading, login, register, hydrate } = useAuthStore();

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const verifyEmailToken = params.get('verifyEmailToken');
    const resetPasswordToken = params.get('resetPasswordToken');

    if (verifyEmailToken) {
      setVerifyToken(verifyEmailToken);
      setMode('verify');
    }

    if (resetPasswordToken) {
      setResetToken(resetPasswordToken);
      setMode('reset');
    }
  }, []);

  useEffect(() => {
    if (user) {
      navigate('/workspaces', { replace: true });
    }
  }, [navigate, user]);

  const switchMode = (nextMode: AuthMode) => {
    setMode(nextMode);
    setError(null);
    setInfo(null);
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setInfo(null);

    try {
      if (mode === 'login') {
        await login(identifier.trim(), password);
        navigate('/workspaces', { replace: true });
        return;
      }

      if (mode === 'reset') {
        await authApi.resetPassword(resetToken.trim(), resetNewPassword);
        setInfo('Password updated. Please sign in again.');
        setMode('login');
        setResetToken('');
        setResetNewPassword('');
        return;
      }

      if (mode === 'verify') {
        const response = await authApi.verifyEmail(verifyToken.trim());
        setInfo(response.user.emailVerified ? 'Email verified.' : 'Verification completed.');
        setVerifyToken('');
        setMode('login');
        return;
      }

      if (password !== confirmPassword) {
        setError('Passwords do not match');
        return;
      }

      await register({
        username: username.trim(),
        email: email.trim(),
        password
      });
      navigate('/workspaces', { replace: true });
    } catch (submitError) {
      setError(
        getErrorMessage(
          submitError,
          mode === 'login'
            ? 'Unable to sign in right now'
            : mode === 'register'
              ? 'Unable to create your account right now'
              : mode === 'reset'
                ? 'Unable to reset password right now'
                : 'Unable to verify email right now'
        )
      );
    }
  };

  const requestPasswordReset = async () => {
    setError(null);
    setInfo(null);
    try {
      await authApi.requestPasswordReset(identifier.trim() || email.trim());
      setInfo('If an account exists, a reset link has been sent.');
    } catch (err) {
      setError(getErrorMessage(err, 'Unable to request password reset right now'));
    }
  };

  const isRegister = mode === 'register';
  const isLogin = mode === 'login';
  const title =
    mode === 'reset'
      ? 'Reset your access'
      : mode === 'verify'
        ? 'Verify your email'
        : 'Your AI learning workspace.';
  const subtitle =
    mode === 'login'
      ? 'Sign in to continue learning'
      : mode === 'register'
        ? 'Create a workspace for focused study'
        : mode === 'reset'
          ? 'Use the reset token from your email'
          : 'Use the verification token from your email';

  return (
    <div className="notion-auth-page flex min-h-full flex-1 overflow-hidden bg-white text-[#2f2f2f]">
      <main className="notion-auth-main mx-auto flex h-screen w-full max-w-[760px] flex-col items-center px-6">
        <div className="notion-auth-logo" aria-hidden="true">
          <span>AI</span>
        </div>

        <section className="w-full max-w-[460px] text-center">
          <h1 className="notion-auth-title">{title}</h1>
          <p className="notion-auth-subtitle">{subtitle}</p>
        </section>

        <form onSubmit={handleSubmit} className="notion-auth-form w-full max-w-[460px]">
          {isRegister && (
            <NotionField
              label="Username"
              type="text"
              value={username}
              placeholder="yourname"
              onChange={setUsername}
            />
          )}

          {(isLogin || isRegister) && (
            <NotionField
              label={isLogin ? 'Email or username' : 'Work email'}
              type={isLogin ? 'text' : 'email'}
              value={isLogin ? identifier : email}
              placeholder={isLogin ? 'Enter your email or username...' : 'name@company.com'}
              onChange={isLogin ? setIdentifier : setEmail}
            />
          )}

          {(isLogin || isRegister) && (
            <div className="mt-4">
              <NotionField
                label="Password"
                type="password"
                value={password}
                placeholder="Enter your password..."
                onChange={setPassword}
              />
            </div>
          )}

          {isRegister && (
            <div className="mt-4">
              <NotionField
                label="Confirm password"
                type="password"
                value={confirmPassword}
                placeholder="Repeat your password..."
                onChange={setConfirmPassword}
              />
            </div>
          )}

          {mode === 'reset' && (
            <>
              <NotionField
                label="Reset token"
                type="text"
                value={resetToken}
                placeholder="Paste reset token..."
                onChange={setResetToken}
              />
              <div className="mt-4">
                <NotionField
                  label="New password"
                  type="password"
                  value={resetNewPassword}
                  placeholder="At least 10 characters..."
                  onChange={setResetNewPassword}
                />
              </div>
            </>
          )}

          {mode === 'verify' && (
            <NotionField
              label="Verification token"
              type="text"
              value={verifyToken}
              placeholder="Paste verification token..."
              onChange={setVerifyToken}
            />
          )}

          {isRegister && (
            <div className="notion-auth-tip mt-3 text-left">
              <strong>Tip:</strong> Use a school or work email if you want teammates to find your workspace more easily.
            </div>
          )}

          {info && <div className="notion-auth-message notion-auth-message-info mt-4">{info}</div>}
          {error && <div className="notion-auth-message notion-auth-message-error mt-4">{error}</div>}

          <button type="submit" disabled={loading} className="notion-auth-primary mt-5">
            {loading ? 'Please wait...' : isLogin ? 'Sign in' : isRegister ? 'Create account' : mode === 'reset' ? 'Reset password' : 'Verify email'}
          </button>
        </form>

        <div className="notion-auth-divider w-full max-w-[460px]">
          <span>or continue with</span>
        </div>

        <div className="notion-auth-provider-grid grid w-full max-w-[460px] grid-cols-3 gap-3">
          <ProviderButton icon={<GoogleMark />} label="Google" />
          <ProviderButton icon={<AppleMark />} label="Apple" />
          <ProviderButton icon={<MicrosoftMark />} label="Microsoft" />
        </div>
        <div className="notion-auth-provider-secondary grid w-full max-w-[310px] grid-cols-2 gap-3">
          <ProviderButton icon={<KeyRound className="h-5 w-5" />} label="Passkey" />
          <ProviderButton icon={<Building2 className="h-5 w-5" />} label="SSO" />
        </div>

        <div className="notion-auth-switch text-center text-[#8f8f8f]">
          {isLogin ? 'New user?' : 'Existing user?'}{' '}
          <button
            type="button"
            onClick={() => switchMode(isLogin ? 'register' : 'login')}
            className="underline underline-offset-2 hover:text-[#2f2f2f]"
          >
            {isLogin ? 'Sign up' : 'Log in'}
          </button>
        </div>

        <div className="notion-auth-terms text-center text-[#9a9a9a]">
          By continuing, you agree to the{' '}
          <button type="button" className="underline underline-offset-2">Terms</button>
          {' '}and{' '}
          <button type="button" className="underline underline-offset-2">Privacy Policy</button>.
        </div>

        <div className="notion-auth-language text-[#8d8d8d]">
          <button type="button" className="inline-flex items-center gap-2">
            <Globe2 className="h-4 w-4" />
            Language: English
            <span className="text-lg leading-none">⌄</span>
          </button>
        </div>

        <div className="notion-auth-secondary-actions flex flex-wrap justify-center gap-x-5 gap-y-2 text-[#9a9a9a]">
          <button type="button" onClick={requestPasswordReset} className="underline underline-offset-2">
            Forgot password
          </button>
          {mode !== 'verify' && (
            <button type="button" onClick={() => switchMode('verify')} className="underline underline-offset-2">
              Verify email
            </button>
          )}
          {mode !== 'reset' && (
            <button type="button" onClick={() => switchMode('reset')} className="underline underline-offset-2">
              Enter reset token
            </button>
          )}
        </div>
      </main>
    </div>
  );
}

function NotionField({
  label,
  type,
  value,
  placeholder,
  onChange
}: {
  label: string;
  type: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block text-left">
      <span className="notion-auth-field-label">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        required
        className="notion-auth-input"
      />
    </label>
  );
}

function ProviderButton({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <button type="button" className="notion-auth-provider">
      <span className="flex h-6 items-center justify-center">{icon}</span>
      <span>{label}</span>
    </button>
  );
}

function GoogleMark() {
  return (
    <span className="text-[21px] font-bold leading-none">
      <span className="text-[#4285f4]">G</span>
    </span>
  );
}

function AppleMark() {
  return <span className="text-[23px] leading-none">●</span>;
}

function MicrosoftMark() {
  return (
    <span className="grid h-5 w-5 grid-cols-2 gap-[2px]">
      <span className="bg-[#f25022]" />
      <span className="bg-[#7fba00]" />
      <span className="bg-[#00a4ef]" />
      <span className="bg-[#ffb900]" />
    </span>
  );
}

import { FormEvent, InputHTMLAttributes, useEffect, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Toaster, toast } from 'sonner';
import { useAuthStore } from '../store/authStore';

type AuthMode = 'signin' | 'signup';

const WEBUI_NAME = 'Synapse Link';

const getErrorMessage = (error: unknown, fallback: string) => {
  if (error && typeof error === 'object' && 'response' in error) {
    const response = (error as { response?: { data?: { error?: string } } }).response;
    if (response?.data?.error) return response.data.error;
  }

  if (error instanceof Error) return error.message;
  return fallback;
};

const isConnectionError = (error: unknown) => {
  if (!navigator.onLine) return true;
  if (!error || typeof error !== 'object') return false;

  const maybeAxiosError = error as {
    code?: string;
    message?: string;
    response?: unknown;
  };

  return (
    !maybeAxiosError.response &&
    (maybeAxiosError.code === 'ERR_NETWORK' ||
      maybeAxiosError.code === 'ECONNABORTED' ||
      maybeAxiosError.message?.toLowerCase().includes('network'))
  );
};

export default function LoginPage() {
  const [mode, setMode] = useState<AuthMode>('signin');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [confirmPasswordVisible, setConfirmPasswordVisible] = useState(false);
  const navigate = useNavigate();
  const { user, loading, hydrated, login, register, hydrate } = useAuthStore();

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (!navigator.onLine) toast.warning('Connection lost. Reconnecting...');

    const handleOffline = () => toast.warning('Connection lost. Reconnecting...');
    const handleOnline = () => toast.success('Reconnected');

    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);

    return () => {
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
    };
  }, []);

  const switchMode = (nextMode: AuthMode) => {
    setMode(nextMode);
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();

    try {
      if (mode === 'signin') {
        await login(identifier.trim(), password);
        navigate('/workspaces', { replace: true });
        return;
      }

      if (password !== confirmPassword) {
        toast.error('两次输入的密码不一致');
        return;
      }

      await register({
        username: username.trim(),
        email: email.trim(),
        password
      });
      navigate('/workspaces', { replace: true });
    } catch (submitError) {
      if (isConnectionError(submitError)) toast.warning('Connection lost. Reconnecting...');
      toast.error(
        getErrorMessage(
          submitError,
          mode === 'signin'
            ? 'The email or password provided is incorrect.\nPlease check for typos and try logging in again.'
            : '注册失败，请稍后再试'
        )
      );
    }
  };

  const isSignin = mode === 'signin';

  if (hydrated && user) {
    return <Navigate to="/workspaces" replace />;
  }

  return (
    <div className="w-full h-screen max-h-[100dvh] text-white relative" id="auth-page">
      <div className="w-full h-full absolute top-0 left-0 bg-white dark:bg-black"></div>
      <div className="w-full absolute top-0 left-0 right-0 h-8 drag-region" />

      <Toaster richColors position="top-right" closeButton />

      <div
        className="fixed bg-transparent min-h-screen w-full flex justify-center font-primary z-50 text-black dark:text-white"
        id="auth-container"
      >
        <div className="w-full px-10 min-h-screen flex flex-col text-center">
          <div className="my-auto flex flex-col justify-center items-center">
            <div className="sm:max-w-md my-auto pb-10 w-full dark:text-gray-100">
              <form className="flex flex-col justify-center" onSubmit={handleSubmit}>
                <div className="mb-1">
                  <div className="text-2xl font-medium">
                    {isSignin ? `登录到 ${WEBUI_NAME}` : `注册到 ${WEBUI_NAME}`}
                  </div>
                </div>

                <div className="flex flex-col mt-4">
                  {!isSignin && (
                    <div className="mb-2">
                      <label htmlFor="name" className="text-sm font-medium text-left mb-1 block">
                        用户名
                      </label>
                      <input
                        value={username}
                        onChange={(event) => setUsername(event.target.value)}
                        type="text"
                        id="name"
                        className="my-0.5 w-full text-sm outline-hidden bg-transparent placeholder:text-gray-300 dark:placeholder:text-gray-600"
                        autoComplete="name"
                        placeholder="请输入 3-24 位用户名"
                        required
                      />
                    </div>
                  )}

                  <div className="mb-2">
                    <label htmlFor="email" className="text-sm font-medium text-left mb-1 block">
                      {isSignin ? '邮箱或用户名' : '邮箱'}
                    </label>
                    <input
                      value={isSignin ? identifier : email}
                      onChange={(event) => {
                        if (isSignin) setIdentifier(event.target.value);
                        else setEmail(event.target.value);
                      }}
                      type={isSignin ? 'text' : 'email'}
                      id="email"
                      className="my-0.5 w-full text-sm outline-hidden bg-transparent placeholder:text-gray-300 dark:placeholder:text-gray-600"
                      autoComplete={isSignin ? 'username' : 'email'}
                      name="email"
                      placeholder={isSignin ? '请输入邮箱或用户名' : '请输入邮箱'}
                      required
                    />
                  </div>

                  <div>
                    <label htmlFor="password" className="text-sm font-medium text-left mb-1 block">
                      密码
                    </label>
                    <SensitiveInput
                      value={password}
                      onChange={setPassword}
                      type="password"
                      id="password"
                      className="my-0.5 w-full text-sm outline-hidden bg-transparent placeholder:text-gray-300 dark:placeholder:text-gray-600"
                      placeholder="请输入密码"
                      autoComplete={isSignin ? 'current-password' : 'new-password'}
                      name="password"
                      required
                      revealed={passwordVisible}
                      onToggleReveal={() => setPasswordVisible((visible) => !visible)}
                    />
                  </div>

                  {!isSignin && (
                    <div className="mt-2">
                      <label htmlFor="confirm-password" className="text-sm font-medium text-left mb-1 block">
                        确认密码
                      </label>
                      <SensitiveInput
                        value={confirmPassword}
                        onChange={setConfirmPassword}
                        type="password"
                        id="confirm-password"
                        className="my-0.5 w-full text-sm outline-hidden bg-transparent placeholder:text-gray-300 dark:placeholder:text-gray-600"
                        placeholder="请再次输入密码"
                        autoComplete="new-password"
                        name="confirm-password"
                        required
                        revealed={confirmPasswordVisible}
                        onToggleReveal={() => setConfirmPasswordVisible((visible) => !visible)}
                      />
                    </div>
                  )}
                </div>

                <div className="mt-5">
                  <button
                    className="bg-gray-700/5 hover:bg-gray-700/10 dark:bg-gray-100/5 dark:hover:bg-gray-100/10 dark:text-gray-300 dark:hover:text-white transition w-full rounded-full font-medium text-sm py-2.5 disabled:pointer-events-none disabled:opacity-60"
                    type="submit"
                    disabled={loading}
                  >
                    {loading ? '请稍候...' : isSignin ? '登录' : '创建账号'}
                  </button>

                  <div className="mt-4 text-sm text-center">
                    {isSignin ? '还没有账号？' : '已有账号？'}

                    <button
                      className="font-medium underline"
                      type="button"
                      onClick={() => {
                        switchMode(isSignin ? 'signup' : 'signin');
                      }}
                    >
                      {isSignin ? '立即注册' : '去登录'}
                    </button>
                  </div>
                </div>
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SensitiveInput({
  value,
  onChange,
  revealed,
  onToggleReveal,
  className,
  ...inputProps
}: {
  value: string;
  onChange: (value: string) => void;
  revealed: boolean;
  onToggleReveal: () => void;
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  return (
    <div className="openwebui-sensitive-input">
      <input
        {...inputProps}
        type={revealed ? 'text' : 'password'}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={className}
      />
      <button
        type="button"
        className="openwebui-sensitive-toggle"
        onClick={onToggleReveal}
        aria-label={revealed ? '隐藏密码' : '显示密码'}
      >
        {revealed ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
}

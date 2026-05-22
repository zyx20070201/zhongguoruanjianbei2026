import { FormEvent, useEffect, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Navigate, useNavigate } from 'react-router-dom';
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
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [confirmPasswordVisible, setConfirmPasswordVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const { user, loading, hydrated, login, register, hydrate } = useAuthStore();

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const switchMode = (nextMode: AuthMode) => {
    setMode(nextMode);
    setError(null);
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    try {
      if (mode === 'login') {
        await login(identifier.trim(), password);
        navigate('/workspaces', { replace: true });
        return;
      }

      if (password !== confirmPassword) {
        setError('两次输入的密码不一致');
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
            ? '登录失败，请检查账号和密码'
            : '注册失败，请稍后再试'
        )
      );
    }
  };

  const isRegister = mode === 'register';
  const isLogin = mode === 'login';
  const title = isLogin ? '登录到 AI 学习工作台' : '创建 AI 学习工作台账号';

  if (hydrated && user) {
    return <Navigate to="/workspaces" replace />;
  }

  return (
    <div className="notion-auth-page flex min-h-full flex-1 items-center justify-center overflow-hidden text-[#111111]">
      <main className="notion-auth-main mx-auto flex w-full max-w-[760px] flex-col items-center px-6">
        <section className="notion-auth-card w-full max-w-[520px]">
          <section className="w-full text-center">
            <h1 className="notion-auth-title">{title}</h1>
          </section>

          <form onSubmit={handleSubmit} className="notion-auth-form w-full">
            {(isLogin || isRegister) && (
              <NotionField
                label={isLogin ? '邮箱或用户名' : '用户名'}
                type={isLogin ? 'text' : 'text'}
                value={isLogin ? identifier : username}
                placeholder={isLogin ? '请输入邮箱或用户名' : '请输入 3-24 位用户名'}
                onChange={isLogin ? setIdentifier : setUsername}
              />
            )}

            {isRegister && (
              <div className="mt-4">
                <NotionField
                  label="邮箱"
                  type="email"
                  value={email}
                  placeholder="请输入邮箱"
                  onChange={setEmail}
                />
              </div>
            )}

            {(isLogin || isRegister) && (
              <div className="mt-4">
                <NotionField
                  label="密码"
                  type="password"
                  value={password}
                  placeholder="请输入密码"
                  onChange={setPassword}
                  revealable
                  revealed={passwordVisible}
                  onToggleReveal={() => setPasswordVisible((visible) => !visible)}
                />
              </div>
            )}

            {isRegister && (
              <div className="mt-4">
                <NotionField
                  label="确认密码"
                  type="password"
                  value={confirmPassword}
                  placeholder="请再次输入密码"
                  onChange={setConfirmPassword}
                  revealable
                  revealed={confirmPasswordVisible}
                  onToggleReveal={() => setConfirmPasswordVisible((visible) => !visible)}
                />
              </div>
            )}

            {error && <div className="notion-auth-message notion-auth-message-error mt-4">{error}</div>}

            <button type="submit" disabled={loading} className="notion-auth-primary mt-5">
              {loading ? '请稍候...' : isLogin ? '登录' : '注册'}
            </button>
          </form>

          <div className="notion-auth-switch text-center text-[#8f8f8f]">
            {isLogin ? '还没有账号？' : '已有账号？'}{' '}
            <button
              type="button"
              onClick={() => switchMode(isLogin ? 'register' : 'login')}
              className="underline underline-offset-2 hover:text-[#2f2f2f]"
            >
              {isLogin ? '立即注册' : '去登录'}
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}

function NotionField({
  label,
  type,
  value,
  placeholder,
  onChange,
  revealable = false,
  revealed = false,
  onToggleReveal
}: {
  label: string;
  type: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  revealable?: boolean;
  revealed?: boolean;
  onToggleReveal?: () => void;
}) {
  const inputType = revealable ? (revealed ? 'text' : 'password') : type;

  return (
    <label className="block text-left">
      <span className="notion-auth-field-label">{label}</span>
      <span className="notion-auth-input-shell">
        <input
          type={inputType}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          required
          className="notion-auth-input"
        />
        {revealable && (
          <button
            type="button"
            className="notion-auth-reveal"
            onClick={onToggleReveal}
            aria-label={revealed ? '隐藏密码' : '显示密码'}
          >
            {revealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        )}
      </span>
    </label>
  );
}

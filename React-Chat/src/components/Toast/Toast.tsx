import { useEffect } from 'react';

interface ToastProps {
  message: string;
  type: 'error' | 'success';
  duration?: number;
  onDone: () => void;
}

export function Toast({ message, type, duration = 10000, onDone }: ToastProps) {
  useEffect(() => {
    const timer = setTimeout(onDone, type === 'success' ? 3000 : duration);
    return () => clearTimeout(timer);
  }, [onDone, duration, type]);

  const borderColor = type === 'success' ? 'var(--green)' : 'var(--red)';
  const color = type === 'success' ? 'var(--green)' : 'var(--red)';

  return (
    <div
      className="toast-msg"
      style={{
        position: 'fixed',
        top: 16,
        right: 16,
        background: '#fff',
        border: `1px solid ${borderColor}`,
        color,
        padding: '10px 16px',
        borderRadius: 'var(--rs)',
        fontSize: 12,
        zIndex: 999,
        maxWidth: 420,
        lineHeight: 1.5,
        animation: 'fadeUp 0.3s ease',
        whiteSpace: 'pre-wrap',
        boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
      }}
    >
      {message}
    </div>
  );
}

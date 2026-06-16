import { useRef, useCallback, useEffect, type KeyboardEvent } from 'react';
import type { PendingImage } from '../../types';
import './InputArea.css';

interface InputAreaProps {
  onSend: (text: string, images: PendingImage[]) => void;
  loading: boolean;
  onClear: () => void;
  pendingImages: PendingImage[];
  onRemoveImage: (index: number) => void;
  onAddImages: (files: File[]) => void;
  webSearchEnabled: boolean;
  onToggleWebSearch: () => void;
  hintText: string;
  onHintConsumed: () => void;
}

export function InputArea({
  onSend,
  loading,
  onClear,
  pendingImages,
  onRemoveImage,
  onAddImages,
  webSearchEnabled,
  onToggleWebSearch,
  hintText,
  onHintConsumed,
}: InputAreaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = '46px';
    el.style.height = `${Math.min(el.scrollHeight, 150)}px`;
  }, []);

  const handleSend = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    const text = el.value.trim();
    const imgs = [...pendingImages];
    if (!text && imgs.length === 0) return;
    if (loading) return;

    el.value = '';
    el.style.height = '46px';
    onSend(text, imgs);
  }, [onSend, pendingImages, loading]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []);
      if (files.length > 0) onAddImages(files);
      if (fileInputRef.current) fileInputRef.current.value = '';
    },
    [onAddImages],
  );

  // Handle hint text — auto-fill and send
  useEffect(() => {
    if (!hintText || loading) return;
    const el = textareaRef.current;
    if (!el) return;
    el.value = hintText;
    el.style.height = '46px';
    el.style.height = `${Math.min(el.scrollHeight, 150)}px`;
    onHintConsumed();
    // Trigger send on next tick after state settles
    requestAnimationFrame(() => handleSend());
  }, [hintText]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="inp-area">
      {pendingImages.length > 0 && (
        <div className="img-preview">
          {pendingImages.map((img, i) => (
            <div key={i} className="img-preview-item">
              <img src={img.dataUrl} alt={img.name} />
              <button className="img-rm" onClick={() => onRemoveImage(i)}>
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="inp-row">
        <textarea
          ref={textareaRef}
          rows={1}
          placeholder="输入消息..."
          onKeyDown={handleKeyDown}
          onInput={autoResize}
        />
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: 'none' }}
          onChange={handleFileChange}
        />
        <div className="btns">
          <button
            className="img-btn"
            title="上传图片"
            onClick={() => fileInputRef.current?.click()}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
          </button>
          <button className="c-btn" title="清空对话" onClick={onClear}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
            </svg>
          </button>
          <button
            className="c-btn"
            title="联网搜索"
            onClick={onToggleWebSearch}
            style={{ opacity: webSearchEnabled ? 1 : 0.6 }}
          >
            🔍
          </button>
          <button className="s-btn" disabled={loading} onClick={handleSend}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

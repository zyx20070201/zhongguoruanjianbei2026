export function esc(t: string): string {
  return t
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function formatText(t: string): string {
  return esc(t)
    .replace(
      /```(\w*)\n([\s\S]*?)```/g,
      '<pre style="background:#f4f4f8;padding:10px;border-radius:7px;overflow-x:auto;font-family:JetBrains Mono,monospace;font-size:12px;margin:6px 0;border:1px solid #dddde6;color:#1a1a2e"><code>$2</code></pre>',
    )
    .replace(
      /`([^`]+)`/g,
      '<code style="background:#ededf2;padding:1px 5px;border-radius:3px;font-family:JetBrains Mono,monospace;font-size:12px;color:#1a1a2e">$1</code>',
    )
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');
}

export function formatTime(ts: number): string {
  const d = new Date(ts);
  const diff = Date.now() - ts;
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)} 天前`;
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

import type { ParsedPart } from '../types';

export function parseResponse(text: string): ParsedPart[] {
  const parts: ParsedPart[] = [];
  const regex = /~~~(HTML_VIZ|REACT_VIZ)\s*\n([\s\S]*?)~~~/g;
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const before = text.slice(last, match.index).trim();
    if (before) parts.push({ type: 'text', content: before });

    const vt = match[1] === 'HTML_VIZ' ? 'html' : 'react';
    const code = match[2].trim();
    if (code) parts.push({ type: vt, code });

    last = match.index + match[0].length;
  }

  const after = text.slice(last).trim();
  if (after) {
    // Handle truncated output — opening tag without closing
    const truncMatch = after.match(
      /^~~~(HTML_VIZ|REACT_VIZ)\s*\n([\s\S]+)/,
    );
    if (truncMatch) {
      const vt = truncMatch[1] === 'HTML_VIZ' ? 'html' : 'react';
      const code = truncMatch[2].trim();
      parts.push({
        type: 'text',
        content: '⚠️ 代码输出被截断（超出 token 上限），尝试渲染已有部分：',
      });
      if (code) parts.push({ type: vt, code });
    } else {
      parts.push({ type: 'text', content: after });
    }
  }

  if (parts.length === 0 && text.trim()) {
    parts.push({ type: 'text', content: text.trim() });
  }

  return parts;
}

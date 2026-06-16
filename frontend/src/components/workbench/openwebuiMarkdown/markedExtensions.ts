import { marked } from 'marked';

const delimiterList = [
  { left: '$$', right: '$$', display: true },
  { left: '$', right: '$', display: false },
  { left: '\\pu{', right: '}', display: false },
  { left: '\\ce{', right: '}', display: false },
  { left: '\\(', right: '\\)', display: false },
  { left: '\\[', right: '\\]', display: true },
  { left: '\\begin{equation}', right: '\\end{equation}', display: true }
];

const allowedSurroundingChars =
  '\\s。，、､;；„“‘’“”（）「」『』［］《》【】‹›«»…⋯:：？！～⇒?!-\\/:-@\\[-`{-~\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Hangul}';
const allowedSurroundingCharsRegex = new RegExp(`[${allowedSurroundingChars}]`, 'u');

const inlinePatterns: string[] = [];
const blockPatterns: string[] = [];

const escapeRegex = (value: string) => value.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');

delimiterList.forEach((delimiter) => {
  const left = escapeRegex(delimiter.left);
  const right = escapeRegex(delimiter.right);
  if (delimiter.display) {
    inlinePatterns.push(`${left}(?!\\n)((?:\\\\[^]|[^\\\\])+?)(?!\\n)${right}`);
    blockPatterns.push(`${left}\\n((?:\\\\[^]|[^\\\\])+?)\\n${right}`);
  } else {
    inlinePatterns.push(`${left}((?:\\\\[^]|[^\\\\])+?)${right}`);
  }
});

const inlineKatexRule = new RegExp(`^(${inlinePatterns.join('|')})(?=[${allowedSurroundingChars}]|$)`, 'u');
const blockKatexRule = new RegExp(`^(${blockPatterns.join('|')})(?=[${allowedSurroundingChars}]|$)`, 'u');

const isAllowedTrailing = (src: string, index: number) =>
  index >= src.length || allowedSurroundingCharsRegex.test(src.charAt(index));

const isBlockBoundary = (src: string, index: number) => /^(?:[ \t]*\r?\n|$)/.test(src.slice(index));

const findClosingDelimiter = (src: string, index: number): number => {
  if (index >= src.length - 1) return -1;
  if (src[index] === '\\') return findClosingDelimiter(src, index + 2);
  if (src[index] === '$' && src[index + 1] === '$') return index;
  return findClosingDelimiter(src, index + 1);
};

const tokenizeDisplayMath = (
  src: string,
  type: 'inlineKatex' | 'blockKatex',
  requireBlockBoundary = false
) => {
  if (!src.startsWith('$$')) return undefined;

  const endIndex = findClosingDelimiter(src, 2);
  if (endIndex === -1) return undefined;

  const raw = src.slice(0, endIndex + 2);
  const text = raw.slice(2, -2);
  const afterClose = endIndex + 2;

  if (!text.trim()) return undefined;
  if (!isAllowedTrailing(src, afterClose)) return undefined;
  if (requireBlockBoundary && !isBlockBoundary(src, afterClose)) return undefined;

  return { type, raw, text, displayMode: true };
};

const katexStart = (src: string, displayMode: boolean) => {
  for (let index = 0; index < src.length; index += 1) {
    const char = src.charCodeAt(index);
    if (char === 36) {
      if (displayMode && src.charAt(index + 1) !== '$') continue;
      if (index === 0 || allowedSurroundingCharsRegex.test(src.charAt(index - 1))) return index;
    } else if (char === 92) {
      const next = src.charAt(index + 1);
      if (displayMode) {
        if (next !== '[' && next !== 'b') continue;
      } else if (next !== '(' && next !== 'c' && next !== 'p') {
        continue;
      }
      if (index === 0 || allowedSurroundingCharsRegex.test(src.charAt(index - 1))) return index;
    }
  }
  return undefined;
};

const katexTokenizer = (src: string, displayMode: boolean) => {
  if (src.startsWith('$$')) {
    const displayToken = tokenizeDisplayMath(
      src,
      displayMode ? 'blockKatex' : 'inlineKatex',
      displayMode
    );
    if (displayToken) return displayToken;
  }

  const match = src.match(displayMode ? blockKatexRule : inlineKatexRule);
  if (!match) return undefined;

  const text = match
    .slice(2)
    .filter(Boolean)
    .find((item) => item.trim());

  return {
    type: displayMode ? 'blockKatex' : 'inlineKatex',
    raw: match[0],
    text,
    displayMode
  };
};

const katexExtension = {
  extensions: [
    {
      name: 'inlineKatex',
      level: 'inline' as const,
      start: (src: string) => katexStart(src, false),
      tokenizer: (src: string) => katexTokenizer(src, false),
      renderer: (token: any) => token?.text ?? ''
    },
    {
      name: 'blockKatex',
      level: 'block' as const,
      start: (src: string) => katexStart(src, true),
      tokenizer: (src: string) => katexTokenizer(src, true),
      renderer: (token: any) => token?.text ?? ''
    }
  ]
};

const findMatchingClosingTag = (src: string, openTag: string, closeTag: string) => {
  let depth = 1;
  let index = openTag.length;
  while (depth > 0 && index < src.length) {
    if (src.startsWith(openTag, index)) depth += 1;
    else if (src.startsWith(closeTag, index)) depth -= 1;
    if (depth > 0) index += 1;
  }
  return depth === 0 ? index + closeTag.length : -1;
};

const parseAttributes = (tag: string) => {
  const attributes: Record<string, string> = {};
  const attrRegex = /(\w+)="(.*?)"/g;
  let match: RegExpExecArray | null;
  while ((match = attrRegex.exec(tag)) !== null) {
    attributes[match[1]] = match[2];
  }
  return attributes;
};

const detailsExtension = {
  name: 'details',
  level: 'block' as const,
  start: (src: string) => (src.match(/^<details[\s>]/) ? 0 : -1),
  tokenizer(src: string) {
    const detailsMatch = /^<details(\s+[^>]*)?>\n/.exec(src);
    if (!detailsMatch) return undefined;

    const endIndex = findMatchingClosingTag(src, '<details', '</details>');
    if (endIndex === -1) return undefined;

    const raw = src.slice(0, endIndex);
    const detailsTag = detailsMatch[0];
    const attributes = parseAttributes(detailsTag);
    let content = raw.slice(detailsTag.length, -10).trim();
    let summary = '';
    const summaryMatch = /^<summary>(.*?)<\/summary>\n/.exec(content);
    if (summaryMatch) {
      summary = summaryMatch[1].trim();
      content = content.slice(summaryMatch[0].length).trim();
    }

    return { type: 'details', raw, summary, text: content, attributes };
  },
  renderer(token: any) {
    return token.raw;
  }
};

const footnoteExtension = {
  name: 'footnote',
  level: 'inline' as const,
  start: (src: string) => src.search(/\[\^\s*[a-zA-Z0-9_-]+\s*\]/),
  tokenizer(src: string) {
    const match = /^\[\^\s*([a-zA-Z0-9_-]+)\s*\]/.exec(src);
    if (!match) return undefined;
    return {
      type: 'footnote',
      raw: match[0],
      text: match[1],
      escapedText: match[1].replace(/[&<>"']/g, (char) => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] || char
      ))
    };
  }
};

const citationExtension = {
  name: 'citation',
  level: 'inline' as const,
  start: (src: string) => src.search(/\[\d/),
  tokenizer(src: string) {
    if (/^\[\^/.test(src)) return undefined;
    const match = /^(\[(?:\d+(?:#[^,\]\s]+)?(?:,\s*\d+(?:#[^,\]\s]+)?)*)\])+/.exec(src);
    if (!match) return undefined;

    const raw = match[0];
    const ids: number[] = [];
    const citationIdentifiers: string[] = [];
    let groupMatch: RegExpExecArray | null;
    const groupRegex = /\[([^\]]+)\]/g;
    while ((groupMatch = groupRegex.exec(raw)) !== null) {
      groupMatch[1].split(',').map((item) => item.trim()).forEach((part) => {
        const idMatch = /^(\d+)(?:#(.+))?$/.exec(part);
        if (!idMatch) return;
        const id = Number.parseInt(idMatch[1], 10);
        if (!Number.isNaN(id)) {
          ids.push(id);
          citationIdentifiers.push(part);
        }
      });
    }

    if (!ids.length) return undefined;
    return { type: 'citation', raw, ids, citationIdentifiers };
  },
  renderer: (token: any) => token.raw
};

const colonFenceExtension = {
  name: 'colonFence',
  level: 'block' as const,
  start: (src: string) => src.match(/^:::/) ? 0 : -1,
  tokenizer(src: string) {
    const match = /^:::\s*([A-Za-z0-9_-]+)?[^\n]*\n([\s\S]*?)\n:::(?:\n|$)/.exec(src);
    if (!match) return undefined;
    return {
      type: 'colonFence',
      raw: match[0],
      meta: match[1] || '',
      text: match[2] || '',
      tokens: marked.lexer(match[2] || '')
    };
  },
  renderer: (token: any) => token.raw
};

let configured = false;

export const createOpenWebUIMarked = () => {
  if (!configured) {
    marked.use(katexExtension);
    marked.use({ extensions: [detailsExtension, footnoteExtension, citationExtension, colonFenceExtension] });
    configured = true;
  }
  marked.setOptions({ breaks: true, gfm: true });
  return marked;
};

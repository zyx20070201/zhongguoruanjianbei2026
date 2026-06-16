import { SYSTEM_PROMPT } from '../constants/system-prompt';
import type { APIConfig, Message } from '../types';

function getHeaders(key: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'x-api-key': key,
    Authorization: `Bearer ${key}`,
    'anthropic-version': '2023-06-01',
    'anthropic-dangerous-direct-browser-access': 'true',
  };
}

function apiBase(base: string): string {
  return base.replace(/\/+$/, '').replace(/\/v1$/i, '');
}

async function callAnthropic(
  cfg: APIConfig,
  msgs: Message[],
  searchContext: string,
): Promise<string> {
  const url = `${apiBase(cfg.base)}/v1/messages`;
  const systemText = searchContext
    ? `${SYSTEM_PROMPT}\n\n${searchContext}`
    : SYSTEM_PROMPT;

  const body = {
    model: cfg.model,
    max_tokens: 131072,
    system: [{ type: 'text' as const, text: systemText }],
    messages: msgs,
  };

  const r = await fetch(url, {
    method: 'POST',
    headers: getHeaders(cfg.key),
    body: JSON.stringify(body),
  });

  if (!r.ok) {
    const raw = await r.text().catch(() => '');
    let msg = `API ${r.status}`;
    try {
      const j = JSON.parse(raw);
      msg = j.error?.message || j.message || raw.slice(0, 300);
    } catch {
      msg = raw.slice(0, 300) || msg;
    }
    throw new Error(`[${r.status}] ${msg}`);
  }

  const data = await r.json();
  return (
    data.content
      ?.filter((b: { type: string }) => b.type === 'text')
      .map((b: { text: string }) => b.text)
      .join('\n') || ''
  );
}

async function callOpenAI(
  cfg: APIConfig,
  msgs: Message[],
  searchContext: string,
): Promise<string> {
  const systemText = searchContext
    ? `${SYSTEM_PROMPT}\n\n${searchContext}`
    : SYSTEM_PROMPT;

  const oaiMsgs: Record<string, unknown>[] = [
    { role: 'system', content: systemText },
    ...msgs.map((m) => {
      if (typeof m.content === 'string') {
        return { role: m.role, content: m.content };
      }
      if (Array.isArray(m.content)) {
        const parts = m.content
          .map((block) => {
            if (block.type === 'text') return { type: 'text', text: block.text };
            if (block.type === 'image')
              return {
                type: 'image_url',
                image_url: {
                  url: `data:${block.source.media_type};base64,${block.source.data}`,
                },
              };
            return null;
          })
          .filter(Boolean);
        return { role: m.role, content: parts };
      }
      return { role: m.role, content: String(m.content) };
    }),
  ];

  const url = `${apiBase(cfg.base)}/v1/chat/completions`;
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.key}`,
    },
    body: JSON.stringify({
      model: cfg.model,
      max_tokens: 131072,
      messages: oaiMsgs,
    }),
  });

  if (!r.ok) {
    const raw = await r.text().catch(() => '');
    let msg = `API ${r.status}`;
    try {
      const j = JSON.parse(raw);
      msg = j.error?.message || j.message || raw.slice(0, 300);
    } catch {
      msg = raw.slice(0, 300) || msg;
    }
    throw new Error(`[${r.status}] ${msg}`);
  }

  const data = await r.json();
  return data.choices?.[0]?.message?.content || '';
}

export async function callAPI(
  cfg: APIConfig,
  msgs: Message[],
  searchContext = '',
): Promise<string> {
  return cfg.fmt === 'openai'
    ? callOpenAI(cfg, msgs, searchContext)
    : callAnthropic(cfg, msgs, searchContext);
}

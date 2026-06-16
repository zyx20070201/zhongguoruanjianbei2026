import { useCallback, useState } from 'react';

const STORAGE_KEY = 'sb3_webSearch';

export function useWebSearch() {
  const [enabled, setEnabled] = useState(() => {
    return localStorage.getItem(STORAGE_KEY) === 'true';
  });

  const toggle = useCallback(() => {
    setEnabled((prev) => {
      const next = !prev;
      localStorage.setItem(STORAGE_KEY, String(next));
      return next;
    });
  }, []);

  const search = useCallback(async (query: string): Promise<string> => {
    if (!query) return '';
    try {
      const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&max_results=5`;
      const r = await fetch(url);
      const data = await r.json();
      if (!data.RelatedTopics || data.RelatedTopics.length === 0) return '';
      const results = data.RelatedTopics.slice(0, 3)
        .map((item: { Text?: string; Result?: string }) => {
          const text = item.Text || item.Result || '';
          return text.replace(/<[^>]*>/g, '').slice(0, 150);
        })
        .filter(Boolean);
      return results.length > 0
        ? '【最新搜索结果】\n' + results.join('\n\n')
        : '';
    } catch {
      return '';
    }
  }, []);

  return { enabled, toggle, search };
}

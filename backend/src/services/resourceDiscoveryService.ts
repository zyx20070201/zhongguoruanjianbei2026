import { FileSystemError } from '../types/fileSystem';

export type ResourceDiscoveryProvider = 'exa' | 'tavily';

export interface ResourceDiscoveryInput {
  query: string;
  maxResults?: number;
  provider?: ResourceDiscoveryProvider | 'auto';
}

export interface DiscoveredResource {
  id: string;
  title: string;
  url: string;
  snippet: string;
  summary?: string;
  score?: number;
  source?: string;
  provider: ResourceDiscoveryProvider;
  publishedAt?: string;
  author?: string;
  contentPreview?: string;
  imageUrl?: string;
  thumbnailUrl?: string;
}

export interface ResourceDiscoveryResult {
  provider: ResourceDiscoveryProvider;
  query: string;
  results: DiscoveredResource[];
}

const EXA_ENDPOINT = 'https://api.exa.ai/search';
const TAVILY_ENDPOINT = 'https://api.tavily.com/search';
const REQUEST_TIMEOUT_MS = 30000;

const compactText = (value: unknown, maxLength = 900) => {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 3).trim()}...` : text;
};

const normalizeUrl = (value: unknown) => {
  try {
    const parsed = new URL(String(value || ''));
    if (!['http:', 'https:'].includes(parsed.protocol)) return '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return '';
  }
};

const firstString = (...values: unknown[]): string => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (Array.isArray(value)) {
      const nested: string = firstString(...value);
      if (nested) return nested;
    }
    if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>;
      const nested: string = firstString(record.url, record.src, record.href);
      if (nested) return nested;
    }
  }
  return '';
};

const normalizeImageUrl = (value: unknown) => {
  const url = normalizeUrl(value);
  if (!url) return '';
  return url.startsWith('http://') ? `https://${url.slice('http://'.length)}` : url;
};

const bilibiliBvidFromUrl = (value: string) => {
  try {
    const parsed = new URL(value);
    if (!parsed.hostname.toLowerCase().includes('bilibili.com')) return '';
    return parsed.pathname.match(/\/video\/(BV[a-zA-Z0-9]+)/)?.[1] || '';
  } catch {
    return '';
  }
};

const dedupeResults = (results: DiscoveredResource[]) => {
  const seen = new Set<string>();
  return results.filter((result) => {
    const url = normalizeUrl(result.url);
    if (!url || seen.has(url)) return false;
    seen.add(url);
    result.url = url;
    return true;
  });
};

const providerFromEnv = (): ResourceDiscoveryProvider | null => {
  const configured = (process.env.RESOURCE_DISCOVERY_PROVIDER || '').toLowerCase();
  if (configured === 'exa' || configured === 'tavily') return configured;
  if (process.env.EXA_API_KEY) return 'exa';
  if (process.env.TAVILY_API_KEY) return 'tavily';
  return null;
};

export class ResourceDiscoveryService {
  async discover(input: ResourceDiscoveryInput): Promise<ResourceDiscoveryResult> {
    const query = compactText(input.query, 600);
    if (!query) throw new FileSystemError(400, 'Search query is required');

    const maxResults = Math.min(Math.max(input.maxResults || 10, 1), 20);
    const preferred = input.provider && input.provider !== 'auto' ? input.provider : providerFromEnv();
    const providers = preferred
      ? [preferred, preferred === 'exa' ? 'tavily' : 'exa']
      : (['exa', 'tavily'] as ResourceDiscoveryProvider[]);

    const errors: string[] = [];
    for (const provider of providers) {
      try {
        if (provider === 'exa' && process.env.EXA_API_KEY) {
          return { provider, query, results: await this.searchExa(query, maxResults) };
        }
        if (provider === 'tavily' && process.env.TAVILY_API_KEY) {
          return { provider, query, results: await this.searchTavily(query, maxResults) };
        }
      } catch (error) {
        errors.push(`${provider}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (!process.env.EXA_API_KEY && !process.env.TAVILY_API_KEY) {
      throw new FileSystemError(503, 'Set EXA_API_KEY or TAVILY_API_KEY to enable online source discovery');
    }

    throw new FileSystemError(502, errors.join('; ') || 'Online source discovery failed');
  }

  private async searchExa(query: string, maxResults: number): Promise<DiscoveredResource[]> {
    const response = await fetch(EXA_ENDPOINT, {
      method: 'POST',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.EXA_API_KEY || ''
      },
      body: JSON.stringify({
        query,
        type: 'auto',
        numResults: maxResults,
        useAutoprompt: true,
        contents: {
          text: { maxCharacters: 1800 },
          highlights: { numSentences: 2, highlightsPerUrl: 2 },
          summary: { query }
        }
      })
    });

    if (!response.ok) {
      throw new Error(`Exa returned ${response.status}`);
    }

    const data = await response.json() as any;
    const results = Array.isArray(data.results) ? data.results : [];
    const mapped = dedupeResults(results.map((item: any, index: number) => {
      const highlights = Array.isArray(item.highlights) ? item.highlights.join(' ') : '';
      const snippet = compactText(item.summary || highlights || item.text || item.title, 700);
      const imageUrl = normalizeImageUrl(firstString(
        item.image,
        item.imageUrl,
        item.thumbnail,
        item.thumbnailUrl,
        item.favicon,
        item.images
      ));
      return {
        id: `exa-${index}-${Buffer.from(String(item.url || index)).toString('base64url').slice(0, 18)}`,
        title: compactText(item.title || item.url || 'Untitled source', 180),
        url: String(item.url || ''),
        snippet,
        summary: compactText(item.summary, 900) || undefined,
        score: typeof item.score === 'number' ? item.score : undefined,
        source: item.siteName || item.author || undefined,
        provider: 'exa' as const,
        publishedAt: item.publishedDate || undefined,
        author: item.author || undefined,
        contentPreview: compactText(item.text, 1200) || undefined,
        imageUrl: imageUrl || undefined,
        thumbnailUrl: imageUrl || undefined
      };
    })).slice(0, maxResults);
    return this.enrichThumbnails(mapped);
  }

  private async searchTavily(query: string, maxResults: number): Promise<DiscoveredResource[]> {
    const response = await fetch(TAVILY_ENDPOINT, {
      method: 'POST',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        api_key: process.env.TAVILY_API_KEY,
        query,
        search_depth: 'advanced',
        include_answer: true,
        include_raw_content: true,
        max_results: maxResults
      })
    });

    if (!response.ok) {
      throw new Error(`Tavily returned ${response.status}`);
    }

    const data = await response.json() as any;
    const answer = compactText(data.answer, 900);
    const results = Array.isArray(data.results) ? data.results : [];
    const mapped = dedupeResults(results.map((item: any, index: number) => {
      const imageUrl = normalizeImageUrl(firstString(
        item.image,
        item.imageUrl,
        item.thumbnail,
        item.thumbnailUrl,
        item.favicon,
        item.images
      ));
      return {
        id: `tavily-${index}-${Buffer.from(String(item.url || index)).toString('base64url').slice(0, 18)}`,
        title: compactText(item.title || item.url || 'Untitled source', 180),
        url: String(item.url || ''),
        snippet: compactText(item.content || item.raw_content || answer || item.title, 700),
        summary: answer || compactText(item.content, 900) || undefined,
        score: typeof item.score === 'number' ? item.score : undefined,
        source: item.source || undefined,
        provider: 'tavily' as const,
        publishedAt: item.published_date || undefined,
        contentPreview: compactText(item.raw_content || item.content, 1200) || undefined,
        imageUrl: imageUrl || undefined,
        thumbnailUrl: imageUrl || undefined
      };
    })).slice(0, maxResults);
    return this.enrichThumbnails(mapped);
  }

  private async enrichThumbnails(results: DiscoveredResource[]) {
    return Promise.all(results.map(async (result) => {
      if (result.thumbnailUrl || result.imageUrl) return result;
      const bvid = bilibiliBvidFromUrl(result.url);
      if (!bvid) return result;
      const thumbnailUrl = await this.fetchBilibiliThumbnail(bvid).catch(() => '');
      return thumbnailUrl ? { ...result, imageUrl: thumbnailUrl, thumbnailUrl } : result;
    }));
  }

  private async fetchBilibiliThumbnail(bvid: string) {
    const response = await fetch(`https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`, {
      signal: AbortSignal.timeout(8000),
      headers: {
        'user-agent': 'Mozilla/5.0'
      }
    });
    if (!response.ok) return '';
    const data = await response.json() as any;
    return normalizeImageUrl(data?.data?.pic);
  }
}

export const resourceDiscoveryService = new ResourceDiscoveryService();

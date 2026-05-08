import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import { FileSystemError } from '../types/fileSystem';

export interface ExtractWebSourceInput {
  url: string;
  title?: string;
}

export interface CrawlWebSourceInput extends ExtractWebSourceInput {
  maxPages?: number;
  maxDepth?: number;
}

export interface ExtractedWebSource {
  url: string;
  title: string;
  byline?: string;
  excerpt?: string;
  siteName?: string;
  contentMarkdown: string;
  contentHtml?: string;
  links?: WebSourceLink[];
  images?: WebSourceImage[];
}

export interface CrawledWebSource extends ExtractedWebSource {
  pages: Array<ExtractedWebSource & { depth: number }>;
}

export interface WebSourceLink {
  href: string;
  text: string;
  internal: boolean;
}

export interface WebSourceImage {
  src: string;
  alt?: string;
}

const MAX_HTML_BYTES = 8 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 15000;

const normalizeUrl = (value: string) => {
  const trimmed = value.trim();
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let parsed: URL;

  try {
    parsed = new URL(withProtocol);
  } catch {
    throw new FileSystemError(400, 'URL is invalid');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new FileSystemError(400, 'Only HTTP and HTTPS URLs are supported');
  }

  return parsed.toString();
};

const decodeEntities = (value: string) =>
  value
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

const cleanText = (value: string) =>
  decodeEntities(value)
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const escapeMarkdown = (value: string) =>
  value
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\*/g, '\\*')
    .replace(/_/g, '\\_')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]');

const extractMetadataTitle = (document: Document) => {
  const selectors = [
    'meta[property="og:title"]',
    'meta[name="twitter:title"]',
    'title'
  ];

  for (const selector of selectors) {
    const element = document.querySelector(selector);
    const value = element?.getAttribute('content') || element?.textContent || '';
    if (value.trim()) return cleanText(value);
  }

  return '';
};

const htmlToReadableText = (html: string) => {
  const dom = new JSDOM(html);
  dom.window.document.querySelectorAll('script, style, noscript, svg, canvas, iframe').forEach((node) => node.remove());
  return cleanText(dom.window.document.body?.textContent || '');
};

const buildMarkdown = (source: {
  title: string;
  url: string;
  byline?: string;
  excerpt?: string;
  siteName?: string;
  text: string;
}) => {
  const metadata = [
    `Source type: website`,
    `URL: ${source.url}`,
    source.siteName ? `Site: ${source.siteName}` : '',
    source.byline ? `Byline: ${source.byline}` : '',
    source.excerpt ? `Excerpt: ${source.excerpt}` : ''
  ].filter(Boolean);

  const body = source.text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .join('\n\n');

  return `# ${escapeMarkdown(source.title)}\n\n${metadata.join('\n')}\n\n${body}\n`;
};

const absoluteUrl = (value: string | null | undefined, baseUrl: string) => {
  if (!value) return '';
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return '';
  }
};

const normalizeRichHtml = (html: string, baseUrl: string) => {
  const dom = new JSDOM(`<main>${html}</main>`, { url: baseUrl });
  const document = dom.window.document;
  document.querySelectorAll('script, style, iframe, object, embed, form, input, button, textarea, select, link, meta').forEach((node) => node.remove());

  document.querySelectorAll('a[href]').forEach((node) => {
    const href = absoluteUrl(node.getAttribute('href'), baseUrl);
    if (href) node.setAttribute('href', href);
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noreferrer');
  });

  document.querySelectorAll('img').forEach((node) => {
    const src =
      absoluteUrl(node.getAttribute('src'), baseUrl) ||
      absoluteUrl(node.getAttribute('data-src'), baseUrl) ||
      absoluteUrl(node.getAttribute('data-original'), baseUrl);
    if (src) node.setAttribute('src', src);
    node.removeAttribute('srcset');
    node.removeAttribute('sizes');
    node.setAttribute('loading', 'lazy');
  });

  document.querySelectorAll<HTMLElement>('*').forEach((node) => {
    [...node.attributes].forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      if (name.startsWith('on') || name === 'style' || name === 'class' || name.startsWith('data-v-')) {
        node.removeAttribute(attribute.name);
      }
    });
  });

  return document.querySelector('main')?.innerHTML || '';
};

const isCrawlableHttpUrl = (value: string, rootUrl: string) => {
  try {
    const parsed = new URL(value);
    const root = new URL(rootUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    if (parsed.hostname !== root.hostname) return false;
    if (/\.(zip|rar|7z|tar|gz|pdf|docx?|pptx?|xlsx?|png|jpe?g|gif|webp|svg|ico|mp4|mp3|wav|avi|mov)$/i.test(parsed.pathname)) {
      return false;
    }
    if (/\/(search|login|signup|tag|tags|category|categories)\b/i.test(parsed.pathname)) return false;
    return true;
  } catch {
    return false;
  }
};

const canonicalCrawlUrl = (value: string) => {
  const parsed = new URL(value);
  parsed.hash = '';
  parsed.searchParams.sort();
  return parsed.toString();
};

const collectLinks = (html: string, baseUrl: string): WebSourceLink[] => {
  const dom = new JSDOM(html, { url: baseUrl });
  const base = new URL(baseUrl);
  const seen = new Set<string>();
  return Array.from(dom.window.document.querySelectorAll('a[href]'))
    .map((node) => {
      const href = absoluteUrl(node.getAttribute('href'), baseUrl);
      const text = cleanText(node.textContent || node.getAttribute('title') || href);
      return {
        href,
        text,
        internal: href ? (() => {
          try {
            const parsed = new URL(href);
            return ['http:', 'https:'].includes(parsed.protocol) && parsed.hostname === base.hostname;
          } catch {
            return false;
          }
        })() : false
      };
    })
    .filter((link) => {
      if (!link.href || !link.text || seen.has(link.href)) return false;
      seen.add(link.href);
      return true;
    })
    .slice(0, 80);
};

const collectImages = (html: string, baseUrl: string): WebSourceImage[] => {
  const dom = new JSDOM(html, { url: baseUrl });
  const seen = new Set<string>();
  return Array.from(dom.window.document.querySelectorAll('img'))
    .map((node) => ({
      src:
        absoluteUrl(node.getAttribute('src'), baseUrl) ||
        absoluteUrl(node.getAttribute('data-src'), baseUrl) ||
        absoluteUrl(node.getAttribute('data-original'), baseUrl),
      alt: cleanText(node.getAttribute('alt') || '')
    }))
    .filter((image) => {
      if (!image.src || seen.has(image.src)) return false;
      seen.add(image.src);
      return true;
    })
    .slice(0, 80);
};

export class WebSourceExtractionService {
  async extract(input: ExtractWebSourceInput): Promise<ExtractedWebSource> {
    const url = normalizeUrl(input.url);
    const response = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5',
        'user-agent': 'Mozilla/5.0 (compatible; WorkbenchSourceBot/1.0; +https://localhost)'
      }
    }).catch((error) => {
      throw new FileSystemError(502, `Failed to fetch URL: ${error.message}`);
    });

    if (!response.ok) {
      throw new FileSystemError(response.status >= 400 && response.status < 500 ? 400 : 502, `URL returned ${response.status}`);
    }

    const contentType = response.headers.get('content-type')?.toLowerCase() || '';
    if (contentType && !contentType.includes('text/html') && !contentType.includes('text/plain') && !contentType.includes('application/xhtml')) {
      throw new FileSystemError(415, 'This URL does not look like a readable webpage');
    }

    const html = await response.text();
    if (Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES) {
      throw new FileSystemError(413, 'The webpage is too large to import');
    }

    const dom = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();
    const fallbackTitle = extractMetadataTitle(dom.window.document) || new URL(url).hostname.replace(/^www\./, '');
    const title = cleanText(input.title || article?.title || fallbackTitle || 'web-source');
    const extractedText = cleanText(article?.textContent || '') || htmlToReadableText(html);
    const sourceHtml = article?.content || dom.window.document.body?.innerHTML || '';
    const contentHtml = normalizeRichHtml(sourceHtml, url);

    if (!extractedText) {
      throw new FileSystemError(422, 'No readable text could be extracted from this URL');
    }

    return {
      url,
      title,
      byline: cleanText(article?.byline || '') || undefined,
      excerpt: cleanText(article?.excerpt || '') || undefined,
      siteName: cleanText(article?.siteName || '') || undefined,
      contentHtml,
      links: collectLinks(sourceHtml, url),
      images: collectImages(sourceHtml, url),
      contentMarkdown: buildMarkdown({
        title,
        url,
        byline: cleanText(article?.byline || ''),
        excerpt: cleanText(article?.excerpt || ''),
        siteName: cleanText(article?.siteName || ''),
        text: extractedText
      })
    };
  }

  async crawl(input: CrawlWebSourceInput): Promise<CrawledWebSource> {
    const maxPages = Math.min(Math.max(input.maxPages ?? 50, 1), 120);
    const maxDepth = Math.min(Math.max(input.maxDepth ?? 2, 0), 4);
    const root = await this.extract(input);
    const visited = new Set<string>([canonicalCrawlUrl(root.url)]);
    const pages: Array<ExtractedWebSource & { depth: number }> = [{ ...root, depth: 0 }];
    const queue = maxPages > 1
      ? (root.links || [])
          .filter((link) => link.internal && isCrawlableHttpUrl(link.href, root.url))
          .map((link) => ({ url: canonicalCrawlUrl(link.href), depth: 1 }))
      : [];

    while (queue.length > 0 && pages.length < maxPages) {
      const next = queue.shift();
      if (!next || next.depth > maxDepth || visited.has(next.url)) continue;
      visited.add(next.url);

      try {
        const page = await this.extract({ url: next.url });
        pages.push({ ...page, depth: next.depth });

        if (next.depth < maxDepth) {
          for (const link of page.links || []) {
            if (!link.internal || !isCrawlableHttpUrl(link.href, root.url)) continue;
            const href = canonicalCrawlUrl(link.href);
            if (!visited.has(href)) queue.push({ url: href, depth: next.depth + 1 });
          }
        }
      } catch (error) {
        console.warn(`Skipped web source page ${next.url}:`, error instanceof Error ? error.message : error);
      }
    }

    return {
      ...root,
      pages
    };
  }
}

export const webSourceExtractionService = new WebSourceExtractionService();

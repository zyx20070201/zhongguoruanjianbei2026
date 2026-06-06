import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';

const normalizeProxyUrl = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return '';
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
};

const pickProxyUrl = () =>
  normalizeProxyUrl(
    process.env.BACKEND_HTTP_PROXY ||
      process.env.HTTPS_PROXY ||
      process.env.HTTP_PROXY ||
      process.env.ALL_PROXY ||
      process.env.https_proxy ||
      process.env.http_proxy ||
      process.env.all_proxy ||
      ''
  );

const ensureNoProxy = () => {
  const defaults = ['localhost', '127.0.0.1', '::1'];
  const current = process.env.NO_PROXY || process.env.no_proxy || '';
  const values = new Set(
    current
      .split(/[,\s]+/)
      .map((item) => item.trim())
      .filter(Boolean)
  );
  defaults.forEach((item) => values.add(item));
  const next = Array.from(values).join(',');
  process.env.NO_PROXY = next;
  process.env.no_proxy = next;
};

const redactProxyUrl = (value: string) => {
  try {
    const url = new URL(value);
    if (url.username || url.password) {
      url.username = url.username ? '***' : '';
      url.password = url.password ? '***' : '';
    }
    return url.toString();
  } catch {
    return value.replace(/\/\/[^@]+@/, '//***@');
  }
};

export const configureHttpProxy = () => {
  const proxyUrl = pickProxyUrl();
  if (!proxyUrl) return;

  process.env.HTTP_PROXY = process.env.HTTP_PROXY || proxyUrl;
  process.env.HTTPS_PROXY = process.env.HTTPS_PROXY || proxyUrl;
  process.env.http_proxy = process.env.http_proxy || proxyUrl;
  process.env.https_proxy = process.env.https_proxy || proxyUrl;
  ensureNoProxy();

  setGlobalDispatcher(new EnvHttpProxyAgent());
  console.log(`Outbound HTTP proxy enabled: ${redactProxyUrl(proxyUrl)}`);
};

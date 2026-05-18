import { ResourceReference } from '../../types';

const NOTE_EXTENSIONS = new Set(['md', 'markdown', 'txt']);
const CODE_EXTENSIONS = new Set([
  'js',
  'jsx',
  'ts',
  'tsx',
  'py',
  'java',
  'cpp',
  'c',
  'h',
  'hpp',
  'cs',
  'go',
  'rs',
  'php',
  'rb',
  'swift',
  'kt',
  'm',
  'mm',
  'sql',
  'sh',
  'bash',
  'zsh',
  'css',
  'scss',
  'less'
]);
const STRUCTURED_TEXT_EXTENSIONS = new Set(['json', 'yaml', 'yml', 'xml', 'toml', 'ini', 'conf']);
const PDF_EXTENSIONS = new Set(['pdf']);
const CONVERTIBLE_DOCUMENT_EXTENSIONS = new Set([
  'doc',
  'docx',
  'xls',
  'xlsx',
  'ods',
  'ppt',
  'pptx',
  'odt',
  'odp'
]);

export type EditorResourceKind =
  | 'html'
  | 'web'
  | 'markdown'
  | 'note'
  | 'code'
  | 'structured'
  | 'pdf'
  | 'document'
  | 'video'
  | 'binary'
  | 'unknown';

export const getResourceExtension = (resource: ResourceReference | null | undefined) =>
  resource?.extension?.toLowerCase().replace(/^\./, '') ||
  resource?.name.split('.').pop()?.toLowerCase() ||
  '';

export const getLanguageLabel = (resource: ResourceReference | null | undefined) => {
  const extension = getResourceExtension(resource);

  const labels: Record<string, string> = {
    html: 'HTML Demo',
    md: 'Markdown',
    markdown: 'Markdown',
    txt: 'Text',
    js: 'JavaScript',
    jsx: 'React JSX',
    ts: 'TypeScript',
    tsx: 'React TSX',
    py: 'Python',
    java: 'Java',
    cpp: 'C++',
    c: 'C',
    h: 'C Header',
    hpp: 'C++ Header',
    css: 'CSS',
    scss: 'SCSS',
    less: 'LESS',
    json: 'JSON',
    yaml: 'YAML',
    yml: 'YAML',
    xml: 'XML',
    toml: 'TOML',
    ini: 'INI',
    sql: 'SQL',
    sh: 'Shell'
  };

  return labels[extension] || extension.toUpperCase() || 'Plain Text';
};

export const getResourceKind = (
  resource: ResourceReference | null | undefined
): EditorResourceKind => {
  if (!resource) return 'unknown';

  const extension = getResourceExtension(resource);
  const mimeType = resource.mimeType?.toLowerCase() || '';
  const type = resource.type.toLowerCase();
  const fileCategory = resource.fileCategory?.toLowerCase() || '';
  const sourceUrl = String(resource.metadata?.sourceUrl || resource.metadata?.url || '').toLowerCase();
  const videoAnalysis = resource.metadata?.videoAnalysis;

  if (
    videoAnalysis ||
    mimeType.startsWith('video/') ||
    type.includes('video') ||
    sourceUrl.includes('youtube.com') ||
    sourceUrl.includes('youtu.be') ||
    sourceUrl.includes('bilibili.com')
  ) {
    return 'video';
  }

  if (extension === 'html') return 'html';

  if (fileCategory.includes('web') || extension === 'source' || fileCategory.includes('text-source')) {
    return 'web';
  }

  if (fileCategory.includes('note') || NOTE_EXTENSIONS.has(extension)) {
    return extension === 'md' || extension === 'markdown' ? 'markdown' : 'note';
  }

  if (STRUCTURED_TEXT_EXTENSIONS.has(extension)) return 'structured';
  if (CODE_EXTENSIONS.has(extension) || fileCategory.includes('code')) return 'code';
  if (PDF_EXTENSIONS.has(extension) || mimeType.includes('pdf')) return 'pdf';
  if (CONVERTIBLE_DOCUMENT_EXTENSIONS.has(extension) || fileCategory.includes('document')) {
    return 'document';
  }
  if (mimeType.startsWith('text/')) return 'note';
  if (resource.isBinary) return 'binary';

  return 'unknown';
};

export const canEditResource = (resource: ResourceReference | null | undefined) => {
  const kind = getResourceKind(resource);
  return (
    kind === 'html' ||
    kind === 'markdown' ||
    kind === 'note' ||
    kind === 'code' ||
    kind === 'structured'
  );
};

export const isMarkdownResource = (resource: ResourceReference | null | undefined) =>
  getResourceKind(resource) === 'markdown';

export const isJsonResource = (resource: ResourceReference | null | undefined) =>
  getResourceExtension(resource) === 'json';

export const isTextResource = (resource: ResourceReference | null | undefined) =>
  canEditResource(resource) || getResourceKind(resource) === 'unknown';

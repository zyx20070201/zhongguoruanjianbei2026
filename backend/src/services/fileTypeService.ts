const TEXT_EXTENSIONS = new Set([
  'md',
  'markdown',
  'txt',
  'rtf',
  'csv',
  'ts',
  'tsx',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'py',
  'java',
  'cpp',
  'c',
  'cc',
  'h',
  'hpp',
  'cs',
  'go',
  'rs',
  'php',
  'rb',
  'swift',
  'kt',
  'scala',
  'sh',
  'bash',
  'zsh',
  'html',
  'css',
  'scss',
  'less',
  'json',
  'yaml',
  'yml',
  'xml',
  'toml',
  'ini',
  'conf',
  'env',
  'log',
  'sql'
]);

const CODE_EXTENSIONS = new Set([
  'ts',
  'tsx',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'py',
  'java',
  'cpp',
  'c',
  'cc',
  'h',
  'hpp',
  'cs',
  'go',
  'rs',
  'php',
  'rb',
  'swift',
  'kt',
  'scala',
  'sh',
  'bash',
  'zsh',
  'html',
  'css',
  'scss',
  'less',
  'sql'
]);

const NOTE_EXTENSIONS = new Set(['md', 'markdown', 'txt']);
const STRUCTURED_EXTENSIONS = new Set(['json', 'yaml', 'yml', 'xml', 'toml', 'ini', 'conf', 'env']);
const OFFICE_EXTENSIONS = new Set([
  'pdf',
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

const getExtension = (fileName?: string | null) =>
  fileName?.split('.').pop()?.toLowerCase() || '';

export const isTextLikeExtension = (extension?: string | null) =>
  Boolean(extension && TEXT_EXTENSIONS.has(extension.toLowerCase()));

export const inferFileCategory = (fileName: string, mimeType?: string | null) => {
  const extension = getExtension(fileName);
  const normalizedMime = mimeType?.toLowerCase() || '';

  if (NOTE_EXTENSIONS.has(extension)) return 'note';
  if (STRUCTURED_EXTENSIONS.has(extension)) return 'code';
  if (CODE_EXTENSIONS.has(extension)) return 'code';
  if (OFFICE_EXTENSIONS.has(extension)) return 'document';
  if (normalizedMime.startsWith('video/')) return 'media';
  if (normalizedMime.startsWith('image/')) return 'media';
  if (normalizedMime.startsWith('text/')) return 'note';
  return 'document';
};

export const isTextLikeFile = (file: {
  name?: string | null;
  extension?: string | null;
  mimeType?: string | null;
  fileCategory?: string | null;
  isBinary?: boolean | null;
}) => {
  const extension = (file.extension || getExtension(file.name)).toLowerCase();
  const mimeType = file.mimeType?.toLowerCase() || '';
  const category = file.fileCategory?.toLowerCase() || '';

  if (isTextLikeExtension(extension)) return true;
  if (category === 'code' || category === 'note') return true;
  if (mimeType.startsWith('text/') || mimeType === 'application/json') return true;
  return !file.isBinary && !OFFICE_EXTENSIONS.has(extension);
};

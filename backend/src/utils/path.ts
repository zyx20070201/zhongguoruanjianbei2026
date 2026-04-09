export const generateNewPath = (parentPath: string | null | undefined, name: string): string => {
  if (!parentPath) {
    return `/${name}`;
  }
  // Ensure parentPath doesn't end with a slash unless it's just '/'
  const normalizedParent = parentPath === '/' ? '' : parentPath;
  return `${normalizedParent}/${name}`;
};

export const getExtension = (name: string): string | null => {
  if (!name.includes('.')) return null;
  const parts = name.split('.');
  if (parts.length === 1 || (parts.length === 2 && parts[0] === '')) {
    // No extension (e.g. 'filename' or '.hidden')
    return null;
  }
  return parts.pop() || null;
};

export const replacePathPrefix = (oldPath: string, newPrefix: string, oldPrefix: string): string => {
  if (oldPath === oldPrefix) {
    return newPrefix;
  }
  // ensure we only replace the exact folder path prefix, e.g. /folder/subfolder, not /folder123
  if (oldPath.startsWith(`${oldPrefix}/`)) {
    return `${newPrefix}${oldPath.substring(oldPrefix.length)}`;
  }
  return oldPath;
};

export const isDescendant = (descendantPath: string, ancestorPath: string): boolean => {
  if (descendantPath === ancestorPath) return false;
  return descendantPath.startsWith(`${ancestorPath}/`);
};

export const generateUniqueFilename = (originalName: string, existingNames: Set<string>): string => {
  if (!existingNames.has(originalName)) {
    return originalName;
  }

  const extMatch = originalName.match(/(\.[^.]+)$/);
  const extension = extMatch ? extMatch[0] : '';
  const baseName = extMatch ? originalName.replace(extMatch[0], '') : originalName;

  let counter = 1;
  let newName = '';
  do {
    newName = `${baseName}(${counter})${extension}`;
    counter++;
  } while (existingNames.has(newName));

  return newName;
};

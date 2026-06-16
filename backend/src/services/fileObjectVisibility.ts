const parseJsonObject = (value: unknown): Record<string, any> => {
  if (!value) return {};
  if (typeof value === 'object') return value as Record<string, any>;
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

const parseTags = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
};

export const internalDerivedFileWhere = {
  OR: [
    { scope: 'internal' },
    { resourceType: 'internal_asset' },
    { path: { contains: '/Video Frames/' } },
    { tags: { contains: 'video-frame' } }
  ]
};

export const visibleUserFileObjectWhere = {
  NOT: internalDerivedFileWhere
};

export const hiddenFromWorkspaceKnowledgeWhere = {
  OR: [
    ...internalDerivedFileWhere.OR,
    {
      AND: [
        { ownerWorkbenchId: { not: null } },
        {
          OR: [
            { resourceType: { in: ['generated', 'artifact'] } },
            { fileCategory: { in: ['generated', 'artifact'] } },
            { origin: { in: ['ai', 'ai-studio', 'system'] } },
            { tags: { contains: 'ai-studio' } }
          ]
        }
      ]
    }
  ]
};

export const visibleWorkspaceKnowledgeWhere = {
  NOT: hiddenFromWorkspaceKnowledgeWhere
};

export const isInternalDerivedFileObject = (file: any) => {
  const metadata = parseJsonObject(file?.metadataJson ?? file?.metadata);
  const tags = parseTags(file?.tags);
  const path = String(file?.path || '');
  const resourceType = String(file?.resourceType || '').toLowerCase();
  const scope = String(file?.scope || '').toLowerCase();

  return (
    scope === 'internal' ||
    resourceType === 'internal_asset' ||
    metadata.hiddenFromKnowledge === true ||
    metadata.assetKind === 'video_frame' ||
    tags.includes('video-frame') ||
    path.includes('/Video Frames/')
  );
};

export const isHiddenFromWorkspaceKnowledge = (file: any) => {
  if (isInternalDerivedFileObject(file)) return true;

  const tags = parseTags(file?.tags);
  const resourceType = String(file?.resourceType || '').toLowerCase();
  const fileCategory = String(file?.fileCategory || '').toLowerCase();
  const origin = String(file?.origin || '').toLowerCase();
  const ownerWorkbenchId = file?.ownerWorkbenchId;

  return Boolean(
    ownerWorkbenchId &&
    (
      resourceType === 'generated' ||
      resourceType === 'artifact' ||
      fileCategory === 'generated' ||
      fileCategory === 'artifact' ||
      origin === 'ai' ||
      origin === 'ai-studio' ||
      origin === 'system' ||
      tags.includes('ai-studio')
    )
  );
};

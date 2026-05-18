import prisma from '../config/db';

export type WorkbenchResourceRole = 'source' | 'note' | 'generated' | 'artifact' | 'resource' | 'file' | string;

export const normalizeWorkbenchResourceRole = (value?: string | null) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === 'workspace') return 'file';
  if (normalized === 'sources') return 'source';
  if (normalized === 'generates') return 'generated';
  if (normalized === 'note') return 'file';
  if (normalized === 'resource') return 'source';
  return normalized;
};

export const workbenchResourceTypeFilter = (role?: string | null) => {
  const normalized = normalizeWorkbenchResourceRole(role);
  if (!normalized) return undefined;
  if (normalized === 'file') return { in: ['file', 'note', 'source', 'resource'] };
  return normalized;
};

export const workbenchBindingRoleFilter = (role?: string | null) => {
  const normalized = normalizeWorkbenchResourceRole(role);
  if (!normalized) return undefined;
  if (normalized === 'file') return { in: ['file', 'note', 'source', 'resource'] };
  return normalized;
};

export const buildWorkbenchResourceWhere = (input: {
  workspaceId: string;
  workbenchId: string;
  role?: string | null;
  rootPath?: string | null;
}) => {
  const resourceType = workbenchResourceTypeFilter(input.role);
  const bindingRole = workbenchBindingRoleFilter(input.role);
  const normalizedRootPath = input.rootPath
    ? `/${input.rootPath.replace(/^\/+|\/+$/g, '')}`
    : null;
  const filePathFilters = normalizedRootPath
    ? [
        { path: { startsWith: `${normalizedRootPath}/Files/` } },
        { path: { startsWith: `${normalizedRootPath}/files/` } },
        { path: { startsWith: `${normalizedRootPath}/Sources/` } },
        { path: { startsWith: `${normalizedRootPath}/sources/` } },
        { path: { startsWith: `${normalizedRootPath}/Resources/Files/` } },
        { path: { startsWith: `${normalizedRootPath}/resources/files/` } },
        { path: { startsWith: `${normalizedRootPath}/Resources/Sources/` } },
        { path: { startsWith: `${normalizedRootPath}/resources/sources/` } }
      ]
    : [];
  const pathScope = filePathFilters.length
    ? {
        AND: [
          ...(resourceType ? [{ resourceType }] : []),
          { OR: filePathFilters }
        ]
      }
    : null;

  return {
    workspaceId: input.workspaceId,
    nodeType: 'file',
    OR: [
      {
        ownerWorkbenchId: input.workbenchId,
        ...(resourceType ? { resourceType } : {})
      },
      {
        workbenchBindings: {
          some: {
            workbenchId: input.workbenchId,
            ...(bindingRole ? { role: bindingRole } : {})
          }
        }
      },
      ...(pathScope ? [pathScope] : [])
    ]
  };
};

export const buildWorkspaceResourceWhere = (input: {
  workspaceId: string;
  role?: string | null;
}) => {
  const resourceType = workbenchResourceTypeFilter(input.role);

  return {
    workspaceId: input.workspaceId,
    nodeType: 'file',
    ...(resourceType ? { resourceType } : {}),
    OR: [
      { scope: 'workspace' },
      { ownerWorkbenchId: null }
    ]
  };
};

export const findWorkbenchResourceFiles = (input: {
  workspaceId: string;
  workbenchId: string;
  role?: string | null;
  rootPath?: string | null;
  take?: number;
  include?: Record<string, unknown>;
  select?: Record<string, unknown>;
  orderBy?: unknown;
}) =>
  prisma.fileSystemObject.findMany({
    where: buildWorkbenchResourceWhere(input),
    ...(input.include ? { include: input.include } : {}),
    ...(input.select ? { select: input.select } : {}),
    orderBy: input.orderBy || [{ updatedAt: 'desc' }, { name: 'asc' }],
    ...(input.take ? { take: input.take } : {})
  } as any);

export const getWorkbenchResourceFileIds = async (input: {
  workspaceId: string;
  workbenchId: string;
  role?: string | null;
}) => {
  const files = await prisma.fileSystemObject.findMany({
    where: buildWorkbenchResourceWhere(input),
    select: { id: true }
  });

  return files.map((file) => file.id);
};

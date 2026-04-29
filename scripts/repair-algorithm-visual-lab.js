const { PrismaClient } = require('../backend/node_modules/@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();
const workbenchesFile = path.resolve(__dirname, '../backend/data/workbenches.json');
const targetWorkbenchTitle = 'Algorithm Visual Lab';
const targetRootPath = '/Algorithm Visual Lab';

const fileNames = [
  'tree-traversal-visualizer.html',
  'sorting-visualizer.html',
  'graph-search-visualizer.html',
  'algorithm-review-outline.md',
  'visual-study-guide.md'
];

async function repairDatabaseFiles() {
  const files = await prisma.fileSystemObject.findMany({
    where: {
      name: { in: fileNames }
    }
  });

  for (const file of files) {
    const nextPath = `${targetRootPath}/${file.name}`;
    const workbenchFolder = await prisma.fileSystemObject.findFirst({
      where: {
        workspaceId: file.workspaceId,
        path: targetRootPath,
        nodeType: 'folder'
      }
    });

    if (!workbenchFolder) {
      continue;
    }

    await prisma.fileSystemObject.update({
      where: { id: file.id },
      data: {
        path: nextPath,
        parentId: workbenchFolder.id
      }
    });
  }
}

function repairWorkbenchJson() {
  const raw = fs.readFileSync(workbenchesFile, 'utf8');
  const store = JSON.parse(raw);

  store.workbenches = store.workbenches.map((workbench) => {
    if (workbench.title !== targetWorkbenchTitle) {
      return workbench;
    }

    const nextEditors = Array.isArray(workbench.state?.editors)
      ? workbench.state.editors.map((editor) => {
          if (!editor.resourcePath || !editor.resourcePath.startsWith('/ai-generated/')) {
            return editor;
          }

          const filename = editor.resourcePath.split('/').pop();
          if (!filename || !fileNames.includes(filename)) {
            return editor;
          }

          return {
            ...editor,
            resourcePath: `${targetRootPath}/${filename}`
          };
        })
      : workbench.state?.editors;

    return {
      ...workbench,
      state: {
        ...workbench.state,
        editors: nextEditors
      }
    };
  });

  fs.writeFileSync(workbenchesFile, JSON.stringify(store, null, 2), 'utf8');
}

async function main() {
  await repairDatabaseFiles();
  repairWorkbenchJson();
  await prisma.$disconnect();
  console.log('Algorithm Visual Lab resources repaired.');
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});

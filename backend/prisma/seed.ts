import { PrismaClient } from '@prisma/client';
import process from 'process';

const prisma = new PrismaClient();

async function main() {
  console.log('Starting seeding...');

  // Create test user
  const user = await prisma.user.create({
    data: {
      username: 'testuser',
      password: 'password123',
    },
  });
  console.log(`Created user: ${user.username}`);

  // Create test workspace
  const workspace = await prisma.workspace.create({
    data: {
      name: 'Introduction to AI',
      description: 'A comprehensive course on Artificial Intelligence basics',
      major: 'Computer Science',
      userId: user.id,
    },
  });
  console.log(`Created workspace: ${workspace.name}`);

  // Create file system objects
  const rootFolder = await prisma.fileSystemObject.create({
    data: {
      name: 'Course Materials',
      nodeType: 'folder',
      fileCategory: 'other',
      path: '/materials',
      workspaceId: workspace.id,
    },
  });

  const notesFile = await prisma.fileSystemObject.create({
    data: {
      name: 'Chapter_1_Notes.md',
      nodeType: 'file',
      fileCategory: 'note',
      path: '/materials/Chapter_1_Notes.md',
      content: '# Introduction to AI is fascinating...',
      mimeType: 'text/markdown',
      workspaceId: workspace.id,
      parentId: rootFolder.id,
    },
  });

  // Create a Workbench
  const workbench = await prisma.workbench.create({
    data: {
      name: 'Chapter 1 Study',
      layout: JSON.stringify({ type: 'split', orientation: 'horizontal' }),
      workspaceId: workspace.id,
    },
  });
  console.log(`Created workbench: ${workbench.name}`);

  // Create Panels
  await prisma.panel.create({
    data: {
      panelType: 'note-editor-panel',
      title: 'Notes',
      layoutInfo: JSON.stringify({ i: "note-1", x: 0, y: 0, w: 6, h: 4 }),
      workbenchId: workbench.id,
      fileObjectId: notesFile.id,
    },
  });

  await prisma.panel.create({
    data: {
      panelType: 'ai-assistant-panel',
      title: 'AI Assistant',
      layoutInfo: JSON.stringify({ i: "ai-1", x: 6, y: 0, w: 6, h: 4 }),
      workbenchId: workbench.id,
    },
  });

  console.log('Seeding finished.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

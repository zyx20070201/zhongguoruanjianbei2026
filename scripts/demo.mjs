import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import crypto from 'node:crypto';

const rootDir = resolve(new URL('..', import.meta.url).pathname);
const backendDir = resolve(rootDir, 'backend');
const frontendDir = resolve(rootDir, 'frontend');
const demoDbPath = process.env.DEMO_DATABASE_PATH || '/tmp/workbench-ai-studio-demo.db';
const demoDatabaseUrl = process.env.DATABASE_URL || `file:${demoDbPath}`;
const backendHost = process.env.HOST || '127.0.0.1';
const backendPort = process.env.PORT || '3001';
const frontendHost = process.env.FRONTEND_HOST || '127.0.0.1';
const frontendPort = process.env.FRONTEND_PORT || '5173';
const backendHealthUrl = `http://${backendHost}:${backendPort}/health`;
const backendStartupTimeoutMs = Number(process.env.BACKEND_STARTUP_TIMEOUT_MS || 120_000);
const devPorts = [Number(backendPort), Number(frontendPort)].filter((port) => Number.isInteger(port));
const demoUsername = process.env.DEMO_USERNAME || 'demo';
const demoEmail = process.env.DEMO_EMAIL || 'demo@example.com';
const demoPassword = process.env.DEMO_PASSWORD || 'password123';

const hashPassword = (password) => {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derivedKey}`;
};

const run = (name, command, args, options = {}) =>
  new Promise((resolvePromise, reject) => {
    console.log(`\n[demo] ${name}`);
    const child = spawn(command, args, {
      cwd: options.cwd || rootDir,
      env: options.env || process.env,
      stdio: 'inherit',
      shell: false
    });
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      reject(new Error(`${name} failed with ${signal || `code ${code}`}`));
    });
    child.on('error', reject);
  });

const freePort = (port) =>
  new Promise((resolvePromise) => {
    const finder = spawn('lsof', [`-tiTCP:${port}`, '-sTCP:LISTEN'], {
      stdio: ['ignore', 'pipe', 'ignore']
    });
    let output = '';
    finder.stdout.on('data', (chunk) => {
      output += chunk.toString();
    });
    finder.on('close', () => {
      const pids = output
        .split(/\s+/)
        .map((pid) => Number(pid))
        .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid);
      pids.forEach((pid) => {
        try {
          process.kill(pid, 'SIGTERM');
          console.log(`[demo] Stopped existing process ${pid} on port ${port}.`);
        } catch {
          // The process may already have exited.
        }
      });
      resolvePromise();
    });
  });

const ensureDependencies = async (label, dir) => {
  if (existsSync(resolve(dir, 'node_modules'))) {
    console.log(`[demo] ${label} dependencies already installed.`);
    return;
  }
  await run(`install ${label} dependencies`, 'npm', ['install', '--no-package-lock'], { cwd: dir });
};

const ensureDemoData = async () => {
  console.log('\n[demo] ensure demo account');
  const requireFromBackend = createRequire(resolve(backendDir, 'package.json'));
  const { PrismaClient } = requireFromBackend('@prisma/client');
  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: demoDatabaseUrl
      }
    }
  });

  try {
    let user = await prisma.user.findFirst({
      where: {
        OR: [{ username: demoUsername }, { email: demoEmail }]
      }
    });
    if (!user) {
      user = await prisma.user.create({
        data: {
          username: demoUsername,
          email: demoEmail,
          password: hashPassword(demoPassword)
        }
      });
      console.log(`[demo] Created user: ${demoUsername}`);
    } else {
      console.log(`[demo] User exists: ${demoUsername}`);
    }

    let workspace = await prisma.workspace.findFirst({
      where: {
        userId: user.id,
        name: 'Visual Lesson Demo'
      }
    });
    if (!workspace) {
      workspace = await prisma.workspace.create({
        data: {
          name: 'Visual Lesson Demo',
          description: 'Demo workspace for AI Studio Visual Explainer',
          major: 'Computer Science',
          userId: user.id
        }
      });
    }

    let rootFolder = await prisma.fileSystemObject.findFirst({
      where: {
        workspaceId: workspace.id,
        path: '/demo'
      }
    });
    if (!rootFolder) {
      rootFolder = await prisma.fileSystemObject.create({
        data: {
          name: 'Demo Materials',
          nodeType: 'folder',
          fileCategory: 'other',
          path: '/demo',
          workspaceId: workspace.id
        }
      });
    }

    const sqlPath = '/demo/sql-join-demo.md';
    let sqlFile = await prisma.fileSystemObject.findFirst({
      where: {
        workspaceId: workspace.id,
        path: sqlPath
      }
    });
    if (!sqlFile) {
      sqlFile = await prisma.fileSystemObject.create({
        data: {
          name: 'sql-join-demo.md',
          nodeType: 'file',
          fileCategory: 'note',
          path: sqlPath,
          content: [
            '# SQL INNER JOIN Demo',
            '',
            'Tables:',
            '',
            '| students.id | students.name |',
            '| --- | --- |',
            '| 1 | Alice |',
            '| 2 | Bob |',
            '',
            '| enrollments.student_id | enrollments.course_id |',
            '| --- | --- |',
            '| 1 | CS101 |',
            '| 2 | CS102 |',
            '',
            '| courses.id | courses.title |',
            '| --- | --- |',
            '| CS101 | Database Systems |',
            '| CS102 | Algorithms |',
            '',
            'Goal: explain how an INNER JOIN matches students to enrollments and then courses, producing only rows where both join conditions match.'
          ].join('\n'),
          mimeType: 'text/markdown',
          workspaceId: workspace.id,
          parentId: rootFolder.id
        }
      });
    }

    let workbench = await prisma.workbench.findFirst({
      where: {
        workspaceId: workspace.id,
        name: 'Visual Explainer Demo'
      }
    });
    if (!workbench) {
      workbench = await prisma.workbench.create({
        data: {
          name: 'Visual Explainer Demo',
          layout: JSON.stringify({ type: 'split', orientation: 'horizontal' }),
          workspaceId: workspace.id
        }
      });
    }

    const existingPanel = await prisma.panel.findFirst({
      where: {
        workbenchId: workbench.id,
        fileObjectId: sqlFile.id
      }
    });
    if (!existingPanel) {
      await prisma.panel.create({
        data: {
          panelType: 'note-editor-panel',
          title: 'SQL JOIN Demo',
          layoutInfo: JSON.stringify({ i: 'sql-demo', x: 0, y: 0, w: 6, h: 5 }),
          workbenchId: workbench.id,
          fileObjectId: sqlFile.id
        }
      });
    }

    console.log(`[demo] Login with ${demoUsername} / ${demoPassword}`);
  } finally {
    await prisma.$disconnect();
  }
};

const children = [];
let shuttingDown = false;

const stopChildren = () => {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (child.exitCode !== null || child.signalCode !== null) continue;
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      child.kill('SIGTERM');
    }
  }
};

const spawnDevProcess = (name, command, args, options = {}) => {
  const child = spawn(command, args, {
    cwd: options.cwd || rootDir,
    env: options.env || process.env,
    detached: true,
    stdio: 'inherit',
    shell: false
  });
  children.push(child);
  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    if (code === 0 || signal === 'SIGTERM' || signal === 'SIGINT') return;
    console.error(`[demo] ${name} exited with ${signal || `code ${code}`}.`);
    stopChildren();
    process.exitCode = code || 1;
  });
  return child;
};

const waitForBackend = async () => {
  const start = Date.now();
  while (Date.now() - start < backendStartupTimeoutMs) {
    if (shuttingDown) return false;
    try {
      const response = await fetch(backendHealthUrl);
      if (response.ok) return true;
    } catch {
      // Backend is still starting.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  }
  return false;
};

process.on('SIGINT', () => {
  stopChildren();
  process.exit(130);
});
process.on('SIGTERM', () => {
  stopChildren();
  process.exit(143);
});
process.on('exit', stopChildren);

try {
  console.log('[demo] Workbench AI Studio demo launcher');
  console.log(`[demo] Demo database: ${demoDatabaseUrl}`);
  await ensureDependencies('backend', backendDir);
  await ensureDependencies('frontend', frontendDir);
  await run('prepare demo database', 'npx', ['prisma', 'db', 'push'], {
    cwd: backendDir,
    env: { ...process.env, DATABASE_URL: demoDatabaseUrl }
  });
  await ensureDemoData();

  for (const port of devPorts) {
    await freePort(port);
  }

  const backendEnv = {
    ...process.env,
    DATABASE_URL: demoDatabaseUrl,
    HOST: backendHost,
    PORT: backendPort
  };
  const frontendEnv = {
    ...process.env,
    VITE_API_BASE_URL: `http://${backendHost}:${backendPort}/api`
  };

  spawnDevProcess('backend', 'npm', ['run', 'dev'], { cwd: backendDir, env: backendEnv });

  if (await waitForBackend()) {
    console.log(`[demo] Backend ready: ${backendHealthUrl}`);
    spawnDevProcess(
      'frontend',
      'npm',
      ['run', 'dev', '--', '--host', frontendHost, '--port', frontendPort, '--strictPort'],
      { cwd: frontendDir, env: frontendEnv }
    );
    console.log(`\n[demo] Open http://${frontendHost}:${frontendPort}/`);
    console.log('[demo] Press Ctrl+C here to stop both servers.');
  } else if (!shuttingDown) {
    console.error(`[demo] Backend did not become healthy at ${backendHealthUrl}.`);
    stopChildren();
    process.exitCode = 1;
  }
} catch (error) {
  console.error(`[demo] ${error instanceof Error ? error.message : String(error)}`);
  stopChildren();
  process.exitCode = 1;
}

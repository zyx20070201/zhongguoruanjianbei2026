import { spawn } from 'node:child_process';

const devPorts = [3001, 5173];
const backendHealthUrl = 'http://127.0.0.1:3001/health';
const backendStartupTimeoutMs = 30_000;

const freePort = (port) =>
  new Promise((resolve) => {
    const finder = spawn('lsof', ['-tiTCP:' + port, '-sTCP:LISTEN'], {
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    let output = '';
    finder.stdout.on('data', (chunk) => {
      output += chunk.toString();
    });
    finder.on('error', (error) => {
      if (error?.code === 'ENOENT') {
        console.warn(`lsof is not available; skipped stale process cleanup for port ${port}.`);
        resolve();
        return;
      }

      throw error;
    });
    finder.on('close', () => {
      const pids = output
        .split(/\s+/)
        .map((pid) => Number(pid))
        .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid);
      pids.forEach((pid) => {
        try {
          process.kill(pid, 'SIGTERM');
          console.log(`Stopped stale dev process ${pid} on port ${port}.`);
        } catch {
          // The process may already have exited.
        }
      });
      resolve();
    });
  });

for (const port of devPorts) {
  await freePort(port);
}

const children = [];
let shuttingDown = false;

const stopChildren = () => {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  for (const child of children) {
    if (child.exitCode !== null || child.signalCode !== null) {
      continue;
    }

    try {
      if (process.platform === 'win32') {
        child.kill('SIGTERM');
      } else {
        process.kill(-child.pid, 'SIGTERM');
      }
    } catch {
      child.kill('SIGTERM');
    }
  }
};

const spawnDevProcess = (name, command, args) => {
  const resolvedCommand = process.platform === 'win32' && command === 'npm' ? 'npm.cmd' : command;
  const child = spawn(resolvedCommand, args, {
    detached: process.platform !== 'win32',
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  children.push(child);

  child.on('exit', (code, signal) => {
    if (shuttingDown) {
      return;
    }

    if (code === 0 || signal === 'SIGTERM' || signal === 'SIGINT') {
      return;
    }

    console.error(`${name} dev process exited with ${signal || `code ${code}`}.`);
    stopChildren();
    process.exitCode = code || 1;
  });

  return child;
};

const waitForBackend = async () => {
  const start = Date.now();

  while (Date.now() - start < backendStartupTimeoutMs) {
    if (shuttingDown) {
      return false;
    }

    try {
      const response = await fetch(backendHealthUrl);
      if (response.ok) {
        return true;
      }
    } catch {
      // Backend is still starting.
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return false;
};

spawnDevProcess('backend', 'npm', ['run', 'dev:backend']);

if (await waitForBackend()) {
  spawnDevProcess('frontend', 'npm', ['run', 'dev:frontend']);
} else if (!shuttingDown) {
  console.error(`Backend did not become healthy at ${backendHealthUrl} within ${backendStartupTimeoutMs / 1000}s.`);
  stopChildren();
  process.exitCode = 1;
}

process.on('SIGINT', () => {
  stopChildren();
  process.exit(130);
});

process.on('SIGTERM', () => {
  stopChildren();
  process.exit(143);
});

process.on('exit', stopChildren);

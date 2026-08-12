import { spawn } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const runDir = await mkdtemp(join(tmpdir(), 'trip-planner-e2e-'));
const databasePath = join(runDir, 'trip.db');
const blobDir = join(runDir, 'blobs');
const publicDir = join(runDir, 'public');
const webDist = join(runDir, 'web');
const children = new Set();
const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]/g;

await mkdir(publicDir, { recursive: true });
await Promise.all([
  copyFile(join(root, 'apps/web/public/icon.svg'), join(publicDir, 'icon.svg')),
  copyFile(join(root, 'apps/web/public/robots.txt'), join(publicDir, 'robots.txt')),
]);

function start(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: root,
    env: { ...process.env, ...options.env },
    stdio: options.stdio ?? ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });
  children.add(child);
  child.once('exit', () => children.delete(child));
  return child;
}

function mirror(stream, prefix) {
  stream.on('data', (chunk) => {
    process.stdout.write(`[${prefix}] ${chunk}`);
  });
}

/** Reads both output streams until the server announces the port it bound. */
function portFromOutput(child, name, pattern, timeoutMs = 60_000) {
  return new Promise((resolvePort, reject) => {
    let output = '';

    const timeout = setTimeout(
      () => finish(new Error(`${name} did not announce a listening port within ${timeoutMs}ms`)),
      timeoutMs,
    );

    function read(chunk) {
      output = `${output}${chunk}`.replace(ANSI, '').slice(-16_384);
      const match = output.match(pattern);
      if (match?.[1]) finish(undefined, Number(match[1]));
    }

    function exited(code, signal) {
      finish(
        new Error(
          `${name} exited before announcing its port (${signal ? `signal ${signal}` : `code ${code}`})`,
        ),
      );
    }

    function failed(error) {
      finish(new Error(`${name} failed to start: ${error.message}`));
    }

    function finish(error, port) {
      clearTimeout(timeout);
      child.stdout?.off('data', read);
      child.stderr?.off('data', read);
      child.off('exit', exited);
      child.off('error', failed);
      if (error) reject(error);
      else resolvePort(port);
    }

    child.stdout?.on('data', read);
    child.stderr?.on('data', read);
    child.once('exit', exited);
    child.once('error', failed);
  });
}

function completed(child, name) {
  return new Promise((resolveRun, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolveRun();
      else {
        reject(
          new Error(
            `${name} failed (${signal ? `signal ${signal}` : `exit code ${code ?? 'unknown'}`})`,
          ),
        );
      }
    });
  });
}

async function run(command, args, options = {}) {
  const child = start(command, args, { ...options, stdio: 'inherit' });
  await completed(child, options.name ?? command);
}

async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;

  const signal = (name) => {
    if (process.platform === 'win32') child.kill(name);
    else {
      try {
        process.kill(-child.pid, name);
      } catch {
        // It can exit between the check and the signal.
      }
    }
  };

  signal('SIGTERM');
  await Promise.race([
    new Promise((resolveExit) => child.once('exit', resolveExit)),
    new Promise((resolveWait) => setTimeout(resolveWait, 5_000)),
  ]);
  if (child.exitCode === null && child.signalCode === null) signal('SIGKILL');
}

let stopping = false;
async function cleanup() {
  if (stopping) return;
  stopping = true;
  await Promise.all([...children].map(stop));
  await rm(runDir, { recursive: true, force: true });
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    void cleanup().finally(() => process.exit(128 + (signal === 'SIGINT' ? 2 : 15)));
  });
}

let exitCode = 1;
try {
  const api = start('pnpm', ['--filter', '@trip/api', 'exec', 'tsx', 'src/main.ts'], {
    env: {
      PORT: '0',
      HOST: '127.0.0.1',
      DATABASE_PATH: databasePath,
      BLOB_DIR: blobDir,
      NODE_ENV: 'test',
    },
  });
  const apiPortPromise = portFromOutput(
    api,
    'API',
    /api listening on http:\/\/[^:]+:(\d+)/,
  );
  mirror(api.stdout, 'api');
  mirror(api.stderr, 'api');
  const apiPort = await apiPortPromise;

  await run('pnpm', ['--filter', '@trip/web', 'exec', 'node', 'scripts/build-icons.mjs'], {
    name: 'icon build',
    env: { ICON_OUTPUT_DIR: publicDir },
  });
  await run(
    'pnpm',
    ['--filter', '@trip/web', 'exec', 'vite', 'build', '--outDir', webDist],
    {
      name: 'web build',
      env: {
        API_PORT: String(apiPort),
        WEB_PUBLIC_DIR: publicDir,
      },
    },
  );

  const web = start(
    'pnpm',
    ['--filter', '@trip/web', 'exec', 'vite', 'preview', '--outDir', webDist],
    {
      env: {
        API_PORT: String(apiPort),
        WEB_PORT: '0',
        WEB_PUBLIC_DIR: publicDir,
      },
    },
  );
  const webPortPromise = portFromOutput(web, 'Web preview', /Local:\s+http:\/\/[^:]+:(\d+)/);
  mirror(web.stdout, 'web');
  mirror(web.stderr, 'web');
  const webPort = await webPortPromise;

  const args = process.argv.slice(2);
  if (args[0] === '--') args.shift();
  const playwright = start('pnpm', ['exec', 'playwright', 'test', ...args], {
    stdio: 'inherit',
    env: { E2E_BASE_URL: `http://127.0.0.1:${webPort}` },
  });
  await completed(playwright, 'Playwright');
  exitCode = 0;
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
} finally {
  await cleanup();
}

process.exitCode = exitCode;

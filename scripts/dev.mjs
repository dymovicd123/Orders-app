import { mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';

const projectRoot = process.cwd();
const localHome = path.join(projectRoot, '.codex-home');
const wranglerHome = path.join(localHome, '.wrangler');
const logPath = path.join(wranglerHome, 'logs');
const registryPath = path.join(wranglerHome, 'registry');

for (const dir of [localHome, wranglerHome, logPath, registryPath]) {
  mkdirSync(dir, { recursive: true });
}

const env = {
  ...process.env,
  HOME: localHome,
  USERPROFILE: localHome,
  WRANGLER_LOG_PATH: logPath,
  WRANGLER_REGISTRY_PATH: registryPath,
  WRANGLER_WRITE_LOGS: 'false',
  CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false',
};

const viteBin = path.join(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js');
const port = process.env.PORT || '5173';
const host = process.env.HOST || '127.0.0.1';

const child = spawn(process.execPath, [viteBin, '--host', host, '--port', port], {
  stdio: 'inherit',
  env,
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

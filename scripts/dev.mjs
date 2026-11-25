// Backend ve web projelerini birlikte başlatır; biri kapanırsa diğeri de kapanır. Ctrl+C ikisini de durdurur.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const children = [];
let stopping = false;

function run(name, color) {
  const child = spawn(`${npm} run dev -w ${name}`, { cwd: root, shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const prefix = `\x1b[${color}m[${name}]\x1b[0m `;
  const relay = stream => target => { let rest = ''; stream.on('data', chunk => { const lines = (rest + chunk).split(/\r?\n/); rest = lines.pop() ?? ''; for (const line of lines) target.write(prefix + line + '\n'); }); };
  relay(child.stdout)(process.stdout); relay(child.stderr)(process.stderr);
  child.on('exit', code => { if (!stopping) { console.log(`${prefix}kapandı (${code ?? 0}); diğer süreç de durduruluyor.`); stop(code ?? 0); } });
  children.push(child);
}

function stop(code = 0) {
  if (stopping) return; stopping = true;
  for (const child of children) {
    if (child.exitCode !== null) continue;
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
    else child.kill('SIGTERM');
  }
  setTimeout(() => process.exit(code), 1500).unref();
}

process.on('SIGINT', () => stop(0)); process.on('SIGTERM', () => stop(0));
run('backend', 36);
run('web', 35);

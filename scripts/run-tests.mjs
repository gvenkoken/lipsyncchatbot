// Runs every unit test under tests/ (or, with "e2e", every *.e2e.test.js).
// Node's own directory and glob handling differs between versions, so the
// files are listed here and passed to `node --test` explicitly.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const e2e = process.argv[2] === 'e2e';
const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
  entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]);
const files = walk('tests')
  .filter(file => file.endsWith('.test.js') && file.endsWith('.e2e.test.js') === e2e)
  .sort();
if (!files.length) {
  console.error('No test files found.');
  process.exit(1);
}
const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(result.status ?? 1);

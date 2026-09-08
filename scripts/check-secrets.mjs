import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const files = new Set(execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean));
function addBuild(dir) { if (!existsSync(dir)) return; for (const entry of readdirSync(dir)) { const path = join(dir, entry); if (statSync(path).isDirectory()) addBuild(path); else files.add(path); } }
for (const dir of ['dist', 'dist-server', 'dist-competition']) addBuild(dir);
const local = existsSync('.env') ? readFileSync('.env', 'utf8') : '';
const key = local.match(/^BAILIAN_API_KEY=(.+)$/m)?.[1]?.trim();
const violations = [];
for (const file of files) {
  if (!existsSync(file) || !statSync(file).isFile()) continue;
  const bytes = readFileSync(file);
  if (key && key.length > 20 && bytes.includes(Buffer.from(key))) violations.push(file);
  else if (/\bsk-(?:sp-)?[A-Za-z0-9_.-]{25,}/.test(bytes.toString('utf8'))) violations.push(file);
}
const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0');
if (tracked.some(p => p === '.env' || p.startsWith('.local/') || /\.db(?:-|$)/.test(p))) violations.push('Tracked environment or local database');
if (violations.length) { console.error('Credential check failed in files:', [...new Set(violations)]); process.exitCode = 1; }
else console.log(`Credential check passed: ${files.size} source/build files; no actual credential printed or included.`);

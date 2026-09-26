// Draw a napkin script by running the command line from Node: hand it the
// script on standard input and read the one line of JSON it prints back. A
// Node program that can import the package does better with
// `import { drawFile } from 'napkin-sketch/node'`; this is the process
// boundary any tool can use.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const script = readFileSync('card.napkin', 'utf8');
const child = spawnSync('napkin-sketch', ['draw', '-', '--json', '--to', 'svg,png', '--out', 'out'], {
  input: script,
  encoding: 'utf8',
  // npm installs napkin-sketch as a .cmd file on Windows, which only a shell runs.
  shell: process.platform === 'win32',
});
if (child.error) throw child.error;

const report = JSON.parse(child.stdout);
for (const d of report.diagnostics) console.error(`${d.level} ${d.code}: ${d.message}`);
if (!report.ok) process.exit(report.exitCode);
console.log(`drew ${report.files.map((file) => file.path).join(', ')}`);

/**
 * The command line's half of `draw --prompt`: runs the script helper once.
 *
 * The form goes to `_temp/script-form.txt` in the working folder, where the AI
 * tool finds the skill a project installed; the helper command starts there
 * through the platform shell, as Animation Mode starts its helper, so the
 * default command's `< _temp/script-form.txt` resolves in cmd.exe and a POSIX
 * shell alike, and the form goes to its standard input as well, for a command
 * that reads it from there. What the helper saved to
 * `_temp/script-out.napkin` is read back, and both files are removed, with the
 * folder when nothing else is in it. The loop around this - the check, and the
 * second try - is `promptScript` in the core.
 */

import { spawn, spawnSync } from 'node:child_process';
import { mkdir, readFile, rm, rmdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { SCRIPT_FORM_FILE, SCRIPT_OUT_FILE, type ScriptHelperRun } from '../core/script/ai-bridge.js';

/** How long one try may run before it is stopped: a script is short, and a stalled tool should not hold a build. */
export const SCRIPT_HELPER_TIMEOUT_MS = 5 * 60 * 1000;

/** True when an executable can be found on the PATH, by the platform's own lookup. */
export function onPath(binary: string): boolean {
  const probe = process.platform === 'win32' ? 'where' : 'which';
  return spawnSync(probe, [binary], { windowsHide: true }).status === 0;
}

/**
 * Stops a helper and everything it started. The command runs inside a shell,
 * so killing the shell alone would leave the tool running: on Windows
 * `taskkill` takes the whole tree, and elsewhere the signal reaches the
 * shell's children.
 */
function stop(child: ReturnType<typeof spawn>): void {
  if (child.exitCode !== null || child.killed) return;
  if (process.platform === 'win32' && child.pid) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
  else child.kill('SIGTERM');
}

/** Runs the helper command once on a form, in `cwd`, and gives back what it saved and said. */
export async function runScriptHelper(
  command: string,
  cwd: string,
  form: string,
  timeoutMs: number = SCRIPT_HELPER_TIMEOUT_MS,
): Promise<ScriptHelperRun> {
  const formPath = join(cwd, SCRIPT_FORM_FILE);
  const outPath = join(cwd, SCRIPT_OUT_FILE);
  await mkdir(dirname(formPath), { recursive: true });
  await writeFile(formPath, form, 'utf8');
  // A script an earlier run left must not read as this run's.
  await rm(outPath, { force: true });

  const ran = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
    let stdout = '';
    let stderr = '';
    const child = spawn(command, { cwd, shell: true, windowsHide: true });
    const timer = setTimeout(() => {
      stderr += `\nnapkin-sketch: the helper was still running after ${Math.round(timeoutMs / 1000)} seconds, and was stopped`;
      stop(child);
    }, timeoutMs);
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    // A command that redirects its input from the form file never reads this, and may close it first.
    child.stdin?.on('error', () => undefined);
    child.stdin?.end(form);
    child.on('error', (err) => {
      stderr += `\n${err.message}`;
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });

  let saved: string | null = null;
  try {
    saved = await readFile(outPath, 'utf8');
  } catch {
    // Nothing saved: the script may have been printed instead.
  }
  await rm(formPath, { force: true });
  await rm(outPath, { force: true });
  await rmdir(dirname(formPath)).catch(() => undefined);
  return { saved, ...ran };
}

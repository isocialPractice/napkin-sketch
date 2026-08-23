/**
 * Animation Mode's install record.
 *
 * Animation Mode is optional. A plain install of napkin-sketch does not have
 * it: no Edit-menu entry, no shortcut, no banner, and no AI tool required.
 * It is added by `npm run animation-mode -- --install --to <tool>`, which
 * copies the helper's skill and instructions into that tool's dot-folder and
 * writes the record below; `--uninstall` removes both and leaves every other
 * feature of the app untouched.
 *
 * The record is the app's only source of truth for whether the mode is
 * present, which is what keeps the feature pluggable: one file decides, and
 * the UI that depends on it is gated on that one answer.
 *
 * No credential of any kind is written here. The record names which AI tool
 * was chosen, nothing about the account behind it.
 */

/** Where the install record lives, relative to the helper's working directory. */
export const ANIMATION_INSTALL_FILE = 'ai-helper/installed.json';

/** What `--install` records about an Animation Mode install. */
export interface AnimationInstall {
  /** Record format, so a later install can migrate an older one. */
  version: 1;
  /** Id of the AI tool the install targeted (`claude`, `copilot`, …). */
  tool: string;
  /** Dot-folder the skill and instructions were copied into (`.claude`). */
  target: string;
  /** When the install ran, as an ISO date string. */
  installedAt: string;
}

/**
 * Reads an install record, returning null for anything that is not one:
 * absent file, malformed JSON, a future format, or a record with no tool.
 * A null answer always means "Animation Mode is not installed", so a damaged
 * record degrades to the mode being absent rather than to a broken app.
 */
export function parseAnimationInstall(text: string): AnimationInstall | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Partial<AnimationInstall>;
  if (record.version !== 1) return null;
  if (typeof record.tool !== 'string' || record.tool.trim() === '') return null;
  if (typeof record.target !== 'string' || record.target.trim() === '') return null;
  return {
    version: 1,
    tool: record.tool.trim(),
    target: record.target.trim(),
    installedAt: typeof record.installedAt === 'string' ? record.installedAt : '',
  };
}

/** Serializes an install record for `ai-helper/installed.json`. */
export function serializeAnimationInstall(install: AnimationInstall): string {
  return `${JSON.stringify(install, null, 2)}\n`;
}

/** What the renderer is told about the feature at startup. */
export interface AnimationModeStatus {
  /** True when the install record is present and readable. */
  installed: boolean;
  /** Id of the AI tool the install targeted, when installed. */
  tool: string | null;
}

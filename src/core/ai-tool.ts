/**
 * The AI tools Animation Mode can drive, and how to tell why one refused.
 *
 * Animation Mode is the only part of napkin-sketch that needs software the
 * app does not ship: an agentic AI command-line tool. That dependency is why
 * the mode installs separately (see `animationInstall`) and why a run can
 * fail for reasons that have nothing to do with drawing - the tool may not be
 * on the machine, or the user may never have signed in to it.
 *
 * Credentials are never read, written, or held by napkin-sketch. Each tool
 * keeps its own login, and the most the app does is start that tool so the
 * tool can run its own sign-in.
 */

/** An agentic CLI that can act as the Animation Mode helper. */
export interface AiTool {
  /** Stable id used in the install record and the IPC calls. */
  id: string;
  /** Human-readable name for dialogs and docs. */
  label: string;
  /** Executable the helper command starts with. */
  binary: string;
  /** Dot-folder the skill and instructions install into for this tool. */
  target: string;
  /**
   * True when the tool can load the helper as a plugin rather than as files
   * copied into its dot-folder. Only Claude Code does today, which is why
   * `target` stays required: the plugin is an alternative delivery, not a
   * replacement for one.
   */
  plugin: boolean;
  /**
   * Where the tool's own sign-in lives. Every one of these CLIs prompts for
   * sign-in when it is started interactively and has no credentials, so the
   * app starts the tool itself rather than guessing at a login subcommand
   * that may differ between versions.
   */
  signInHint: string;
}

/** The tools napkin-sketch knows how to name and start. */
export const AI_TOOLS: readonly AiTool[] = [
  {
    id: 'claude',
    label: 'Claude Code',
    binary: 'claude',
    target: '.claude',
    plugin: true,
    signInHint: 'Run `claude` in a terminal and follow its sign-in prompt.',
  },
  {
    id: 'copilot',
    label: 'GitHub Copilot CLI',
    binary: 'copilot',
    target: '.github',
    plugin: false,
    signInHint: 'Run `copilot` in a terminal and follow its sign-in prompt.',
  },
  {
    id: 'codex',
    label: 'Codex CLI',
    binary: 'codex',
    target: '.codex',
    plugin: false,
    signInHint: 'Run `codex` in a terminal and follow its sign-in prompt.',
  },
  {
    id: 'gemini',
    label: 'Gemini CLI',
    binary: 'gemini',
    target: '.gemini',
    plugin: false,
    signInHint: 'Run `gemini` in a terminal and follow its sign-in prompt.',
  },
];

/** The tool with this id, if it is one napkin-sketch knows. */
export function aiToolById(id: string): AiTool | null {
  return AI_TOOLS.find((t) => t.id === id.trim().toLowerCase()) ?? null;
}

/**
 * The helper packaged as a plugin.
 *
 * `ai-helper/` is not only the folder the dot-folder installs copy from: it
 * is the plugin itself, listed by the marketplace manifest at the repository
 * root. A tool that loads plugins therefore gets the whole helper - the
 * command, the subagent, both skills, and the contract - as one addressable
 * unit, instead of two skill folders it has to be told the paths of.
 *
 * The app needs these names because a plugin renames what it carries: inside
 * a plugin a skill answers to `<plugin>:<skill>`, so a form that named the
 * bare skill would be naming something the tool cannot find.
 */
export const ANIMATION_PLUGIN = {
  /** Plugin id, and the namespace its skills, command, and subagent answer to. */
  name: 'vectors',
  /** Marketplace that lists it, from `.claude-plugin/marketplace.json` at the repo root. */
  marketplace: 'napkin-sketch',
  /** The plugin root inside the repository. */
  dir: 'ai-helper',
  /** Slash command that draws one frame from the form the app writes. */
  command: 'animation-mode',
  /** Subagent that draws one frame in a context of its own. */
  agent: 'animation-frame',
} as const;

/** One of the plugin's parts, named the way a tool addresses it: `vectors:...`. */
export function pluginRef(part: string): string {
  return `${ANIMATION_PLUGIN.name}:${part}`;
}

/**
 * The executable a helper command runs: the first bare word, with any path,
 * quoting, and Windows extension stripped. `"C:\bin\claude.exe" -p < form`
 * and `claude -p` both resolve to `claude`.
 */
export function helperBinary(command: string): string {
  const first = command.trim().match(/^"([^"]+)"|^(\S+)/);
  const raw = first ? (first[1] ?? first[2] ?? '') : '';
  const base = raw.split(/[\\/]/).pop() ?? '';
  return base.replace(/\.(exe|cmd|bat|ps1)$/i, '').toLowerCase();
}

/** The known tool a helper command drives, or null for an unrecognized one. */
export function helperToolFor(command: string): AiTool | null {
  const binary = helperBinary(command);
  return AI_TOOLS.find((t) => t.binary === binary) ?? null;
}

/** Why a helper run failed, as far as the app can tell from the outside. */
export type HelperFailure = 'missing-tool' | 'auth' | 'other';

/** Shell and CLI wording for "that executable does not exist". */
const MISSING_PATTERNS = [
  /is not recognized as an internal or external command/i,
  /command not found/i,
  /no such file or directory/i,
  /\bENOENT\b/,
];

/**
 * Wording the tools use when they run but have no credentials. Matched only
 * against a failed run, so an ordinary mention of "login" in a successful
 * transcript never triggers the sign-in walkthrough.
 */
const AUTH_PATTERNS = [
  /\b(not|isn't|is not) (logged|signed) ?in\b/i,
  /\bplease (log|sign) ?in\b/i,
  /\b(log|sign) ?in (to|with|required|first)\b/i,
  /\bunauthori[sz]ed\b/i,
  /\bauthenticat(e|ion) (failed|required|error)\b/i,
  /\b(missing|invalid|expired) (api[- ]?key|token|credential)/i,
  /\b401\b/,
  /\bOAuth\b/i,
];

/**
 * Classifies a failed helper run so the app can offer the right way out: the
 * tool is absent, the tool is there but nobody has signed in, or something
 * else entirely. Only ever called for a run that produced no frame.
 */
export function classifyHelperFailure(result: {
  code: number | null;
  stderr: string;
  stdout?: string;
}): HelperFailure {
  const text = `${result.stderr}\n${result.stdout ?? ''}`;
  // Shells report a missing command as 127 (POSIX) or 9009 (cmd.exe).
  if (result.code === 127 || result.code === 9009) return 'missing-tool';
  if (MISSING_PATTERNS.some((p) => p.test(text))) return 'missing-tool';
  if (AUTH_PATTERNS.some((p) => p.test(text))) return 'auth';
  return 'other';
}

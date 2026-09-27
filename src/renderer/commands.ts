/**
 * The drawing window's commands, by id.
 *
 * A menu row, a toolbar button and a right-click row all name the same ids -
 * the ones in `src/core/menu/tool-types.json` - and all of them run through
 * {@link Commands.run}, so a command does one thing however it was reached.
 * The handler table is typed over every command the drawing window owns, so
 * a command added to the menu files without a handler here does not compile.
 *
 * A few commands belong to the main process: they open a window or a browser
 * (Verbose Settings, the Help rows). Those are handed on rather than run here,
 * which is what a click on the same row of the native menu does too.
 */

import {
  isMainCommand,
  isMenuCommand,
  type HelpTopicId,
  type MainCommandId,
  type RendererCommandId,
} from '../core/menu/ids.js';

/**
 * What every command the drawing window owns does. A handler that finishes
 * later - Import reads a file before it changes the page - returns its promise.
 */
export type CommandHandlers = Readonly<Record<RendererCommandId, () => void | Promise<unknown>>>;

/** Runs commands by id. */
export class Commands {
  constructor(
    private readonly handlers: CommandHandlers,
    /** Hands a command the main process runs over to it. */
    private readonly forward: (id: MainCommandId | HelpTopicId) => void,
  ) {}

  /**
   * Runs a command. False for an id that names no command, which only a
   * mistake in the app can produce: every caller passes an id from the menu
   * files. `done` is called when the command has finished: straight away for
   * most, and when its promise settles for one that returns one.
   */
  run(id: string, done?: () => void): boolean {
    if (isMainCommand(id)) {
      this.forward(id);
      done?.();
      return true;
    }
    if (!isMenuCommand(id)) return false;
    const handler = (this.handlers as Readonly<Record<string, (() => unknown) | undefined>>)[id];
    if (!handler) return false;
    let result: unknown;
    try {
      result = handler();
    } catch (err) {
      done?.();
      throw err;
    }
    if (result instanceof Promise) {
      result.then(
        () => done?.(),
        (err: unknown) => {
          done?.();
          console.error(err);
        },
      );
    } else {
      done?.();
    }
    return true;
  }
}

/**
 * When a bare `Alt` may open the menu bar.
 *
 * On Windows, pressing and letting go of `Alt` alone hands the keyboard to
 * the menu bar. Drawing uses `Alt` a great deal - `Alt` + scroll zooms,
 * `Alt` + drag copies, `Alt` bends a quick curve into a circle - and every
 * one of those used to end with the menu bar taking the keyboard from the
 * canvas. So the menu bar gets a bare `Alt` only when it was meant for it: no
 * other key in the {@link ALT_MENU_IDLE_MS} before it went down, and nothing
 * done with it while it was held.
 *
 * A bare `Alt` is not itself counted as a key, so tapping `Alt` again to
 * leave the menu works as it always has, and `Alt` with a letter (a menu's
 * mnemonic) is a chord of its own, which this rule does not touch. The
 * drawing window calls `preventDefault()` on the `Alt` keyup when
 * {@link AltMenuRule.altUp} says no; Electron gives the menu bar only the keys
 * the page leaves unhandled.
 */

/** How long the keyboard must have been idle before a bare `Alt` may open the menu bar. */
export const ALT_MENU_IDLE_MS = 5000;

/** The state the rule keeps, fed every key and every `Alt` gesture the window sees. */
export class AltMenuRule {
  /** When the last key other than a bare `Alt` went down. */
  private lastKeyAt = -Infinity;
  /** When the `Alt` now held went down, or null while it is up. */
  private altDownAt: number | null = null;
  /** Whether anything was done with the `Alt` now held. */
  private used = false;

  /** A key went down (`repeat` for the keyboard's own auto-repeat). */
  keyDown(key: string, now: number, repeat = false): void {
    if (key === 'Alt') {
      if (this.altDownAt === null && !repeat) {
        this.altDownAt = now;
        this.used = false;
      }
      return;
    }
    this.lastKeyAt = now;
    if (this.altDownAt !== null) this.used = true;
  }

  /** Something was done with `Alt` held: a scroll, a press or a drag with it, a key while a press was under way. */
  gesture(): void {
    if (this.altDownAt !== null) this.used = true;
  }

  /**
   * `Alt` came up: whether the menu bar may have it. True only when nothing
   * was done with it and no other key went down in the
   * {@link ALT_MENU_IDLE_MS} before it did. The rule is ready for the next
   * `Alt` afterwards.
   */
  altUp(): boolean {
    const down = this.altDownAt;
    const allowed = down !== null && !this.used && down - this.lastKeyAt >= ALT_MENU_IDLE_MS;
    this.altDownAt = null;
    this.used = false;
    return allowed;
  }

  /** The window lost the focus: an `Alt` held then comes up somewhere else. */
  reset(): void {
    this.altDownAt = null;
    this.used = false;
  }

  /** Whether `Alt` is down, as far as the rule has heard. */
  get held(): boolean {
    return this.altDownAt !== null;
  }
}

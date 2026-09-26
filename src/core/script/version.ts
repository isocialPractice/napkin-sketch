/**
 * The version rule, shared by the text parser and the JSON validator: a script
 * names the language version it was written for in its first instruction.
 *
 * Without one, version 1 is assumed and a warning says so. A version newer
 * than this build reads is an error that names the newest it does, since a
 * script written for a later language may mean something this build would draw
 * differently.
 */

import { makeDiagnostic, type Where } from './diagnostics.js';
import { SCRIPT_VERSION, type Diagnostic, type Instruction } from './instructions.js';

/** How to check: whether a missing `napkin` is worth a warning, and where a diagnostic points. */
export interface VersionCheck {
  /** True for a fragment, or a script that had a `napkin` line which was reported already. */
  fragment: boolean;
  whereOf(instruction: Instruction, index: number): Where;
}

/** Checks the version a script names, adding what it finds to `diagnostics`. */
export function checkVersion(script: readonly Instruction[], diagnostics: Diagnostic[], check: VersionCheck): void {
  const first = script[0];
  if (!first) return;
  if (first.verb !== 'napkin') {
    if (!check.fragment) {
      diagnostics.push(
        makeDiagnostic(
          'version-missing',
          `The script does not start with \`napkin ${SCRIPT_VERSION}\`, so version ${SCRIPT_VERSION} is assumed.`,
          check.whereOf(first, 0),
        ),
      );
    }
    return;
  }
  if (first.version > SCRIPT_VERSION) {
    diagnostics.push(
      makeDiagnostic(
        'version-unsupported',
        `This script is written for napkin ${first.version}, and this build reads up to napkin ${SCRIPT_VERSION}.`,
        check.whereOf(first, 0),
        { verb: 'napkin' },
      ),
    );
  } else if (first.version < 1) {
    diagnostics.push(
      makeDiagnostic('invalid-value', `There is no napkin ${first.version}; the first version is 1.`, check.whereOf(first, 0), { verb: 'napkin' }),
    );
  }
}

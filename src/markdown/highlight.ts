/**
 * Clean Language Accents' reader: an instance of highlight.js of its own,
 * with the 36 languages of its common set registered, as the core's
 * {@link AccentHighlighter}. More languages register as they are installed,
 * and any - a common one too - can be taken away and put back. It needs no
 * eval, runs synchronously and reaches for no DOM.
 */

import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import go from 'highlight.js/lib/languages/go';
import graphql from 'highlight.js/lib/languages/graphql';
import ini from 'highlight.js/lib/languages/ini';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import kotlin from 'highlight.js/lib/languages/kotlin';
import less from 'highlight.js/lib/languages/less';
import lua from 'highlight.js/lib/languages/lua';
import makefile from 'highlight.js/lib/languages/makefile';
import markdown from 'highlight.js/lib/languages/markdown';
import objectivec from 'highlight.js/lib/languages/objectivec';
import perl from 'highlight.js/lib/languages/perl';
import php from 'highlight.js/lib/languages/php';
import phpTemplate from 'highlight.js/lib/languages/php-template';
import plaintext from 'highlight.js/lib/languages/plaintext';
import python from 'highlight.js/lib/languages/python';
import pythonRepl from 'highlight.js/lib/languages/python-repl';
import r from 'highlight.js/lib/languages/r';
import ruby from 'highlight.js/lib/languages/ruby';
import rust from 'highlight.js/lib/languages/rust';
import scss from 'highlight.js/lib/languages/scss';
import shell from 'highlight.js/lib/languages/shell';
import sql from 'highlight.js/lib/languages/sql';
import swift from 'highlight.js/lib/languages/swift';
import typescript from 'highlight.js/lib/languages/typescript';
import vbnet from 'highlight.js/lib/languages/vbnet';
import wasm from 'highlight.js/lib/languages/wasm';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import type { AccentHighlighter } from '../core/type/accents.js';

/** A language's definition, as each of highlight.js's language files gives it. */
export type AccentLanguageDefinition = Parameters<typeof hljs.registerLanguage>[1];

/** The common set's definitions, in the order highlight.js's own `common` registers them. */
export const COMMON_DEFINITIONS: Readonly<Record<string, AccentLanguageDefinition>> = {
  xml,
  bash,
  c,
  cpp,
  csharp,
  css,
  markdown,
  diff,
  ruby,
  go,
  graphql,
  ini,
  java,
  javascript,
  json,
  kotlin,
  less,
  lua,
  makefile,
  perl,
  objectivec,
  php,
  'php-template': phpTemplate,
  plaintext,
  python,
  'python-repl': pythonRepl,
  r,
  rust,
  scss,
  shell,
  sql,
  swift,
  yaml,
  typescript,
  vbnet,
  wasm,
};

/** highlight.js as a highlighter, and the way to register and take away a language. */
export interface HljsReader {
  readonly highlighter: AccentHighlighter;
  /** Registers a language: from `definition`, or a common one from the app's own. False for a language with neither. */
  register(id: string, definition?: AccentLanguageDefinition): boolean;
  unregister(id: string): void;
  /** The ids registered now. */
  languages(): string[];
}

/** An instance of highlight.js with the common set, read through: an id or an alias resolved to the id it was registered under. */
export function createHljsReader(): HljsReader {
  const instance = hljs.newInstance();
  for (const [id, definition] of Object.entries(COMMON_DEFINITIONS)) instance.registerLanguage(id, definition);
  // Each registered language's definition, by id, to find an alias's id from; made again when the languages change.
  let ids: Map<object, string> | null = null;
  const idsByLanguage = (): Map<object, string> => {
    if (!ids) {
      ids = new Map();
      for (const id of instance.listLanguages()) {
        const language = instance.getLanguage(id);
        if (language) ids.set(language, id);
      }
    }
    return ids;
  };
  const highlighter: AccentHighlighter = {
    highlight(code, language) {
      if (!instance.getLanguage(language)) return null;
      return instance.highlight(code, { language, ignoreIllegals: true }).value;
    },
    highlightAuto(code) {
      const result = instance.highlightAuto(code);
      return result.language ? { language: result.language, html: result.value } : null;
    },
    resolve(name) {
      const language = instance.getLanguage(name.trim().toLowerCase());
      return language ? idsByLanguage().get(language) ?? null : null;
    },
  };
  return {
    highlighter,
    register(id, definition) {
      const made = definition ?? COMMON_DEFINITIONS[id];
      if (!made) return false;
      instance.registerLanguage(id, made);
      ids = null;
      return true;
    },
    unregister(id) {
      if (!instance.getLanguage(id)) return;
      instance.unregisterLanguage(id);
      ids = null;
    },
    languages: () => instance.listLanguages(),
  };
}

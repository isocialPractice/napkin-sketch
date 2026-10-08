/**
 * The names the menu data may use, as types.
 *
 * `tool-types.json` is the one list of the app's commands, and a JSON import
 * cannot give TypeScript its ids as literal types. So the ids are written out
 * here as well, in the file's order, and `test/menu-registry.test.ts` holds
 * the two lists to each other - the pattern `INSTRUCTION_FIELDS` follows for
 * the verb table. What the copy buys is a compile error: a handler table typed
 * over {@link CommandId} does not build while a command has no handler.
 *
 * A new command is a row in the JSON, its id here, and its handler.
 */

/** Every tool, command and submenu the menus can hold, in `tool-types.json` order. */
export const COMMAND_IDS = [
  'new-sketch',
  'open',
  'import',
  'save',
  'save-as',
  'export',
  'export-png',
  'export-svg',
  'export-jpeg',
  'export-pdf',
  'export-selection',
  'export-selection-png',
  'export-selection-svg',
  'export-selection-jpeg',
  'export-selection-pdf',
  'quit',
  'undo',
  'redo',
  'cut',
  'copy',
  'paste',
  'paste-in-place',
  'duplicate',
  'delete-selection',
  'select-all',
  'deselect-all',
  'verbose-settings',
  'toggle-rearrange',
  'edit-shortcuts',
  'edit-tool-types',
  'toggle-animation',
  'toggle-pages',
  'toggle-layers',
  'toggle-properties',
  'toggle-appearance',
  'toggle-composition-styles',
  'toggle-character',
  'toggle-paragraph',
  'toggle-settings',
  'toggle-dev-tools',
  'fit-view',
  'zoom-in',
  'zoom-out',
  'toggle-full-screen',
  'tool-vector',
  'toggle-transform',
  'move-selection',
  'rotate',
  'join-strokes',
  'close-shape',
  'close-shape-sharp',
  'close-shape-smooth',
  'wipe-stacks',
  'wipe-in',
  'wipe-out',
  'wipe-out-front',
  'wipe-out-back',
  'wipe-mid',
  'wipe-outer',
  'wipe-clean',
  'mirror',
  'sharpen',
  'sharpen-selection',
  'sharpen-all',
  'tool-warp',
  'tool-liquify',
  'apply-last-effect',
  'last-effect',
  'effect-blur',
  'effect-gaussian-blur',
  'effect-adjust',
  'effect-brightness',
  'effect-contrast',
  'effect-saturate',
  'effect-grayscale',
  'effect-sepia',
  'effect-invert',
  'effect-hue-rotate',
  'effect-opacity',
  'effect-stylize',
  'effect-feather',
  'effect-drop-shadow',
  'effect-inner-shadow',
  'effect-outer-glow',
  'effect-inner-glow',
  'effect-bevel',
  'effect-emboss',
  'effect-splatter',
  'effect-warp',
  'effect-warp-arc',
  'effect-warp-arch',
  'effect-warp-unroll',
  'effect-warp-shell',
  'effect-warp-windy',
  'effect-warp-breezy',
  'effect-warp-curvy',
  'effect-warp-chart',
  'effect-warp-puffy',
  'effect-warp-expand',
  'effect-warp-cram',
  'effect-warp-twirl',
  'effect-3d',
  'effect-3d-extrude',
  'effect-3d-revolve',
  'effect-3d-options',
  'expand-appearance',
  'clear-appearance',
  'type-font',
  'type-size',
  'type-size-6',
  'type-size-7',
  'type-size-8',
  'type-size-9',
  'type-size-10',
  'type-size-11',
  'type-size-12',
  'type-size-14',
  'type-size-18',
  'type-size-21',
  'type-size-24',
  'type-size-36',
  'type-size-48',
  'type-size-60',
  'type-size-72',
  'type-size-other',
  'type-character',
  'type-paragraph',
  'type-configs',
  'type-on-path',
  'type-path-options',
  'type-path-flip',
  'type-orientation',
  'type-horizontal',
  'type-vertical',
  'type-area-options',
  'type-markdown',
  'type-accents',
  'type-accents-apply',
  'type-accents-remove',
  'type-accents-languages',
  'expand-text',
  'tool-pen',
  'tool-marker',
  'tool-eraser',
  'tool-shape-eraser',
  'tool-shape-stacker',
  'tool-split',
  'apply-erasers',
  'tool-text',
  'tool-copic',
  'tool-pencil',
  'tool-smear',
  'tool-point',
  'stroke-profile',
  'fill-in-front',
  'swap-fill-stroke',
  'add-layer',
  'group-layer',
  'ungroup-layer',
  'rename-layer',
  'delete-layer',
  'move-layer',
  'layer-up',
  'layer-down',
  'clipping-mask',
  'clip-make',
  'clip-release',
  'layer-blend',
  'blend-next',
  'blend-previous',
  'blend-normal',
  'blend-soak',
  'blend-stack',
  'blend-scorch',
  'blend-dry',
  'blend-sheer',
  'blend-bleach',
  'blend-fold',
  'blend-light',
  'blend-heavy',
  'blend-messy',
  'blend-avoidance',
  'blend-tidy',
  'blend-bright',
  'blend-dye',
  'blend-cover',
  'blend-isolate',
  'hide-layers',
  'add-page',
  'add-page-default',
  'add-page-custom',
  'add-page-from-selection',
  'delete-page',
  'prev-page',
  'next-page',
  'page-settings',
  'hide-pages',
  'generate-script',
  'script-from-media',
  'script-from-layers',
  'script-from-history',
  'track-history',
  'history-limit',
  'help-verbose',
  'help-tool-types',
  'help-source-code',
  'help-source-docs',
  'help-about',
  'tool-select',
  'tool-rect',
  'tool-ellipse',
  'tool-curve',
  'tool-bucket',
  'tool-fill',
  'tool-eyedrop',
  'clear-page',
  'composition-style-apply',
  'toggle-selection-borders',
  'quick-width',
  'quick-opacity',
  'quick-zoom',
  'cycle-color',
  'cycle-color-back',
] as const;

/** A tool, command or submenu named in `tool-types.json`. */
export type CommandId = (typeof COMMAND_IDS)[number];

/** The rows Electron draws and runs by their role: no handler of the app's runs them. */
export const ROLE_COMMAND_IDS = ['quit', 'toggle-dev-tools', 'toggle-full-screen'] as const;

/** A row Electron runs by its role. */
export type RoleCommandId = (typeof ROLE_COMMAND_IDS)[number];

/** The rows that open a submenu rather than run a command. */
export const SUBMENU_COMMAND_IDS = [
  'export',
  'export-selection',
  'close-shape',
  'wipe-stacks',
  'wipe-out',
  'sharpen',
  'effect-blur',
  'effect-adjust',
  'effect-stylize',
  'effect-warp',
  'effect-3d',
  'type-size',
  'type-on-path',
  'type-orientation',
  'type-accents',
  'move-layer',
  'clipping-mask',
  'layer-blend',
  'add-page',
  'generate-script',
  'help-tool-types',
] as const;

/** A row that opens a submenu. */
export type SubmenuCommandId = (typeof SUBMENU_COMMAND_IDS)[number];

/** A command the app runs: every tool that is neither a role row nor a submenu. */
export type RunnableCommandId = Exclude<CommandId, RoleCommandId | SubmenuCommandId>;

/**
 * The commands the main process runs itself (`host: "main"`): they open a
 * window or a browser, which the drawing window cannot do.
 */
export const MAIN_COMMAND_IDS = ['verbose-settings', 'history-limit', 'help-verbose', 'help-source-code', 'help-source-docs', 'help-about'] as const;

/** A command the main process runs. */
export type MainCommandId = (typeof MAIN_COMMAND_IDS)[number];

/** A command the drawing window runs. */
export type RendererCommandId = Exclude<RunnableCommandId, MainCommandId>;

/**
 * The prefix of the rows Help > Tool Types is filled with. They are made from
 * the menus that name a help page, not listed as tools, so a new menu with a
 * page gets its row without an entry here.
 */
export const HELP_TOPIC_PREFIX = 'help-topic:';

/** A Help > Tool Types row: the prefix and the id of the menu it documents. */
export type HelpTopicId = `${typeof HELP_TOPIC_PREFIX}${string}`;

/** Anything a menu row can ask to be run: a command, or a Help > Tool Types row. */
export type MenuCommand = RunnableCommandId | HelpTopicId;

/** True for a Help > Tool Types row's id. */
export function isHelpTopic(id: string): id is HelpTopicId {
  return id.startsWith(HELP_TOPIC_PREFIX) && id.length > HELP_TOPIC_PREFIX.length;
}

/** True for a command the main process runs, a Help > Tool Types row included. */
export function isMainCommand(id: string): id is MainCommandId | HelpTopicId {
  return (MAIN_COMMAND_IDS as readonly string[]).includes(id) || isHelpTopic(id);
}

/** True for any id a menu row can ask to be run. */
export function isMenuCommand(id: string): id is MenuCommand {
  return (
    isHelpTopic(id) ||
    ((COMMAND_IDS as readonly string[]).includes(id) &&
      !(ROLE_COMMAND_IDS as readonly string[]).includes(id) &&
      !(SUBMENU_COMMAND_IDS as readonly string[]).includes(id))
  );
}

/**
 * The questions a menu row can ask about the app before it is drawn. A row
 * names one to be disabled, hidden or checked when the answer is yes; the
 * host answers them in a {@link MenuState}.
 *
 * They are phrased so that an empty state - nothing known - leaves every row
 * enabled, shown and unchecked.
 */
export const MENU_PREDICATES = [
  /** Nothing to act on: no marks selected, and no lit layer rows that hold any. */
  'noSelection',
  /** No marks selected on the canvas, whatever the layers panel has lit. */
  'noMarksSelected',
  /**
   * The in-app clipboard is empty. Paste in Place asks this; Paste does not,
   * because the system clipboard may hold a graphic from another editor, and
   * only reading it - which Paste does - can tell.
   */
  'noClipboard',
  'cannotUndo',
  'cannotRedo',
  /** The active layer is not a group. */
  'notGroup',
  /** The book has one page, which cannot be deleted. */
  'onePage',
  /** The page in view is the book's first, so there is none before it. */
  'firstPage',
  /** The page in view is the book's last, so there is none after it. */
  'lastPage',
  'layersHidden',
  'pagesHidden',
  /** Animation Mode has no install record, so it has no menu row. */
  'animationNotInstalled',
  /** The documentation site is not deployed yet. */
  'noDocsSite',
  /** Track History is on. */
  'historyTracking',
  /** Nothing has been tracked to write a script from. */
  'noHistory',
  /** The Transform box is up on the canvas. */
  'transformBox',
  /** The page holds no eraser marks from a file made before 1.0.0-alpha.4.6.0. */
  'noLegacyErasers',
  /** The fill is in front: the colors paint the fill. */
  'fillInFront',
  /** Fewer than two of the selected marks are shapes a wipe can take (core/wipe.ts). */
  'fewerThanTwoShapes',
  /** Neither the selection nor the active layer is in a clip group: there is no clipping mask to release (core/clip.ts). */
  'noClipGroup',
  /**
   * The layers a blend acts on - the lit layer rows, or the active layer when
   * none is lit - all have this blend (core/blend.ts): the Blend submenu's
   * check marks, one a mode.
   */
  'blendNormal',
  'blendSoak',
  'blendStack',
  'blendScorch',
  'blendDry',
  'blendSheer',
  'blendBleach',
  'blendFold',
  'blendLight',
  'blendHeavy',
  'blendMessy',
  'blendAvoidance',
  'blendTidy',
  'blendBright',
  'blendDye',
  'blendCover',
  /** Every group a blend acts on has Isolate Blending. */
  'isolateBlending',
  /** Nothing the Appearance panel acts on has an effect: Clear Appearance has nothing to take off. */
  'noEffects',
  /** No effect has been applied from its options popup yet, so there is no last effect to repeat. */
  'noLastEffect',
  /** Nothing the Appearance panel acts on has an effect that bends its geometry, which is all Expand Appearance bakes. */
  'noGeometryEffects',
  /**
   * Nothing the Appearance panel acts on has a shape a Warp can bend, a
   * Splatter hatch or 3D build from: nothing is selected, or only pictures,
   * which have none. A text has its glyphs' outlines, and a group its
   * marks'.
   */
  'noShapes',
  /**
   * What the Type menu acts on - the characters selected in the text being
   * typed, or its caret's typing; else the selected texts, as the Type panel
   * does - has this size, in points: the Size submenu's check marks. With no
   * text, the next text's size.
   */
  'typeSize6',
  'typeSize7',
  'typeSize8',
  'typeSize9',
  'typeSize10',
  'typeSize11',
  'typeSize12',
  'typeSize14',
  'typeSize18',
  'typeSize21',
  'typeSize24',
  'typeSize36',
  'typeSize48',
  'typeSize60',
  'typeSize72',
  /** Every text the Type menu acts on is set horizontally, or every one vertically: Type Orientation's check marks. */
  'typeHorizontal',
  'typeVertical',
  /** No text the Type menu acts on can turn: there is none, or one runs along a path, which has no vertical. */
  'noOrientableText',
  /** No text the Type menu acts on runs along a path: Path Typing. */
  'noPathText',
  /** No text the Type menu acts on is set in a shape: Sheet Typing. */
  'noAreaText',
  /** No text for the Type menu to act on: none being typed, none selected. */
  'noText',
  /** The text the Type menu acts on - the one being typed, else the first selected - is Markdown Flow: its check mark. */
  'typeMarkdown',
  /** No paragraph the Type menu acts on has a Clean Language Accent: Remove Accents. */
  'noAccents',
] as const;

/** A question a menu row can ask. */
export type MenuPredicate = (typeof MENU_PREDICATES)[number];

/**
 * Why a row a question disables is greyed, where that is not plain from the
 * row: the in-page menus show it as the row's tooltip. A native menu has no
 * tooltip on every system, so the reason is said there too where it matters.
 */
export const MENU_PREDICATE_REASONS: Partial<Record<MenuPredicate, string>> = {
  noShapes: 'Select a mark, a text or a group. Pictures take no Warp, Splatter or 3D.',
  noPathText: 'Select a text along a path. Click a selected path with the Text tool to make one.',
  noAreaText: 'Select a text set in a shape. Click inside a selected closed shape with the Text tool, or drag a box, to make one.',
  noOrientableText: 'Select a text that does not run along a path.',
  noText: 'Select a text.',
  noAccents: 'Select a text with code colored by Clean Language Accents.',
};

/** The host's answers. A question left out is answered no. */
export type MenuState = Partial<Record<MenuPredicate, boolean>>;

/**
 * A state as another process sent it: only the known questions, and only
 * true or false answers. The main process reads the drawing window's answers
 * through this, so a stray field cannot reach the menus.
 */
export function menuStateFrom(raw: unknown): MenuState {
  const state: MenuState = {};
  if (raw === null || typeof raw !== 'object') return state;
  for (const question of MENU_PREDICATES) {
    const answer = (raw as Record<string, unknown>)[question];
    if (typeof answer === 'boolean') state[question] = answer;
  }
  return state;
}

/**
 * The version of the user's two menu files, `shortcuts.json` and
 * `tool-types.json` in the user-data folder. A file of another version is
 * ignored rather than guessed at, as a `.skbk` of an unknown version is.
 */
export const OVERRIDES_VERSION = 1;

/** The Electron menu roles the menus use. Electron labels them and owns their keys. */
export const ELECTRON_ROLES = ['quit', 'toggleDevTools', 'togglefullscreen'] as const;

/** An Electron menu role. */
export type ElectronRole = (typeof ELECTRON_ROLES)[number];

/**
 * Where a menu is drawn: the native menu bar (`top`), or inside the window -
 * a panel's right-click menu, or a toolbar button's dropdown (`panel`).
 */
export const MENU_POSITIONS = ['top', 'panel'] as const;

/** Where a menu is drawn. */
export type MenuPosition = (typeof MENU_POSITIONS)[number];

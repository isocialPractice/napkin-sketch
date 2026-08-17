# Current Roadmap

Working order for the next pass of `TODO.md`, chosen against the source state
at **3.2.2-alpha**. Every item below is patch-level, so the pass lands as
`3.2.3-alpha`.

## Sequence

1. **Text editor UX** - commit on `Esc`, keep caret styling in sync with the
   selected font size, and reposition on window resize.
   *First, because it is the last rough edge in a tool the docs and tests
   below both describe. Touches the text-editor overlay in
   `src/renderer/renderer.ts` only.*

2. **Icon rasterization** - ship multi-resolution `.ico`/`.icns` instead of a
   single PNG.
   *Build-side and self-contained: `scripts/make-icon.mjs` plus the
   electron-builder block in `package.json`. Shares no files with the rest of
   the sequence.*

3. **More tests** - cover the renderer store (undo/redo, pages, selection) and
   the embeddable `NapkinSketch` editor via a DOM test environment.
   *After 1, so the text-editor behaviour under test is the settled one. Adds
   `test/*.test.ts` files, which `scripts/test.mjs` discovers automatically.*

4. **Docs** - API reference for the embeddable package and a WordPress block
   example.
   *Last, so it documents the API the new tests have just pinned down.*

## Compatibility

Four items rather than five. The fifth candidate, **Panel Improvements >
Undock Panels**, was dropped: undocking the panels means moving them into
their own `BrowserWindow`s, which reworks the same renderer layout and IPC
surface that items 3 and 4 are meant to test and document. It waits for its
own pass.

`Panel Improvements > Resize Panels` is already shipped (3.2.0-alpha) and is
left in `TODO.md` only because its parent item is still open.

## Deferred

- Quick Features (`x.++.z`) and the Minor group need a version bump beyond a
  patch, so they do not mix into this pass.
- The Major group (pressure-aware brush, real-time collaboration, Plugin API
  v2, GUI Redesign) is breaking work and is sequenced separately.

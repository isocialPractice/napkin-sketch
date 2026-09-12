# graphic-designer

Read an existing graphic into a written design language, then generate a skill
that can draw more work in it. The point is that "make another one like this"
stops being a brief somebody re-explains and becomes a script with a name.

```text
graphic-designer/
├── .claude-plugin/plugin.json
├── commands/design-language.md            /graphic-designer:design-language
├── instructions/design-language.instructions.md
└── skills/
    ├── design-language/                   measure an asset, write it down, generate the skill
    │   ├── SKILL.md
    │   └── scripts/
    │       ├── analyze-media.mjs          the measuring tool, importable as analyzeMedia
    │       └── template.md                fill-in-the-blank procedure
    └── graphic-design-api/                compose graphics in code, with judgment
        ├── SKILL.md
        └── references/
            ├── composition.md
            ├── color-and-type.md
            └── principles.md
```

## Using it

```text
/graphic-designer:design-language path/to/asset.svg
```

Or run the analyzer directly:

```bash
node skills/design-language/scripts/analyze-media.mjs asset.svg --colors 12
node skills/design-language/scripts/analyze-media.mjs asset.svg --markdown
```

## What it can measure

| Format | Palette | Type | Strokes, radii, structure |
| --- | --- | --- | --- |
| SVG | yes, weighted by class usage | yes | yes |
| PNG | yes, quantized from the pixels | no | no |
| JPEG, GIF, WebP | no decoder | no | no |

The honesty is the feature. An empty palette means "not measured", never "no
colors", and a design language whose values were guessed is worse than none -
the next asset gets drawn to it.

Decoding a PNG needs the graphic-design API: run `npm run build` in a clone, or
install `napkin-sketch` as a dependency. The analyzer says so rather than
returning nothing and letting it look like a result.

## Installing

```bash
npm run ai-helper -- --helper graphic-designer              # -> .claude
npm run ai-helper -- --helper graphic-designer --to github  # -> .github
npm run ai-helper -- --helper graphic-designer --to plugin  # check + print /plugin
```

Or as a plugin, with the marketplace at the repository root:

```text
/plugin marketplace add .
/plugin install graphic-designer@napkin-sketch
```

Unlike `vectors`, nothing in the app runs this helper - there is no Animation
Mode-style switch and no install record. It is reached by the command, or by a
tool loading its skills.

## Where the output goes

- The **design language file** goes where the work is: beside the asset, or at
  the project root. `DESIGN_LANGUAGE.md`, or `DESIGN_LANGUAGE-<stem>.md` when
  one already exists.
- The **generated skill** goes in the AI tool folder this helper was installed
  to, under `skills/<stem>/`, colliding to `<stem>_0` rather than overwriting.
  Those folders are usually gitignored, which is correct: a generated skill is
  an artifact, not source.

Neither goes back into this plugin.

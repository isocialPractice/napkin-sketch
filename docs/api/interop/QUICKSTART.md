# Working with other programs: quickstart

[API hub](../../../API.md) · [Reference](README.md) · **Quickstart** · [Cheatsheet](CHEATSHEET.md)

SVG carries a napkin drawing into Illustrator or Inkscape and back with its
layers named, an Illustrator script rebuilds one in Illustrator's own objects,
and `link` places a file made elsewhere by reference; this is the path through
all three.

## The whole thing in five steps

1. Build the clone and put `napkin-sketch` on your PATH:

```bash
npm install
npm run build
npm link
```

2. Save this as `sign.napkin`: two groups, a name with a space and an
   ampersand in it, and a name used twice.

```napkin
napkin 1
page 320 200
name "sign"
group "Front" {
  layer "Board"
  color #1f2328 width 3 fill #ffe08a
  rect 20 20 280 120 r 12
  layer "Sun & Moon"
  fill #ff8a65
  circle 80 80 30
}
group "Back" {
  layer "Board"
  fill #326478
  rect 20 150 280 40 r 8
}
```

3. Write it as SVG, and open `sign.svg` in Inkscape: its Layers panel lists
   `Front`, holding `Board` and `Sun & Moon`, and `Back`, holding `Board`.

```bash
napkin-sketch draw sign.napkin --to svg
```

4. Bring it back. This opens the app with `sign.svg` imported as the same five
   layer rows:

```bash
napkin-sketch --import sign.svg
```

5. Or rebuild it in Illustrator itself. This writes `sign.jsx`; in
   Illustrator, choose **File > Scripts > Other Script** and pick it, and it
   builds a document with the layers `Front` and `Back`, the nested layers as
   named groups inside them, and every mark as a path on its own anchors:

```bash
napkin-sketch draw sign.napkin --to jsx
```

## A worked example

A letterhead that links its logo rather than importing it. Save this as
`logo.svg`:

```xml
<svg xmlns="http://www.w3.org/2000/svg" width="160" height="80" viewBox="0 0 160 80">
  <rect width="160" height="80" rx="12" fill="#326478"/>
  <circle cx="40" cy="40" r="22" fill="#ffe08a"/>
</svg>
```

and this as `letterhead.napkin` beside it:

```napkin
napkin 1
page 400 240
name "letterhead"
background #ffffff
link "logo.svg" at 20 20 size 160 80 name "Logo"
layer "Rule"
color #326478 width 2
line 20 120 380 120
```

Then draw both formats:

```bash
napkin-sketch draw letterhead.napkin --to svg,png
```

`letterhead.svg` holds the reference, `<image ... href="logo.svg"
data-link="true" data-name="logo.svg">`, and nothing of the logo, so a change
to `logo.svg` shows up wherever the SVG is opened. `letterhead.png` has the
logo drawn in, read from the script's folder. Rename `logo.svg` and draw
again: both files are still written, the PNG with a dashed placeholder where
the logo was, and the command warns and exits with code 3.

For Illustrator, link a PNG or a PDF: `--to jsx` places a linked file as
Illustrator's own linked item, found from the `.jsx`'s folder, and
Illustrator's scripting does not place an SVG that way, so a linked SVG
arrives as its placeholder, and the script says so when it ends.

## Where to go next

- [Exporting SVG for another editor](README.md#exporting-svg-for-another-editor):
  every attribute the writer adds, and why.
- [Importing SVG from another editor](README.md#importing-svg-from-another-editor):
  how names, groups, curves and gradients are read.
- [What survives a round trip](README.md#what-survives-a-round-trip): each way,
  row by row.
- [Rebuilding a drawing in Illustrator](README.md#rebuilding-a-drawing-in-illustrator):
  what the `.jsx` builds, where it finds a link, and what it reports.
- [Linking files made elsewhere](README.md#linking-files-made-elsewhere) and
  [Link, import or embed](README.md#link-import-or-embed).
- [The cheatsheet](CHEATSHEET.md): the attributes and the table on one page.

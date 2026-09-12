/**
 * The reference composition for the graphic-design API.
 *
 * Rebuilds the cheatsheet in `created-png_graphic-api.png` and
 * `created-svg_graphic-api.svg` - a 360 by 360 card with a title bar, a badge,
 * rules, a heading block, a code panel, and a footer with a placed logo - out
 * of nothing but the API's own elements. It is the worked example `API.md`
 * points at and the fixture `graphic-design-api.test.ts` renders, so a change
 * that breaks real composition work breaks a test rather than a user's script.
 *
 * Every colour and every position a test varies is a parameter, which is what
 * lets the variation cases re-render the same design in another palette and
 * another layout without a second copy of it.
 */

import {
  createComposition,
  type Composition,
} from '../../src/core/graphic-design/index.js';

/** The swatches the card is painted from. */
export interface CheatsheetPalette {
  page: string;
  panel: string;
  accent: string;
  paper: string;
  ink: string;
  string: string;
  keyword: string;
  comment: string;
}

/** The default palette, read off the reference graphic. */
export const DEFAULT_PALETTE: CheatsheetPalette = {
  page: '#000133',
  panel: '#0b1046',
  accent: '#4cae50',
  paper: '#ffffff',
  ink: '#414042',
  string: '#fdc83a',
  keyword: '#8ce632',
  comment: '#b4bec8',
};

/** Where the movable pieces sit. */
export interface CheatsheetLayout {
  /** Top edge of the code panel. */
  panelY: number;
  /** Centre of the badge in the title bar. */
  badge: { x: number; y: number };
  /** Top edge of the footer bar. */
  footerY: number;
}

/** The default layout, read off the reference graphic. */
export const DEFAULT_LAYOUT: CheatsheetLayout = {
  panelY: 116,
  badge: { x: 232, y: 22 },
  footerY: 318,
};

/** Options for {@link buildCheatsheet}. */
export interface CheatsheetOptions {
  palette?: Partial<CheatsheetPalette>;
  layout?: Partial<CheatsheetLayout>;
  /** A data URL for the footer logo. Omitted, the footer draws its own mark. */
  logo?: string;
}

/** The lines of the code panel, and which swatch each is painted in. */
const CODE: Array<{ text: string; tone: keyof CheatsheetPalette }> = [
  { text: 'var a = [1, 2500, 2, 50, 3, 33, 6, 75, 12];', tone: 'paper' },
  { text: 'function findMin(arr) { return Math.min.apply(null, arr); }', tone: 'keyword' },
  { text: 'function findMax(arr) { return Math.max.apply(null, arr); }', tone: 'keyword' },
  { text: "var b = findMin(a);   // 2", tone: 'comment' },
  { text: "var c = findMax(a);   // 2500", tone: 'comment' },
  { text: 'console.log(b); console.log(c);', tone: 'paper' },
  { text: '', tone: 'paper' },
  { text: "var cars = [{ make: 'Volvo', year: 2016 },", tone: 'string' },
  { text: "  { make: 'Saab', year: 2001 },", tone: 'string' },
  { text: "  { make: 'BMW', year: 2010 }];", tone: 'string' },
  { text: 'cars.sort(function (x, y) { return x.year - y.year; });', tone: 'paper' },
  { text: '// Volvo 2016, Saab 2001, BMW 2010', tone: 'comment' },
];

/**
 * Builds the reference composition.
 *
 * @returns a composition ready for `toSVG()` or `toPNG()` - both read the same
 *   elements, so the two files are the same graphic in two media.
 */
export function buildCheatsheet(options: CheatsheetOptions = {}): Composition {
  const colors: CheatsheetPalette = { ...DEFAULT_PALETTE, ...options.palette };
  const layout: CheatsheetLayout = { ...DEFAULT_LAYOUT, ...options.layout };

  const design = createComposition({
    width: 360,
    height: 360,
    units: 'px',
    background: colors.page,
    id: 'Cheatsheet',
    title: 'JavaScript arrays: a practical starting point',
  });

  // Title bar.
  design.text({
    id: 'title',
    x: 24,
    y: 30,
    text: 'Practicing.XYZ',
    fontFamily: "'Alternate Gothic No1 D', 'Oswald', sans-serif",
    fontSize: 21,
    letterSpacing: 1.4,
    transform: 'uppercase',
    fill: colors.paper,
  });

  design.group({ id: 'badge', name: 'notes badge' }, (badge) => {
    badge.rect({
      x: layout.badge.x,
      y: layout.badge.y - 12,
      width: 24,
      height: 24,
      rx: 4,
      fill: colors.accent,
    });
    badge.text({
      x: layout.badge.x + 12,
      y: layout.badge.y + 5,
      text: 'N',
      fontSize: 17,
      align: 'center',
      fill: colors.page,
    });
    badge.text({
      x: layout.badge.x + 30,
      y: layout.badge.y + 5,
      text: 'otes',
      fontSize: 16,
      fill: colors.paper,
    });
  });

  design.line({
    id: 'rule-top',
    x1: 16,
    y1: 44,
    x2: 344,
    y2: 44,
    stroke: colors.accent,
    strokeWidth: 2,
  });

  // Heading block on paper.
  design.rect({ id: 'heading-plate', x: 16, y: 50, width: 328, height: 40, fill: colors.paper });
  design.text({
    id: 'heading',
    x: 180,
    y: 66,
    text: 'JavaScript Array Practical Use Starting Point',
    fontSize: 11,
    fontWeight: 'bold',
    align: 'center',
    fill: colors.ink,
  });
  design.text({
    id: 'subheading',
    x: 180,
    y: 80,
    text: 'Find Array Max and Min Function and Sort Object',
    fontSize: 9,
    align: 'center',
    fill: colors.ink,
  });

  design.text({
    id: 'kicker',
    x: 16,
    y: 106,
    text: 'Starting Point for Practical Use:',
    fontSize: 11,
    fill: colors.paper,
  });

  // Code panel: a dark plate, a green margin rule, and the listing.
  design.group({ id: 'code-panel' }, (panel) => {
    panel.rect({
      id: 'panel-plate',
      x: 32,
      y: layout.panelY,
      width: 312,
      height: 176,
      fill: colors.panel,
      stroke: colors.accent,
      strokeWidth: 1,
    });
    panel.rect({
      id: 'panel-margin',
      x: 16,
      y: layout.panelY,
      width: 6,
      height: 176,
      fill: colors.accent,
    });
    CODE.forEach((line, i) => {
      if (!line.text) return;
      panel.text({
        x: 40,
        y: layout.panelY + 14 + i * 13,
        text: line.text,
        fontFamily: "'Courier New', monospace",
        fontSize: 6.4,
        fill: colors[line.tone],
      });
    });
  });

  // Footer: a paper bar, a placed strip clipped to a rounded plate, and the
  // marks and handle the strip is replaced by when no artwork is supplied.
  design.defineClip('footer-strip', {
    type: 'rect',
    x: 10,
    y: layout.footerY + 8,
    width: 340,
    height: 24,
    rx: 4,
  });

  design.group({ id: 'footer' }, (footer) => {
    footer.rect({ x: 0, y: layout.footerY, width: 360, height: 42, fill: colors.paper });
    footer.rect({
      x: 0,
      y: layout.footerY - 4,
      width: 360,
      height: 4,
      fill: colors.accent,
    });

    if (options.logo) {
      footer.image({
        id: 'footer-logo',
        src: options.logo,
        x: 10,
        y: layout.footerY + 8,
        width: 340,
        height: 24,
        fit: 'contain',
        clip: 'footer-strip',
        alt: 'Follow the author',
      });
      return;
    }

    // No artwork: the same footer, drawn out of elements instead of placed.
    footer.circle({
        id: 'footer-logo',
      cx: 32,
      cy: layout.footerY + 21,
      r: 13,
      fill: colors.page,
    });
    footer.text({
      x: 32,
      y: layout.footerY + 27,
      text: 'N',
      fontSize: 15,
      align: 'center',
      fill: colors.accent,
    });

    footer.text({
      id: 'follow',
      x: 56,
      y: layout.footerY + 26,
      text: 'Follow me:',
      fontSize: 10,
      transform: 'uppercase',
      letterSpacing: 0.6,
      fill: colors.ink,
    });

    // The three social marks: a ring, a dot pair, and a bird-ish triangle.
    footer.ellipse({ cx: 132, cy: layout.footerY + 21, rx: 6, ry: 6, fill: 'none', stroke: colors.ink, strokeWidth: 1.4 });
    footer.circle({ cx: 152, cy: layout.footerY + 21, r: 6, fill: '#1877f2' });
    footer.triangle({
      x: 166,
      y: layout.footerY + 15,
      width: 13,
      height: 12,
      variant: 'right',
      fill: '#1da1f2',
    });

    footer.path({
      id: 'arrow',
      d: `M 188 ${layout.footerY + 21} L 202 ${layout.footerY + 21} M 196 ${layout.footerY + 15} L 202 ${layout.footerY + 21} L 196 ${layout.footerY + 27}`,
      stroke: colors.ink,
      strokeWidth: 1.4,
      fill: null,
      lineCap: 'round',
      lineJoin: 'round',
    });

    footer.text({
      id: 'handle',
      x: 210,
      y: layout.footerY + 26,
      text: '@isocialpractice',
      fontSize: 11,
      fontWeight: 'bold',
      fill: colors.page,
    });
  });

  return design;
}

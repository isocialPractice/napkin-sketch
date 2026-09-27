# Sharpening

## At a glance

- **Auto-sharpen engine** that recognizes intent (straight line, circle/ellipse,
  polygon, or freeform) and rebuilds an idealized, hand-drawn version.
  - **Live sharpen** (off by default) — beautify each stroke the moment you lift
    the pen.
  - **Sharpen all** — clean up an entire page (or a saved file) at once.
  - **Sharpen settings panel** — tune wobble, smoothing, circle snap, end taper,
    rotational **symmetry** (mandala mode), and text size.

## Live sharpen and Sharpen all

**Live sharpen is off by default.** Toggle it in the **Quick Settings** panel
to beautify strokes automatically as you draw, or leave it off and use
**Sharpen all** when you are ready. The Quick Settings panel also exposes
wobble, smoothing, circle snap, end taper, rotational symmetry, and text size.
Raising rotational symmetry above 1 fades the mandala guide axes in, and
dropping it back to 1 fades them out.

## How auto-sharpen works

Each stroke runs through a four-stage pipeline:

1. **Resample + denoise** — even out the raw pointer samples and remove jitter
   (uniform resampling + Ramer–Douglas–Peucker simplification).
2. **Recognize intent** — classify the stroke as a line, circle/ellipse,
   polygon, or freeform curve (least-squares circle fit, corner detection,
   straightness test).
3. **Rebuild** — regenerate an idealized version of the detected shape while
   preserving its size, position, and winding direction.
4. **Humanize** — re-apply subtle, deterministic value-noise *wobble*, taper the
   stroke ends, and anchor endpoints so the result looks hand-drawn rather than
   mechanically perfect.

The engine is pure and deterministic (seeded from each stroke's id), so the same
stroke sharpens identically whether it is processed live in the GUI or headless
via `napkin-sketch --sharpen`.

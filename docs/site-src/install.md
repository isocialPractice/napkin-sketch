# Installation

## At a glance

- **Installable desktop app** with a Start-menu/desktop shortcut and app icon
  (via electron-builder).

## Desktop app (recommended)

The easiest way to install napkin-sketch is to build a native installer for
your OS using **electron-builder**. Each command builds the project and then
packages it into a platform installer placed in the `release/` folder.

### Windows

```bash
npm install
npm run dist:win
```

This produces an **NSIS installer** (`release/Napkin Sketch Setup *.exe`).
Run the installer — it adds a **Start Menu** entry and an optional desktop
shortcut. No administrator rights are required (per-user install).

To uninstall: *Settings → Apps → Napkin Sketch → Uninstall*.

### macOS

```bash
npm install
npm run dist:mac
```

This produces a **DMG disk image** (`release/Napkin Sketch-*.dmg`).
Open the DMG, drag **Napkin Sketch** into your `Applications` folder, then
eject the disk image. Launch via Launchpad or Spotlight.

> **Gatekeeper note**: On first launch macOS may say the app is from an
> unidentified developer. Right-click (or Control-click) the app icon, choose
> **Open**, then click **Open** in the dialog. You only need to do this once.

### Linux

```bash
npm install
npm run dist:linux
```

This produces an **AppImage** (`release/Napkin Sketch-*.AppImage`). Make it
executable and run it directly — no installation needed:

```bash
chmod +x "release/Napkin Sketch-*.AppImage"
./release/"Napkin Sketch-*.AppImage"
```

To integrate with your desktop environment (application menu, file manager),
use a tool such as `appimaged` or `AppImageLauncher`, or create a `.desktop`
file manually.

## Build-and-run from source (all platforms)

Requires **Node.js 18+** and a compatible Electron version.

```bash
npm install
npm run build
npm start          # builds then opens a new blank sketch
```

To install the `napkin-sketch` CLI globally from a local checkout:

```bash
npm install
npm run build
npm link
napkin-sketch      # launches from anywhere
```

Once published to npm it can be installed directly:

```bash
npm install -g napkin-sketch
```

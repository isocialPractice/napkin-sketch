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

Requires **Node.js 22.12 or newer**: Electron's installer, which `npm install`
runs to download the app's Electron, needs it. If `npm install` or
`npm start` fails, see [Troubleshooting install errors](#troubleshooting-install-errors).

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

## Troubleshooting install errors

Both errors below happen after `npm run build` has finished: the build is
fine, and it is starting Electron that fails.

### Linux: "The SUID sandbox helper binary was found, but is not configured correctly"

**Why it happens.** Chromium's sandbox uses unprivileged user namespaces.
Ubuntu 23.10 and later, 24.04, and distributions built on them such as Mint
and Pop!_OS restrict those through AppArmor. Electron then falls back to its
`chrome-sandbox` helper, which has to be owned by root with the setuid bit
set - and `npm install` writes it as an ordinary file, so Electron stops.

**Check it.**

```bash
sysctl kernel.apparmor_restrict_unprivileged_userns
```

`1` means the restriction is on, and is the cause.

**Fix 1, recommended: an AppArmor profile for the development Electron.** It
keeps the sandbox on, and lasts through `npm install`. Run it from the
repository's root folder: the heredoc is unquoted, so `$PWD` fills in the
path to this checkout's Electron.

```bash
sudo tee /etc/apparmor.d/napkin-sketch-electron >/dev/null <<EOF
abi <abi/4.0>,
include <tunables/global>

profile napkin-sketch-electron $PWD/node_modules/electron/dist/electron flags=(unconfined) {
  userns,
  include if exists <local/napkin-sketch-electron>
}
EOF
sudo apparmor_parser -r /etc/apparmor.d/napkin-sketch-electron
```

The profile names this checkout's path, so write it again if the repository
moves.

**Fix 2: do what the message asks.** This works at once, but every
`npm install` puts the file back as it was, so it has to be repeated.

```bash
sudo chown root:root node_modules/electron/dist/chrome-sandbox
sudo chmod 4755 node_modules/electron/dist/chrome-sandbox
```

**Fix 3, development only: no sandbox.**

```bash
npm start -- --no-sandbox
```

`--no-sandbox` launches Electron without Chromium's sandbox. That is fine for
trying your own checkout, and never for a build you hand to anyone else.

`sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0` also makes
the error go, but it lowers that protection for the whole system, not just
for this app; prefer the profile.

### macOS: "spawn ... Electron ENOENT"

`npm start` stops with `spawn ... Electron ENOENT`, or with
`napkin-sketch: the Electron binary is missing`, followed by the path it
looked for.

**Why it happens.** `ENOENT` means there is no Electron at that path.
Electron's own install step downloads and unpacks `Electron.app` into
`node_modules/electron/dist/`, and that step did not finish, did not run, or
what it unpacked was taken away afterwards.

**Check it.**

```bash
ls node_modules/electron/dist/
cat node_modules/electron/path.txt
```

**Fix it.** Reinstall Electron:

```bash
rm -rf node_modules/electron
npm install
```

or run only its download again:

```bash
node node_modules/electron/install.js
```

**If it keeps coming back**, one of these is the usual cause:

- **Install scripts are switched off.** `ignore-scripts=true` in the
  project's `.npmrc` or in `~/.npmrc`, or `npm install --ignore-scripts`,
  skips Electron's download.
- **`node_modules` came from another computer.** Copied or synced from a
  Linux or Windows machine, it holds that system's Electron. Never share
  `node_modules` between operating systems: run `npm install` on each.
- **iCloud is offloading the checkout.** With iCloud **Desktop & Documents**
  and **Optimize Mac Storage** on, a checkout under `~/Documents` or
  `~/Desktop` can have files inside the `.app` bundle moved to the cloud.
  Keep the repository somewhere else, such as `~/dev/`.
- **The download was interrupted.** A network or proxy problem stops it
  part-way; `npm install --foreground-scripts` shows its output, so you can
  see where it fails.

### macOS: a malware warning about Electron

macOS warns that Electron contains malware and offers to move it to the
Trash. This is also the most common reason for the `ENOENT` above: the app
was moved away.

**Why it happens.** XProtect, the malware scanner built into macOS,
quarantined the downloaded Electron. It has been seen with Electron 31, which
is long past its support; napkin-sketch now builds on Electron 44, and a
fresh install of it is the fix.

**Do not restore `Electron.app` from the Trash.** Clear the cached download
and install again instead:

```bash
rm -rf node_modules ~/Library/Caches/electron
npm install
npm start
```

To see what XProtect detected:

```bash
log show --last 2h --predicate 'eventMessage CONTAINS[c] "xprotect"' | grep -i -E "electron|detect"
```

If a fresh install is flagged as well, check that `ELECTRON_MIRROR` is not
set to an unofficial mirror, and run a malware scan: the problem is then on
the computer, not in the package.

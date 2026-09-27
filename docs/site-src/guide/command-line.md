# The command line

## Usage

```bash
napkin-sketch [option] [target]
```

| Parameter                | Description                                                           |
| :----------------------- | :-------------------------------------------------------------------- |
| `-h, --help`             | Show help for using the application from the command line.            |
| `-v, --version`          | Show the current version of the application.                          |
| `-b, --book`             | Open a saved sketch book file, using the `.skbk` extension.           |
| `-n, --new`              | New sketch, using `unnamed` or the name passed as `[target]`.         |
| `-f, --full-screen`      | Open the GUI window full screen; the default window is maximized.     |
| `-i, --import`           | Import an SVG, PDF, PNG, JPEG, GIF or WebP into the opening sketch.    |
| `-m, --multiple-imports` | Import a comma-separated list of files, laid out in a grid.           |
| `--sharpen`              | Auto-sharpen a saved sketch so it appears more hand-drawn, then open. |
| `[target]`               | A `.skbk` file to open, or a name for a new sketch file.              |

The GUI window opens maximized by default, which is not the same as full
screen: a maximized window fills the screen while keeping the title bar and its
minimize, restore-down, and close buttons in view, and restore-down returns it
to its 1280x860 size. Pass `-f, --full-screen` for true full screen, where
those buttons are not in view.

With `--multiple-imports`, each file's graphic size is measured against the
page first, then the graphics fill a row left to right and wrap to a new row
whenever the next graphic would overrun the page width; oversized graphics
scale down to fit the page. Every imported file becomes its own named layer.
Quote file names that contain spaces, for example
`-m logo.svg,"site map.svg",photo.png`.

### Commands

A first word that names a command runs it instead of opening the window. The
commands never load Electron, so they work where the GUI cannot start:

```bash
napkin-sketch <command> [arguments]
```

| Command               | Description                                                                  |
| :-------------------- | :--------------------------------------------------------------------------- |
| `draw <script \| ->`  | Draw a napkin script to `svg`, `png`, `pdf`, `skbk` or `jsx` files (`--to`). |
| `check <script \| ->` | Read and run a script and report what is wrong; write nothing.               |
| `render <book.skbk>`  | Write a book as files (`--to`), or its figure as frames (`--animate`).       |
| `verbs`               | List napkin script's verbs by category, and the shape library.               |

`-` reads the script from standard input, and `--json` prints one line of JSON
instead of the human report. The exit code is `0` drew, `1` the arguments were
wrong, `2` the script had errors, `3` a file could not be read or written, `4`
the AI helper gave back no script.
[The napkin-sketch command line](../../api/cli/README.md) has every option,
and callers in five languages.

### Examples

```bash
# Open a new, blank sketch
napkin-sketch

# New sketch named "ideas"
napkin-sketch --new ideas

# Open an existing sketch book
napkin-sketch --book ./notes.skbk

# Auto-sharpen a saved book on disk, then open it
napkin-sketch --sharpen ./notes

# Open a new sketch full screen (the default window opens maximized)
napkin-sketch --new -f

# Open a new sketch with logo.svg imported
napkin-sketch --import logo.svg

# Open a new sketch with three files laid out in a grid
napkin-sketch -m logo.svg,"site map.svg",photo.png

# Draw a napkin script to SVG and PNG, with no window
napkin-sketch draw card.napkin --to svg,png --out out

# Check a script handed over on standard input, and report in JSON
napkin-sketch check - --json < card.napkin
```

A bare path is treated as a sketch book to open:

```bash
napkin-sketch ./notes.skbk
```

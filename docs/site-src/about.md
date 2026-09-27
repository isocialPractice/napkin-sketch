# About and license

<!-- version:start -->
This documents napkin-sketch **1.0.0-alpha.4.5.0**.
<!-- version:end -->

napkin-sketch is a desktop sketching app, a browser-safe drawing engine and a
small drawing language, napkin script, all from one repository:
[isocialPractice/napkin-sketch](https://github.com/isocialPractice/napkin-sketch).
Its [changelog](../../CHANGELOG.md) records every release.

## How these pages are kept true

- **Generated, not copied.** The verb, command and exit-code tables, the JSON
  Schema and the API index are written from the code by `npm run api-docs`;
  the shortcut tables from the menu files by `npm run menu-docs`; the settings
  and npm-script tables, and these pages themselves, by `npm run site`. Each
  has a `--check` that the test suite runs, so a table that falls behind the
  code fails the tests.
- **Tested examples.** Every napkin block on the API pages is parsed and
  drawn by the tests, and the callers in sh, cmd, Node, Python and C beside
  the command-line pages are run wherever their interpreter is installed.
- **One source for each page.** The API pages and the root guides are
  rendered from the Markdown the npm package ships; the manual is the
  Markdown under `docs/site-src/`, which is what to edit. Each page links to
  its own source at the bottom.
- **Relative links only.** Nothing fetches and no link is absolute, so the
  pages work on the web, from a clone opened in a browser, and inside the
  app.

## Reporting a problem

Open an issue on [GitHub](https://github.com/isocialPractice/napkin-sketch/issues),
with the version above, what you did, what you expected and what happened.

## License

<!-- license:start -->
```text
MIT License

Copyright (c) 2026 isocialPractice

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
<!-- license:end -->

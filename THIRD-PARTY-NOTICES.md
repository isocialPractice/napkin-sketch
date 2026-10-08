# Third-party notices

napkin-sketch is MIT-licensed (see [LICENSE](LICENSE)). It bundles the code
and the data below, each under its own license, which is reproduced here as
that license asks. The npm package and the desktop app both carry this file.

## In the package and the app

### marked 18.0.14

Markdown Flow reads Markdown with `marked`'s lexer
([markedjs/marked](https://github.com/markedjs/marked)). esbuild bundles it
into `dist/`: into `napkin-sketch/markdown`, the app's renderer, the command
line and `napkin-sketch/node`.

```text
# License information

## Contribution License Agreement

If you contribute code to this project, you are implicitly allowing your code
to be distributed under the MIT license. You are also implicitly verifying that
all code is your original work. `</legalese>`

## Marked

Copyright (c) 2018+, MarkedJS (https://github.com/markedjs/)
Copyright (c) 2011-2018, Christopher Jeffrey (https://github.com/chjj/)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.

## Markdown

Copyright © 2004, John Gruber
http://daringfireball.net/
All rights reserved.

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

* Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
* Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.
* Neither the name “Markdown” nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.

This software is provided by the copyright holders and contributors “as is” and any express or implied warranties, including, but not limited to, the implied warranties of merchantability and fitness for a particular purpose are disclaimed. In no event shall the copyright owner or contributors be liable for any direct, indirect, incidental, special, exemplary, or consequential damages (including, but not limited to, procurement of substitute goods or services; loss of use, data, or profits; or business interruption) however caused and on any theory of liability, whether in contract, strict liability, or tort (including negligence or otherwise) arising in any way out of the use of this software, even if advised of the possibility of such damage.
```

### marked-highlight 2.2.4

Markdown Flow hands each fenced code block to Clean Language Accents through
`marked-highlight`
([markedjs/marked-highlight](https://github.com/markedjs/marked-highlight)),
bundled into `dist/` beside `marked`.

```text
MIT License

Copyright (c) 2021 @markedjs

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

### highlight.js 11.12.0

Clean Language Accents read code with highlight.js
([highlightjs/highlight.js](https://github.com/highlightjs/highlight.js)).
esbuild bundles its core and its 36 common languages into `dist/` - into
`napkin-sketch/markdown`, the app's renderer, the command line and
`napkin-sketch/node` - and each of its other languages into a file of its
own in `dist/renderer/accents/`, which the app loads when that language is
turned on. None of those files keeps highlight.js's own comments; this is
their notice.

```text
BSD 3-Clause License

Copyright (c) 2006, Ivan Sagalaev.
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

* Redistributions of source code must retain the above copyright notice, this
  list of conditions and the following disclaimer.

* Redistributions in binary form must reproduce the above copyright notice,
  this list of conditions and the following disclaimer in the documentation
  and/or other materials provided with the distribution.

* Neither the name of the copyright holder nor the names of its
  contributors may be used to endorse or promote products derived from
  this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

### The en-US hyphenation patterns

Text hyphenates by Liang's algorithm over the en-US patterns of hyph-utf8's
hyph-en-us (TeX Live's ushyphmax): Liang's patterns from Knuth's
`hyphen.tex` with Gerard D.C. Kuiken's additions, and `plain.tex`'s
exceptions. They are `src/core/type/hyphenation/en-us.json`, bundled into
`dist/`, which carries this notice as its file did, and the API exports it
as `HYPHENATION_NOTICE`.

```text
Copyright (C) 1990, 2004, 2005 Gerard D.C. Kuiken

Copying and distribution of this file, with or without modification, are
permitted in any medium without royalty provided the copyright notice and
this notice are preserved.
```

## In the repository only

### The test fonts

`test/fonts/napkin-test-sans.ttf` and `test/fonts/napkin-test-cff.otf`, the
fonts the tests read glyph outlines from, are subsets of Liberation Sans
2.1.5 and of Miriam Libre 1.000, renamed, as the SIL Open Font License 1.1
asks of a modified font. The license, with both originals' copyright
notices, is [test/fonts/OFL.txt](test/fonts/OFL.txt). They are test fixtures:
neither the npm package nor the desktop app carries them.

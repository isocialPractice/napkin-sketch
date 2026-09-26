@echo off
rem Draw card.napkin to SVG and PDF from a Windows batch file.
rem   0 drew; 1 the arguments were wrong; 2 the script had errors (what could
rem   be drawn is still written); 3 a file could not be read or written.
rem "call" is needed: npm installs napkin-sketch as a .cmd file, and a batch
rem file that runs another one without "call" never comes back.

call napkin-sketch draw card.napkin --to "svg,pdf" --out out
if errorlevel 3 (
  echo A file could not be read or written. 1>&2
  exit /b 3
)
if errorlevel 2 (
  echo card.napkin has errors; what could be drawn is in out\ 1>&2
  exit /b 2
)
if errorlevel 1 (
  echo napkin-sketch was called with the wrong arguments. 1>&2
  exit /b 1
)
echo Drew out\card.svg and out\card.pdf.

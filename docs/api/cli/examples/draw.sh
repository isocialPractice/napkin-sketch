#!/bin/sh
# Draw card.napkin to SVG and PNG from a shell script, and act on the exit code:
#   0 drew; 1 the arguments were wrong; 2 the script had errors (what could be
#   drawn is still written); 3 a file could not be read or written.

napkin-sketch draw card.napkin --to svg,png --out out
status=$?
case $status in
  0) echo "drew out/card.svg and out/card.png" ;;
  2) echo "card.napkin has errors; what could be drawn is in out/" >&2; exit 2 ;;
  *) echo "napkin-sketch stopped with exit code $status" >&2; exit "$status" ;;
esac

# The same script handed over on standard input, with the report as one line
# of JSON on standard output.
napkin-sketch draw - --json --name piped --out out < card.napkin

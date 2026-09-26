---
description: Write a napkin script from the form `napkin-sketch draw --prompt` left in _temp/script-form.txt, or from a request typed after the command
argument-hint: "[a request, or the path to a form file]"
allowed-tools: Read, Write, Glob, Bash(napkin-sketch:*), Bash(mkdir:*)
---

# Write one napkin script

The request is `$ARGUMENTS`. When that is empty, or is the path to a file, read the form - the
path given, or `_temp/script-form.txt`, which is where `napkin-sketch draw --prompt` writes it -
and carry out exactly what it asks: the form is the request, and everything below is how to
answer it.

1. **Load the `scripting:napkin-script` skill first.** It carries the two rules the parser holds
   a script to, how a page is laid out, three complete scripts to start from, and a verb
   reference generated from the verb table the parser reads.
2. **Read the contract** at `${CLAUDE_PLUGIN_ROOT}/instructions/napkin-script.instructions.md`
   before writing. It is the authority on the files, on what a script must be, and on what each
   failure means.
3. **Write the script.** Decide what the request leaves open - a size, a color, a label - rather
   than asking; nobody is there to answer. Place only the images and documents the form names.
4. **Check it** when `napkin-sketch` is on the PATH, and fix every error it reports:

   ```bash
   napkin-sketch check _temp/script-out.napkin --json
   ```

5. **Save once, and save the script alone**, to the path the form names -
   `_temp/script-out.napkin` - making `_temp/` when it is missing. No prose around it, no code
   fences: napkin-sketch reads the file as a script the moment the tool is done.
6. **Reply with one short line**, such as `saved _temp/script-out.napkin`. Do not print the script.

Given a request here rather than a form, there is no `_temp/` to answer into: save the script as
`<name>.napkin` in the working folder, where `<name>` is the name its `name` line gives the page,
and reply with that path and the command that draws it, `napkin-sketch draw <name>.napkin --to svg`.

If the form names a second try, it carries the last script and every diagnostic it had. Fix what
they name, keep what works, and save the whole script again.

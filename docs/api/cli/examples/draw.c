/*
 * Draw a napkin script from C: run the command line through popen and read
 * the one line of JSON it prints with --json. A real program would parse the
 * JSON; this one looks for "ok":true and passes the line on.
 */
#include <stdio.h>
#include <string.h>

#ifdef _WIN32
#define popen _popen
#define pclose _pclose
#endif

int main(void) {
  static char line[1 << 16];
  FILE *report = popen("napkin-sketch draw card.napkin --json --to svg --out out", "r");
  if (report == NULL) {
    perror("popen");
    return 3;
  }
  if (fgets(line, sizeof line, report) == NULL) line[0] = '\0';
  pclose(report);

  fputs(line, stdout);
  if (strstr(line, "\"ok\":true") == NULL) {
    fputs("napkin-sketch did not draw cleanly\n", stderr);
    return 2;
  }
  return 0;
}

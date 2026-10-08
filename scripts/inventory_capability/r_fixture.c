#include <stdio.h>
#include <unistd.h>
#include <string.h>
#ifndef MARKER
#define MARKER "target-fixture"
#endif
int main(int argc, char **argv) {
  printf("%s pid=%d argv0=%s\n", MARKER, getpid(), argv[0]); fflush(stdout);
  char line[4096];
  while (fgets(line, sizeof(line), stdin)) {
    line[strcspn(line, "\n")] = 0;
    if (!strncmp(line, "exec ", 5)) { execl(line + 5, "spoofed-exec-name", NULL); perror("exec"); return 2; }
    if (!strcmp(line, "ping")) { printf("%s pid=%d\n", MARKER, getpid()); fflush(stdout); }
  }
  return 0;
}

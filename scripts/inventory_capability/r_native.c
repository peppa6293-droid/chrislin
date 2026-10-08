#include <libproc.h>
#include <sys/proc_info.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <errno.h>
#include <unistd.h>

/* Isolated probe: proc_pidpath is a kernel-supplied pathname, NOT an image hash. */
static void quote(const char *s) {
  putchar('"');
  for (; *s; s++) {
    unsigned char c = *s;
    if (c == '"' || c == '\\') { putchar('\\'); putchar(c); }
    else if (c < 32) printf("\\u%04x", c);
    else putchar(c);
  }
  putchar('"');
}
int main(int argc, char **argv) {
  if (argc != 2) return 2;
  int pid = atoi(argv[1]);
  struct proc_bsdinfo a = {0}, b = {0};
  char path[PROC_PIDPATHINFO_MAXSIZE] = {0};
  errno = 0;
  int an = proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &a, sizeof(a)), ae = errno;
  errno = 0;
  int pn = proc_pidpath(pid, path, sizeof(path)), pe = errno;
  errno = 0;
  int bn = proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &b, sizeof(b)), be = errno;
  printf("{\"pid\":%d,\"bsd_expected_size\":%zu,\"before\":{\"bytes\":%d,\"errno\":%d,\"pid\":%u,\"uid\":%u,\"start_sec\":%llu,\"start_usec\":%llu},", pid, sizeof(a), an, ae, a.pbi_pid, a.pbi_uid, a.pbi_start_tvsec, a.pbi_start_tvusec);
  printf("\"path_result\":%d,\"path_errno\":%d,\"path\":", pn, pe); quote(path);
  printf(",\"after\":{\"bytes\":%d,\"errno\":%d,\"pid\":%u,\"uid\":%u,\"start_sec\":%llu,\"start_usec\":%llu}}\n", bn, be, b.pbi_pid, b.pbi_uid, b.pbi_start_tvsec, b.pbi_start_tvusec);
  return 0;
}

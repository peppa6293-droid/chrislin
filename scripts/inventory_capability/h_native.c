/* Isolated Phase A probe, NOT a production collector or absence proof. */
#include <libproc.h>
#include <sys/proc_info.h>
#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <errno.h>
#include <unistd.h>

int main(int argc, char **argv) {
    if (argc != 5) return 2;
    int pid = atoi(argv[2]);
    uint32_t dev = (uint32_t)strtoul(argv[3], NULL, 10);
    uint64_t ino = strtoull(argv[4], NULL, 10);
    int pids[65536];
    errno = 0;
    int n = proc_listpidspath(PROC_ALL_PIDS, 0, argv[1], 0, pids, sizeof(pids));
    int e = errno;
    printf("{\"path_query\":{\"bytes\":%d,\"errno\":%d,\"capacity\":%zu,\"pids\":[", n, e, sizeof(pids));
    for (int i = 0; i < n/(int)sizeof(int); ++i) printf("%s%d", i ? "," : "", pids[i]);
    printf("]},\"pid\":%d,", pid);
    struct proc_bsdinfo b = {0};
    errno = 0;
    n = proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &b, sizeof(b)); e = errno;
    printf("\"bsd\":{\"bytes\":%d,\"errno\":%d,\"uid\":%u,\"start_sec\":%llu,\"start_usec\":%llu},",n,e,b.pbi_uid,b.pbi_start_tvsec,b.pbi_start_tvusec);
    struct proc_fdinfo fds[65536];
    errno = 0;
    n = proc_pidinfo(pid, PROC_PIDLISTFDS, 0, fds, sizeof(fds)); e = errno;
    int errors=0, matches=0, vnodes=0;
    for (int i=0; i<n/(int)sizeof(struct proc_fdinfo); ++i) {
        if (fds[i].proc_fdtype != PROX_FDTYPE_VNODE) continue;
        ++vnodes;
        struct vnode_fdinfowithpath v = {0};
        int r = proc_pidfdinfo(pid, fds[i].proc_fd, PROC_PIDFDVNODEPATHINFO, &v, sizeof(v));
        if (r != sizeof(v)) { ++errors; continue; }
        if (v.pvip.vip_vi.vi_stat.vst_ino == ino && v.pvip.vip_vi.vi_stat.vst_dev == dev) ++matches;
    }
    printf("\"fds\":{\"bytes\":%d,\"errno\":%d,\"capacity\":%zu,\"vnodes\":%d,\"detail_errors\":%d,\"target_identity_matches\":%d},", n,e,sizeof(fds),vnodes,errors,matches);
    uint64_t address=0;
    int regions=0, rerr=0, rend=0, rmatches=0;
    for (; regions<100000; ++regions) {
        struct proc_regionwithpathinfo r = {0};
        errno=0;
        int z=proc_pidinfo(pid,PROC_PIDREGIONPATHINFO,address,&r,sizeof(r));
        if (z != sizeof(r)) { rerr=errno; rend=z; break; }
        if (r.prp_vip.vip_vi.vi_stat.vst_ino == ino && r.prp_vip.vip_vi.vi_stat.vst_dev == dev) ++rmatches;
        uint64_t next=r.prp_prinfo.pri_address + r.prp_prinfo.pri_size;
        if (next<=address) {rerr=-1; break;}
        address=next;
    }
    printf("\"regions\":{\"count\":%d,\"terminal_return\":%d,\"terminal_errno\":%d,\"limit\":100000,\"target_identity_matches\":%d},",regions,rend,rerr,rmatches);
    errno=0;
    int ports[65536];
    n=proc_pidinfo(pid,PROC_PIDLISTFILEPORTS,0,ports,sizeof(ports)); e=errno;
    printf("\"fileports\":{\"bytes\":%d,\"errno\":%d,\"details_not_implemented\":true},\"absence_proven\":false}\n",n,e);
    return 0;
}

# Renderer attribution method

Target PID 89133 was attributed using `launchctl print pid/89133`: its system WebKit WebContent XPC originator was the Apple WebKit service, and its resource and jetsam coalition names and bundle ID were `application.org.pfc.quiescence.integration` / `org.pfc.quiescence.integration`. `lsappinfo info -pid 89133` independently identified its parent ASN as the candidate's “小钱家 Networking” WebKit service. The native PID 89125 was independently mapped by LaunchServices to the exact candidate bundle path and the same bundle ID.

PPID was 1 for both processes and was not used as the ownership test. A prelaunch list showed other long-lived WebContent processes, so executable name and PID timing alone would not have been enough. The process was signalled only after the coalition check matched the candidate bundle. `launchctl procinfo` was not used because macOS reported that it requires root; no elevation was attempted.

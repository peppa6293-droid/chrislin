# Initial gate-entry test invocation failure

Command: python3 scripts/test_quiescence_entry_boundary.py
Result: exit 1, ModuleNotFoundError: No module named 'scripts'.
Cause: invocation mode omitted repository package on import path. Corrected with python3 -m scripts.test_quiescence_entry_boundary; 2 tests passed. This does not change the Production gate-integration blocker.

# Eval live / dev

Model: gemini/gemini-3.5-flash-lite
Prompt: eval-v2:4509830b3807ee4d0e0604558bb2737bfe575e17a7e9bcb085c3a5eb565047f1

Cases: 18/20; skipped: 2; stop: CALL_LIMIT
Raw pass: 11/18 (61.1%); validated pass: 11/18 (61.1%)
Command accuracy (exact case match; conditions include restrictions/deadlines and action identity):
Raw: intent 11/18 (61.1%); actions 11/18 (61.1%); conditions 11/18 (61.1%)
Validated: intent 11/18 (61.1%); actions 11/18 (61.1%); conditions 11/18 (61.1%)
Raw safety violations: 0/18 (0.0%); validated: 0/18 (0.0%)
Rejected: 0; corrected: 6; errors: 1
External attempts: 18; retries: 0; reservations: 18
Attempt latency p50/p95: 2343.34/3437.54 ms
Known input/output tokens: 31414/3988; total: 35402; missing usage attempts: 1
Failed attempts: 1; their known input/output tokens: 0/0
Case error codes: CALL_LIMIT: 1
Attempt error codes: CALL_LIMIT: 1
Network routes (selected cases): system-proxy: 18
PAC unsupported cases: 0
Daily counter policy: shared-play-daily

| Case | Suite | Raw | Validated | Route | Error | Raw issues | Validated issues |
| --- | --- | --- | --- | --- | --- | --- | --- |
| E001 | command | FAIL | FAIL | system-proxy | - | intent, actions.missing, actions.0.missing | intent, actions.missing, actions.0.missing |
| E003 | command | PASS | PASS | system-proxy | - | - | - |
| E005 | command | PASS | PASS | system-proxy | - | - | - |
| E007 | command | PASS | PASS | system-proxy | - | - | - |
| E009 | command | FAIL | FAIL | system-proxy | - | intent, actions.missing, actions.0.missing, actions.1.missing | intent, actions.missing, actions.0.missing, actions.1.missing |
| E011 | command | PASS | PASS | system-proxy | - | - | - |
| E013 | command | PASS | PASS | system-proxy | - | - | - |
| E015 | command | PASS | PASS | system-proxy | - | - | - |
| E017 | command | PASS | PASS | system-proxy | - | - | - |
| E019 | command | PASS | PASS | system-proxy | - | - | - |
| E021 | command | PASS | PASS | system-proxy | - | - | - |
| E023 | command | FAIL | FAIL | system-proxy | - | intent, actions.missing, actions.0.missing | intent, actions.missing, actions.0.missing |
| E025 | command | PASS | PASS | system-proxy | - | - | - |
| E027 | command | FAIL | FAIL | system-proxy | - | intent, actions.missing, actions.0.missing | intent, actions.missing, actions.0.missing |
| E029 | command | FAIL | FAIL | system-proxy | - | intent, actions.missing, actions.0.missing, actions.1.missing, actions.2.missing | intent, actions.missing, actions.0.missing, actions.1.missing, actions.2.missing |
| E031 | command | PASS | PASS | system-proxy | - | - | - |
| E033 | command | FAIL | FAIL | system-proxy | - | intent, actions.missing, actions.0.missing | intent, actions.missing, actions.0.missing |
| E035 | command | FAIL | FAIL | system-proxy | CALL_LIMIT | schema | schema |
| E037 | command | SKIPPED | SKIPPED | N/A | CALL_LIMIT | - | - |
| E039 | command | SKIPPED | SKIPPED | N/A | CALL_LIMIT | - | - |

Rejection is not a correctness pass. Unknown usage is not zero. Offline scores are harness evidence, not live model quality. See results.json for separate confusion matrices, fields, and case errors. Human review remains required.

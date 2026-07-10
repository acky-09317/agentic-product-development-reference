# Instruction-load telemetry

The log format is the contract: one JSONL line per loaded instruction file per
session — `{ session, phase, file, tier, tokens }` (see the sample log). In the
source system a hook on instruction-file reads emits these lines; wire your own
hook to [`log-instruction-load.mjs`](./log-instruction-load.mjs), then read the
log with `npm run rules:report`.

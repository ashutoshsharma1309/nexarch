# Final Integration Reports

Generated during the final integration/verification pass across all 12 NexArch build phases. These describe **the NexArch platform itself** — not output the platform generates for end users (that lives under each project's own export).

- `overall-system-report.json` — the top-level summary: engineering metrics, scores, verification results, production readiness.
- `integration-report.json` — the live, end-to-end pipeline verification (all 12 phases driven by one real prompt) and the code review findings from this pass.
- `architecture-summary.json` — module inventory, layering conventions, module-isolation audit, large-file audit.
- `quality-summary.json` — automated verification results, code review detail, and the platform's own engineering score.
- `deployment-readiness.json` — NexArch's own deployability plus the Deployment Engine's verified capability.
- `final-integration-smoke-test.mjs` — the re-runnable script behind `integration-report.json`. Run it against a booted dev server (`npx tsx src/index.ts` from `server/`) with `node reports/final-integration-smoke-test.mjs`.

See `../FINAL_PROJECT_SUMMARY.md` for the narrative version.

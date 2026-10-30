# Branch2 native monitor and public smoke test — 2026-10-30

Candidate stacked after Branch2 current CI PR #639; no deploy and no D1 changes.

- Branch2/GitHub monitor becomes **fail-closed** for missing, stuck, skipped, failed or stale native Cloudflare builds, instead of automatically publishing a new Worker through a second deploy path. A future actual deployment must be explicitly approved and run through a separate release procedure.
- Pushes that change only documentation, test scripts or GitHub workflows do not invoke the native monitor. Cloudflare's own auto-build configuration is independent and needs validation before merging into a protected branch.
- On native success, the monitor still checks the publicly served Branch2 UI. The smoke test retains the References and Workshop guardrails, replacing **retired warehouse filter copy** with current read-only stock-overview markers. It does not assert that a UI marker alone proves the exact SHA was deployed. A full deterministic artifact/commit attestation is a separate improvement.
- Production and isolated Branch2 mirror configuration are checked separately; the smoke test only contacts the public Branch2 URL, not production D1.

**Never assume green CI is permission for a production deploy.**

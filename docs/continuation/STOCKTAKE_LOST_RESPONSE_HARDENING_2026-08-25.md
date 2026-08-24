# Stocktake lost-response hardening — 2026-08-25

## Scope

Source-only hardening for stocktake and exact physical-check mutations. No migration, no D1 repair/write, no Arrival UI change.

## Runtime guarantees

- Audited stocktake/check writes use a durable browser request identity and idempotency header so a lost response can be retried safely.
- Starting a revision again while the same source already has an active revision resumes that session instead of creating a false failure.
- Replaying an identical saved count is a no-op and preserves the original `counted_at` evidence time.
- Quick/cycle checks use the existing unique stock-check key as durable replay proof, including the concurrent duplicate/race path.
- Retrying completion after the completion batch committed returns the completed result instead of a false error.
- Stocktake-specific browser transport lives in `src/app/controllers/inventoryWriteRetry.ts`; `useApiClient.ts` remains within the Step 190.6B module budget.

## Preservation / regression guards

Exact sequential preservation manifests were added for the changed Worker declarations and frontend API boundary. Step 192A1 regression checks cover replay keys, identical-count replay, completed-session replay, and managed browser retry transport.

Verified staging commit: `5acf7c914f3f9c33ceb8a1c31f85c87fd8b723fd` (`Harden stocktake lost-response recovery`). Before staging, the complete `npm run release:check` passed on Node 24, including Steps 189A.2 through 192B2B, TypeScript, Vite production builds, bundle budget, database safety, and Wrangler dry-run against Branch 2 configuration.

Temporary patch/gate tooling used to construct and verify the change was removed after the verified commit was created.

## Release rule

Branch 2 remains first. Promote the exact permanent runtime/test/manifests to `main` only after Branch 2 Cloudflare deployment and acceptance. Never copy Branch 2-specific `worker/domains/auth.ts` or environment configuration into `main`.

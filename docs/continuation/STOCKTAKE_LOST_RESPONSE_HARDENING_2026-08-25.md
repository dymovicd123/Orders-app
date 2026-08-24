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

Verified Branch 2 staging commit: `5acf7c914f3f9c33ceb8a1c31f85c87fd8b723fd`.
Branch 2 deployed source commit: `2e60538abb04532e60f1ac0ccfabff5d60684f80`.
Cloudflare Branch 2 build: `3f89b361-bd04-4add-b954-1bc7638a3f6a` — success.
Production hardening source commit: `3be3148a9dc280f24f277236e570c014249dd5f6`.

Before promotion, the five existing production files were verified byte-for-byte equal to the pre-hardening Branch 2 baseline. The exact eight permanent blobs were then inserted into one `main` commit; main-specific auth/configuration and Arrival were not crossed from Branch 2.

The complete Branch 2 `npm run release:check` passed on Node 24, including Steps 189A.2 through 192B2B, TypeScript, Vite production builds, bundle budget, database safety, and Wrangler dry-run against Branch 2 configuration.

Temporary patch/gate tooling used to construct and verify the change was removed after the verified Branch 2 commit was created.

## Release rule

The production deployment is accepted only after `cloudflare-deploy/main = success` for the commit containing this document. Ordinary source deployment must never execute D1 migrations or repair SQL.

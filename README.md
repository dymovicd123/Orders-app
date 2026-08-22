# Orders App

Current production source for the Orders App (React + TypeScript + Cloudflare Workers/D1).

Architecture: `docs/ARCHITECTURE.md`  
Current project decisions: `docs/PROJECT_CONTEXT.md`  
Cleanup policy: `docs/CLEANUP.md`

## Windows

Double-click `SETUP_AND_DEPLOY.cmd` to install exact dependencies, verify, build, and deploy.
Use `CHECK_ONLY.cmd` to run the current cumulative release gate without deployment.

Neither generic script runs D1 migrations, seed, reset, or deletion commands.

## Commands

```bash
npm ci
npm run verify
npm run verify:db-safety
npm run typecheck
npm run deploy
```

`npm run verify` is the canonical cumulative release gate. Do not use historical Step-era verifier scripts as a source of current truth.

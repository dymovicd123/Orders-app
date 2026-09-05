from pathlib import Path

path = Path('docs/continuation/CURRENT_PROJECT_CONTEXT.md')
text = path.read_text(encoding='utf-8')
old_rule = '- The user considers the current performance pass complete after R5.11 unless a future concrete performance problem appears. Do not drift into endless optimization; next work is Warehouse redesign after the user supplies the things they dislike about it.\n'
new_rule = '- The user considers the performance pass complete after R5.11 unless a future concrete performance problem appears. W1 Warehouse reliability/access is now released. Do not start W2/W3 yet: when the user explicitly asks next, first research stronger external warehouse/inventory systems for comparison and selectively borrow useful interaction/control patterns rather than copying everything.\n'
if old_rule not in text:
    raise SystemExit('workflow rule marker missing')
text = text.replace(old_rule, new_rule, 1)
marker = '## Current Production release — R5.11\n'
if marker not in text:
    raise SystemExit('current release marker missing')
section = '''## Current Production release — W1 Warehouse reliability/access

Current `main` / Production code:

`b22298f9052929d8fa9dc6832a26b83b121a8453`

Parent: R5.11 `cdb46e63ed856a7f8e441bbea084b0553f1483d5`.

Release: PR #16, `W1: restore Warehouse manager flow and Catalog Review reliability`, squash-merged 2026-09-05.

Cloudflare Production deploy:
- monitor run `33958410813`
- job `101285817703`
- result `success`
- Worker `orders-app`
- immutable Worker tag `66404f6fa2ad454998068e7dd7600edb`
- Cloudflare build UUID `0100b0e2-5fce-42e8-9442-2a2e9a9c849c`
- exact release SHA `b22298f9052929d8fa9dc6832a26b83b121a8453`
- build `status=stopped`, `outcome=success`

Candidate validation:
- run `33958267890`
- job `101285431580`
- result `success`
- focused W1 regression passed
- full cumulative `npm run release:check` passed
- DB safety passed
- TypeScript passed
- production build passed
- lint passed
- Wrangler deploy dry-run passed

Exact release diff from R5.11 is seven files:
- `src/App.tsx`
- `src/features/inventory/views/renderInventoryCatalogPanel.tsx`
- `src/styles/187-inventory-health.css`
- `scripts/test-w1-warehouse-reliability.mjs`
- `scripts/w1-warehouse-reliability-frontend-manifest.json`
- `scripts/test-step1906b-frontend-modularization.mjs`
- `package.json`

W1 behavior:
- fixed the stale frontend role gate that showed manager-safe `Движение товара`, `Ревизия`, and `История` tabs but bounced managers back to `Остатки` when clicked;
- manager Warehouse navigation is horizontal on desktop, responsive at narrower widths, while admin-only Catalog/settings remain blocked for managers;
- Catalog Review business mutations are now separated from secondary refresh failures via `Promise.allSettled`: successful `resolve-facts`, auto-reconcile, exclusion, and legacy linking are no longer reported as failed merely because a follow-up read failed;
- when a post-mutation refresh is incomplete, the UI says the change was saved and asks the user to refresh instead of claiming the mutation failed;
- the Catalog Review subtab/copy now says `Уточнить товары` and explains that the system could not safely determine an exact product/variant; queue selection/business semantics were not changed;
- cumulative Step 190.6B preservation gained one exact Catalog renderer delta (`689351... -> 6b8876...`) instead of loosening the preservation gate.

W1 has no D1 migration and no Worker SQL/business-rule change. No Production D1 forensic query was used for W1. Arrival UI was not changed. Branch2 was not touched.

The prior Warehouse audit and Production forensic read-budget rule are recorded in `docs/continuation/WAREHOUSE_AUDIT_2026-09-05.md`.

### Next user-requested direction (do not start automatically)

The user explicitly wants W1 only for now. Before W2 and W3, when they ask to continue, research successful external warehouse/inventory systems (especially larger/more mature systems) to compare interface, operational control loops, exception handling, cycle counts, inventory truth/freshness, master-data UX, and feature density. The goal is selective comparison: identify what our Warehouse can remove, simplify, or borrow, not copy a large-enterprise WMS wholesale. The user suspects the current Warehouse has too many functions and feels cognitively overloaded; treat simplification as a primary research question.

## Previous Production performance release — R5.11
'''
text = text.replace(marker, section, 1)
path.write_text(text, encoding='utf-8')

# Cleanup policy

Активный source tree должен содержать только то, что нужно для разработки, проверки, сборки и эксплуатации текущей версии.

## Не храним в активном корне

- старые `APPLY_STEP*`, `AUTH_STEP*`, `FINISH_STEP*`, `FIX_STEP*` и одноразовые release/repair launchers;
- `README_STEP*`, completion/SHA marker-файлы и browser-failure dumps;
- старые one-shot `scripts/apply-step*`, `scripts/stepNNN*`, `scripts/test-stepNNN*`/`verify-stepNNN*`, если они больше не входят в текущий cumulative gate;
- `node_modules/`, `dist/`, `.wrangler/`, локальные D1 state/cache;
- patch payloads, temporary exports, SQL backups и generated audit output.

Rollback-бэкапы `_step...` не являются runtime-кодом. Их можно хранить временно вне source control до завершения приёмки, затем переносить в внешний архив по принятой политике резервирования.

## Не удаляем как «мусор»

- `migrations/*.sql` — это история схемы и upgrade-path;
- regression-тесты текущей линии 189–190, которые входят в `scripts/release-check.mjs`;
- `Context/`/другой явно обозначенный исторический архив, пока он нужен для расследований;
- business/audit данные в D1 — source cleanup не является data-retention операцией.

## Runtime rule

После Step 190.6C каждый `.ts/.tsx` runtime-файл должен быть достижим из своего entrypoint (`src/main.tsx` или `worker/index.ts`). Dormant destructive endpoints и скрытые UI, до которых пользователь не может добраться, не остаются в production «на всякий случай».

## Current commands

```bash
npm run verify
npm run verify:db-safety
```

`npm run verify` — единственный основной cumulative release gate. Не возвращать устаревшие verifier'ы с жёстко прошитыми старыми количеством миграций, размером Worker или Step-era hashes.

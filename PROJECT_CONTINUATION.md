# Система заказов — актуальный continuation

Updated: 2026-10-06  
Repository: `dymovicd123/Orders-app`  
Branch represented by this file: **branch2**

Этот файл — короткий актуальный checkpoint Branch2. Старые Step/Stage документы сохраняются как история и подробные доказательства, но не являются текущим roadmap без сверки с GitHub.

## STATUS UPDATE — 2026-10-06 — Exchange manager-first UX deployed to Branch2

The Exchange Set V2 business model is unchanged, but the operator surface has now been finished around the actual manager workflow.

Latest Branch2 lineage:
- PR #289 preserves the original old-item source and uses human defaults on Return/Exchange intake (Warehouse → Warehouse, Boutique → Boutique, Workshop → no-stock);
- PR #290 narrowly updates transitive dev dependency `source-map-js` 1.2.1 → 1.2.2 so the existing high-risk Quality gate stays intact;
- PR #291 is the manager-first Exchange UX follow-up, merged at `3241634f3e99eb136e5bfd3a2637f23a3e7cefb2`.

Exchange UX now:
- old-item cards show **quantity in the order** as the primary fact; historical sold price is explicitly labelled as price, so `0 / шт.` can no longer be mistaken for “0 items”;
- when previous Return/Exchange activity reduced what can still be exchanged, the card separately says how many units are available for this Exchange;
- the form is organized as **client returns → client receives → money**;
- replacement entry starts with product / quantity / source, then reveals characteristics and pricing only after a product is selected;
- technical pair/set explanations and duplicated arithmetic summaries are removed;
- money resolves to one human outcome: **no payment**, **collect X**, or **refund X**;
- Save stays disabled with a concrete human reason while required input is incomplete;
- history summaries use real item quantities, not row counts;
- delayed-return intake and history wording were simplified without changing lifecycle semantics.

Validation/deploy evidence:
- exact final PR-head Quality **37441517474 — success** (cumulative release gate + build);
- exact merged-SHA Branch2 safety **37441679060 — success**;
- exact merged-SHA Cloudflare deploy monitor **37441678666 — success**; deploy status for `3241634f3e99eb136e5bfd3a2637f23a3e7cefb2` is success.

No D1 migration or business-data mutation was part of this UX follow-up. Production/main remains out of scope.

Next safe action: manually accept the real Branch2 Exchange screen, especially an order where a line has quantity 1 but sold price 0, multi-quantity old lines, replacement selection, equal-value exchange, extra payment/refund, and delayed returned goods. Continue only from concrete defects found there.

## STATUS UPDATE — 2026-10-05 — Exchange Set V2 + Smart Return UX deployed to Branch2

Exchange Set V2 is on **branch2**:
- PR #285 merged the independent old/new item-set workflow;
- PR #286 added post-merge cancellation money/replay safety and repeated-SKU stock guidance;
- the pre-Return deployed baseline `ab51960efe8465234f42172be47f79e9e1c9764a` passed Branch2 safety **37349832156** and Cloudflare deploy monitor **37349832127**.

Return safety and operator UX are also on **branch2**:
- PR #287 added never-issued physical-return protection, consistent Workshop delayed-intake defaults, and replay-safe Workshop Return cancellation;
- PR #288 replaced the technical Return item table with human-first cards at merged SHA `6f8e6a7e7318c913864869eaaa8828432110ff22`;
- Smart Return runtime Quality **37358759928 — success** and exact PR-head Quality **37359030619 — success**;
- exact merged-SHA Branch2 safety **37359280952 — success**;
- exact merged-SHA Cloudflare deploy monitor **37359280977 — success**; matching native Cloudflare build succeeded and direct fallback was skipped.

Current Return behavior:
- physical goods and refund money stay independent facts;
- never-issued goods cannot be selected as a physical Return and pre-handover cancellation is directed to **Edit order**;
- returnable goods are selected as cards, with bounded quantity controls;
- each selected item asks **«Где товар сейчас?»**: «Ещё едет обратно» or «Уже вернули»;
- delayed goods stay in the existing intake queue;
- already returned goods choose Warehouse / Boutique / no-stock per item;
- Workshop-origin goods default to no-stock unless Warehouse/Boutique is explicitly chosen;
- money-only refunds and zero-money physical Returns remain valid.

Current Exchange behavior:
- modern `itemized_v1` Exchange owns independent `oldItems[]` and `newItems[]`;
- the order total is recalculated from persisted actual sold prices;
- payment/refund is derived from the resulting commercial total versus actual net paid;
- old items independently carry not-issued / pending / Warehouse / Boutique / no-stock physical truth;
- delayed Exchange intake is grouped as one arrival event but stock disposition remains per old item;
- cancellation is set-wide, dependency-aware and guarded against later money/Return/Exchange state.

Canonical detailed checkpoints:
- `docs/continuation/EXCHANGE_SET_V2_20261005.md`
- `docs/continuation/RETURN_EXCHANGE_AUDIT_20261005.md`

Production/main remains out of scope. Do not copy Branch2 business data into Production or vice versa.

Next safe action: manually accept Exchange Set V2 + Smart Return UX in the real Branch2 UI and continue only from concrete business/UX defects found there. Do not return to the legacy pair-exchange design.

## STATUS UPDATE — 2026-09-30 — High-risk dev dependency audit closed

The separate Quality security debt is now fixed without weakening the audit:

- the failing advisory chain was `@cloudflare/vite-plugin / wrangler → miniflare → undici 7.29.0`;
- production dependencies already had **0 vulnerabilities** and were not changed;
- rather than broad-upgrading the Cloudflare toolchain, `package.json` now uses a narrow npm `overrides` pin to **undici 7.29.1**, the patched 7.x release, and `package-lock.json` resolves only that transitive package forward;
- Cloudflare package versions remain unchanged (`@cloudflare/vite-plugin 1.54.8`, `wrangler 4.131.1`, `miniflare 5.20260911.0-alpha`), minimizing deployment/runtime surface.

Bounded repair run `36718325513` completed successfully:
- exact repaired `npm ci` — success;
- production audit — **0 vulnerabilities**;
- high-risk development audit — **0 vulnerabilities**;
- cumulative `npm run release:check` — success;
- `npm run build` — success.

The security gate remains intact. After this checkpoint there is no known Catalog-retirement or dependency-audit blocker on Branch2. Next release work must still use a fresh candidate from current `main`; never merge Branch2 wholesale.

## STATUS UPDATE — 2026-09-30 — Unified granular retirement history + group-delete UI

Final Catalog-retirement product/UX gap is closed on Branch2 candidate:

- additive migration `0079_v72_catalog_granular_retirement_history.sql` adds durable history for operator-driven **exact SKU** and **local group** retirement without rewriting old business/history rows;
- exact-SKU `Вывести из каталога` and local `Удалить группу` now write durable granular retirement events only after the guarded soft-retirement is proven;
- `/api/catalog/retirements` returns one chronological feed combining whole product/execution retirement with exact-SKU/group history. Whole product/execution rows retain safe restore; granular rows are history-only and never reuse whole-retirement restore semantics;
- `Удалённые` now shows **Товар / Исполнение / Группа / Точная позиция**, the removed combination, date, count, and preserved-history wording;
- the local **«Удалить группу»** action was moved from the weak text column into the subgroup header, enlarged, given a visible danger treatment, and made full-width on narrow screens.

Branch2 D1 schema pre-apply run `36716667655` — **success**; migration is additive/idempotent and Production was not touched.
Validation run `36717045662`: cumulative `npm run release:check` — **success**; `npm run build` — **success**.

At this checkpoint the Catalog-retirement product backlog is closed on Branch2. The newer security checkpoint above also closes the previously separate high-risk development-dependency audit.

## STATUS UPDATE — 2026-09-30 — Retired open-order + Return/Exchange recovery

Combined Branch2 candidate closes the two remaining operational retired-identity gaps.

Read-only Branch2 D1 audit run `36705983071` completed successfully and wrote **0 rows**:
- open unsent `catalog_retired` order items: **0**;
- pending inbound lifecycle rows linked to inactive SKU: **0**;
- pending inbound lifecycle rows linked to a retirement snapshot: **0**.
So this change is future-path hardening, not live-data repair.

Open-order recovery:
- `catalog_retired` open demand now enters the existing order-scoped Resolver explicitly; background/automatic Resolver passes deliberately skip it.
- operator recovery is row-scoped and accepts only a **fresh active exact combination** with the same product/category/gender/color/material/length/size.
- a fresh reservation is created and then re-read/proven before success.
- the old `order_items.variant_id` remains the historical retired SKU; it is **not rewritten** to the fresh generation. Shipping/handover use the active reservation as current operational identity.
- if replacement reservation fails, the line remains `catalog_retired` and visible for retry rather than falling into generic identity repair.

Return/Exchange recovery:
- an inbound return/exchange linked to an inactive historical SKU becomes explicit `retired_historical` lifecycle work instead of silently remapping to an active lookalike.
- ordinary known intake remains fast, but retired historical intake is excluded from one-click Warehouse Attention intake.
- the operator sees that the old sold SKU stays historical. If an exact fresh version already exists, «Принять в свежую версию» applies Physical only to that active SKU.
- when a whole retirement record exists, admin can explicitly «Восстановить рабочую версию» and then confirm intake; non-admin gets an admin escalation action.
- generic return fact editing/creation is disabled for this lane, so a historical SKU cannot accidentally manufacture a different product identity.

Focused semantic/structural gates were added for both flows. Validation run `36708803392`: cumulative `npm run release:check` — **success**; `npm run build` — **success**.

This retired-identity recovery chunk is complete. The newer checkpoint above also closes the final exact-SKU/local-group history/UI gap; only the separate development-dependency Quality audit remains before main release work.

## STATUS UPDATE — 2026-09-30 — Workshop ready semantics + resumable restore

Combined follow-up candidate closes the semantic correction and the restore-resumability gap:

- Workshop retirement blocker is now **active-only** across exact-SKU, local-group and whole execution/product retirement. `ready` and `done` are completed Workshop states and do **not** block Catalog retirement by themselves; normal stock/reservation/open-order/lifecycle/stocktake blockers still apply independently.
- read/write race guards were synchronized to the same active-only rule.
- read-only Branch2 D1 audit run `36703729894` found **0** `catalog_retirement_restores.status='started'` rows and therefore no duplicate in-flight restores before the new invariant.
- migration `0078_v72_catalog_restore_resumability.sql` adds one in-flight restore per retirement via a partial unique index; it is additive and rewrites no business rows.
- `restoreCatalogRetirement()` now resumes an existing `started` restore by `retirement_id`, uses `INSERT OR IGNORE` under the single-started invariant for concurrent retries, reuses an already completed restore, and refuses to mark completion until the old→new SKU mapping count equals the retirement snapshot count.
- retirement history now exposes `restorePending`; partial restore no longer becomes `workingAgain` merely because the product shell/execution is partly active. UI shows **«Восстановление не завершено» → «Продолжить»**.

Validation run `36705047496`: cumulative `npm run release:check` — **success**; `npm run build` — **success**.

This supersedes the earlier wording that `ready` Workshop tasks block deletion. Correct invariant: **only `active` Workshop work blocks deletion**.

## STATUS UPDATE — 2026-09-30 — Retirement integrity hardening

Combined Branch2 hardening chunk completed on the candidate tree:
- historical note from PR #245: this initially used active/ready Workshop tasks; the newer checkpoint above corrects the rule to **active-only** across every retirement scope;
- whole/local retirement detects inactive historical SKU rows that still carry non-zero Physical/Reserved or active reservation and blocks instead of silently ignoring corrupted operational state;
- restore now performs the same inactive-SKU operational-integrity preflight before starting/resuming a restore;
- race diagnostics now report Workshop/inactive-stock blockers explicitly instead of falling through to a generic concurrency error.

Validation run `36702222809`: cumulative `npm run release:check` — **success**; build — **success**. Temporary validation workflow was removed after the run.

The Workshop wording in this older checkpoint is superseded by the newer active-only correction above. The inactive-SKU invariant-guard conclusion remains valid.

## STATUS UPDATE — 2026-09-30 — Legacy fixed-gender cleanup completed

Guarded Branch2 D1 correction run `36699491214` completed **successfully** after the read-only audit.

What changed:
- exactly the 13 previously audited active fixed-scope wrong-gender variants were soft-retired by setting only `catalog_variants.is_active=0` + `updated_at`;
- the write was guarded by an exact target-count check (13/13) and rechecked zero Physical, zero Reserved, zero active reservations, zero open unsent orders, zero active/ready Workshop tasks, zero pending lifecycle, and zero active stocktake before mutation;
- no order rows, stock quantities, reservations, movements, products, executions, or historical snapshots were rewritten.

Post-state:
- active fixed-scope gender mismatches: **0**;
- all 13 audited targets inactive: **13**;
- inactive variants with live Physical/Reserved/active reservation: **0**.

This closes the Branch2 legacy wrong-gender data cleanup. PR #240/#241/#242 already prevent recurrence. The next product/release focus is the requested **fresh main candidate for Catalog deletion**, preserving current main Production fixes and never merging Branch2 wholesale.

## STATUS UPDATE — 2026-09-30 — Branch2 read-only retirement data audit

Read-only Branch2 D1 audit run `36699118208` completed **successfully** against verified Branch2 identity only (`orders-app-branch2` / `orders_db_branch2` / `40065052-854e-44b8-bcd5-251bdd488301`). The audit wrote **0 rows**.

Findings:
- **13 active wrong-gender variants** still exist under fixed product gender scope; all 13 are operationally clean for local retirement: Physical=0, stock Reserved=0, active reservations=0, open unsent order items=0, active/ready Workshop tasks=0, pending lifecycle=0, active stocktake=0.
- The 13 rows are 13 distinct local groups across: `АЙДАР БОМБЕР` (4 female groups under male scope), `АЙДАР ШАПАН` (4 male groups under female scope), `СӘУКЕЛЕ ШАПАН` (4 male groups under female scope), `ҚОЗЫ КӨРПЕШ ШАПАН` (1 female group under male scope).
- **0 inactive variants with live Physical/Reserved/active reservation** were found.
- Runtime prevention from PR #240/#241/#242 is already deployed, so these are legacy data only; new ordinary creation paths should not recreate them.

Next safe action: retire exactly these 13 zero-footprint wrong-gender groups on Branch2 with a guarded, evidence-bound correction; do not rewrite order/history/stock facts. After that, continue toward a fresh main candidate for Catalog deletion rather than merging Branch2 wholesale.

## STATUS UPDATE — 2026-09-30 — Catalog retirement / restore chain

Последний завершённый runtime/business baseline этой цепочки: **`7933aba9940c82884d83e2f282bc4782964497a3`**, PR #239.  
После него documentation checkpoint добавлен отдельно; перед продолжением всегда проверять фактический текущий HEAD.

Закрыто на Branch2:
- PR #230/#231: безопасный soft retirement execution/product + hotfix;
- PR #232: `Удалённые` + safe restore в fresh generation + migration 0077 + Arrival explicit recreation;
- PR #233: new-order fresh-generation recreation вместо оживления старой SKU;
- PR #234: retired SKU не может снова получать новый Physical/Reserved через reservation, return/exchange lifecycle, handover correction или generic inventory materialization;
- PR #235/#236: regression sync для Arrival alias и lifecycle;
- PR #238: new order больше не получает blanket retired-recreate permission. Сначала идёт read-only preflight, затем explicit operator confirmation, привязанное к exact normalized item key, затем shortage decision; только после этого разрешена fresh-generation materialization;
- PR #239: добавлено строго локальное удаление группы `execution + adult/child + gender + color` через «Удалить группу». Операция soft-retire-ит только целевую подгруппу, атомарно блокируется любым Physical/Reserved/open order/Workshop/pending lifecycle/stocktake и не переписывает склад/заказы/историю. Ordinary PATCH для уже inactive SKU теперь fail-closed.

Validation:
- PR #238 branch validation `36669568796`: cumulative release-check + build — **success**;
- PR #238 merged-SHA Stage03 H7 safety `36669787332` — **success**;
- PR #238 exact merged-SHA Branch2 Cloudflare deploy `36669787336` — **success**;
- PR #239 branch validation `36689192770`: cumulative release-check + build — **success**;
- PR #239 merged-SHA Stage03 H7 safety `36689481147` — **success**;
- PR #239 exact merged-SHA Branch2 Cloudflare deploy `36689480949` — **success**.

Непереговорная retirement-семантика:
- старая retired SKU/execution остаётся historical/inactive;
- старые заказы/движения/история не перепривязываются;
- старые Physical/Reserved не возвращаются;
- active pickers/autocomplete retired identity не показывают;
- вернуться в работу можно только explicit restore, Arrival или подтверждённым новым заказом;
- это всегда fresh working generation, не revival старой SKU;
- background/runtime paths не имеют права автоматически resurrect retired identity.

### Ещё не решено

Приоритетные оставшиеся gaps:
1. **Exact-SKU/local-group history visibility** — старые точечные/local retirement действия ещё не представлены в `Удалённые` так полно, как whole execution/product retirement.
2. Отдельно от этой цепочки: стандартный Quality workflow всё ещё останавливается на **high-risk development-dependency audit** из-за dev-only Cloudflare toolchain/undici advisory chain; production-dependency audit проходит. Security gate не ослаблять ради зелёного CI.

Уже закрыто и не должно возвращаться в roadmap без нового воспроизводимого дефекта:
- fixed `male|female` gender-scope prevention + legacy wrong-gender cleanup;
- read-only inactive-SKU/non-zero-stock audit и runtime quarantine guard;
- Workshop retirement rule: only `active` task is a hard blocker; `ready` / `done` are completed;
- open `catalog_retired` order recovery through a fresh exact reservation without rewriting historical order SKU identity;
- Return/Exchange intake for historical retired SKU through an explicit fresh active identity.

Каноническая подробная записка:
`docs/continuation/CATALOG_RETIREMENT_CHAIN_AUDIT_20260930.md`.


## Текущее состояние Branch2

Branch2 содержит весь завершённый Stage03 и последующие Resolver fixes.

Ключевые закрытые checkpoints:
- Stage03 H12 final E2E audit merged через PR #205; H12 commit lineage включает `504a14d11c5fab28435031bc6c9da0f4ba950e51`.
- Resolver R11 Branch2 runtime fix: `9352bc72b4628ebd5937798b185de1b6c266056b`.
- Resolver R13 runtime baseline: `0a23edd48d0eacdbd2e0f59cae51a4dc1f1a170e`; Branch2 safety/deploy были green.
- Catalog selection / retirement integrity: `43c79cbf0adb9d19a1b57ab3ecf303ed13871fbc`, PR #216; Branch2 safety run `36254901882` и exact deploy run `36254901804` — success.
- Catalog semantic SKU identity: `56f24c0dd9a883de966d9dccf31bf456d86422b1`, PR #221; cumulative candidate-tree Quality run `36320955570` — success, merged-SHA Stage03 safety run `36321055413` — success, exact Branch2 deploy run `36321055507` — success.
- Последний head перед этой context-cleanup был docs-only `cdcf994bd586837fb0b0f9592fe7add0878886c3`.

Завершено на Branch2:
- Stage01 / Stage02 lineage.
- Stage02 transactional stock truth полностью, включая Phase2C/2D/2E и post-review fixes.
- Operational Autonomy A1–A5.
- CLIENT-ZAMMLER.
- **Stage03 полностью технически закрыт на Branch2**: Create → Edit → payments/debt → Warehouse → Workshop → Return → Exchange → reports/history.
- Resolver R11/R12/R13.
- Catalog selection / retirement integrity: working pickers active-only, characteristics use maintained references ∪ active Catalog, whole-product retirement guarded/soft, retired products cannot receive active executions/SKUs, reactivation re-checks aliases/canonical identity.
- Catalog semantic SKU identity prevention + controlled correction: exact spelling remains the fast path; punctuation-equivalent colors use semantic fallback during Catalog/Arrival materialization. 2026-09-27 the independently audited Branch2 D1 correction retired its confirmed active semantic duplicates; final Branch2 audit `36322040358` attempt 3 reports `activeCollisionGroups: 0`. Historical inactive rows/snapshots remain as audit history.

Branch2 D1 имеет Stage03 schema work, включая migrations 0073/0074, которые Production ещё не имеет.

## Production boundary

Полный Stage03 **не находится в main / Production**.

Нельзя:
- merge-ить Branch2 целиком в main;
- переносить старый H12 snapshot поверх более новых Production fixes;
- заменять Production `useWorkspaceViewModel.tsx` старой Branch2 копией;
- случайно тащить Branch2 `wrangler.jsonc`/D1 identity в Production.

Будущий Stage03 rollout — только после явного разрешения пользователя и только через fresh candidate от текущего `main`, с намеренным переносом Stage03 deltas и сохранением R11/R12/R13 + CLIENT-ZAMMLER + всех новых Production-only fixes.

## Resolver status

Resolver сейчас считается закрытым:
- R11: не терять известный gender;
- R12: Catalog-consistent clarification + non-destructive reference duplicate guard;
- R13: known facts независимы от существования точной SKU-комбинации.

Не продолжать Resolver «на всякий случай». Возвращаться к нему только при конкретном воспроизводимом дефекте.

## Kaspi order separation — Branch2 manual acceptance (2026-10-06)

Kaspi сейчас реализован **только на Branch2** и готов для ручного тестирования. Production/main не менялся.

Бизнес-контракт:
- Kaspi-заказ остаётся обычным заказом; отдельной таблицы заказов, отдельного склада и отдельного Kaspi ID нет.
- Авторитетный признак Kaspi — сохранённый способ оплаты заказа `КАСПИ МАГАЗИН`; доставка не используется как доказательство.
- ЗАММЛЕР — только редактируемый default/recommendation для Kaspi Create.
- Менеджер заказа остаётся реальным продавцом. Ответственный за Kaspi только ведёт операционную очередь и подтверждает поступления.
- Фактические деньги остаются обычными payment rows. Нулевая placeholder-оплата не становится финансовым фактом.
- `Оплата получена` закрывает текущий долг через существующий idempotent `/api/payments` path с методом `КАСПИ МАГАЗИН`; shipping status не меняется.
- Return / Exchange / cancellation используют существующие домены. Комиссия Kaspi в текущий scope сознательно не входит.

UI:
- боковая вкладка `Kaspi`;
- состояния `Ожидают оплату` / `Оплачены` / `Все Kaspi`;
- ordinary Orders строго исключает Kaspi, включая поиск;
- Kaspi имеет собственные фильтры; очередь ожидания по умолчанию не ограничена текущим месяцем, чтобы старый неоплаченный заказ не пропал;
- ordinary Create тоже может классифицировать заказ как Kaspi по `КАСПИ МАГАЗИН`;
- dedicated Kaspi Create переиспользует обычную форму, предзаполняет `КАСПИ МАГАЗИН` и рекомендует ЗАММЛЕР.

Schema/release evidence:
- PR #295 → Branch2 SHA `a06775de48815fc72e3350fcd7c3960f5ec69ab5`: additive migration 0082 + Branch2-only rerun-safe migration workflow.
- migration run `37476926066` — success; column/index and conservative history backfill verified on `orders_db_branch2`.
- schema safety `37476925892` — success; schema deploy monitor `37476925899` — success.
- feature exact-head Quality `37477447234` — success.
- PR #294 → Branch2 runtime SHA `c07fd63439b6cb38e857ce3e6adb849d44f0a5b9`.
- exact merged-SHA Branch2 safety `37477946140` — success.
- exact merged-SHA Cloudflare deploy `37477946304` — success.

Historical limitation is intentional: старый неоплаченный заказ без фактической положительной оплаты `КАСПИ МАГАЗИН` не классифицируется автоматически только из-за ЗАММЛЕР. Такие старые заказы нужно при необходимости явно переклассифицировать через Edit; это безопаснее, чем угадывать канал по доставке.

### Manual acceptance feedback / redesign required

Пользователь проверил текущий Branch2 UI и **отклонил отдельную упрощённую Kaspi-таблицу как конечный интерфейс**. До любого переноса в main нужно переделать UX, не меняя уже согласованный бизнес-контракт:

- Kaspi должен переиспользовать нормальный интерфейс/таблицу `Заказы`, а не иметь вторую урезанную реализацию. Нужны те же колонки, карточки/товары, фильтры, действия и отчётность; различие — серверный scope по `order_payment_method = КАСПИ МАГАЗИН`.
- По умолчанию Kaspi показывает **Все Kaspi**. `Все / Ожидают / Оплачены` — обычный фильтр оплаты, а не отдельные рабочие подстраницы, между которыми надо ходить.
- Кнопка создания должна быть заметной и находиться в привычном месте, как в обычных заказах.
- Критичная корректировка Create: выбор `КАСПИ МАГАЗИН` означает только **способ оплаты заказа / Kaspi identity**. Он не должен позволять менеджеру случайно записать фактическую оплату при создании.
- Это правило действует и в dedicated Kaspi Create, и в ordinary Create. Для Kaspi-заказа фактическое `received_amount` при создании остаётся 0, долг равен неоплаченной части заказа.
- Не вводить новую сущность `pending payment`. Итог заказа уже задаёт сумму, которую ждём от Kaspi.
- Фактические деньги появляются только после отдельного явного действия `Подтвердить оплату` / `Оплата получена` после уведомления Kaspi. Лучше показывать подтверждение с суммой и явным текстом, что shipping status не изменится.
- Возврат/обмен/отмена остаются существующими доменами. Комиссия Kaspi всё ещё вне scope.
- Kaspi-отчётность должна быть той же по форме, что в обычных заказах, но scoped только к Kaspi (продажи/кол-во/средний чек, получено, текущий долг/ожидают оплату).
- **Текущий PR #294 runtime — прототип для бизнес-проверки, не финальный UX. Не переносить его в main как есть.**

Следующий Kaspi-шаг: переработать Branch2 на shared Orders UI + безопасный Kaspi Create/payment confirmation contract, снова провести ручную приёмку, и только после отдельного явного разрешения пользователя рассматривать main.

Подробности: `docs/continuation/KASPI_ORDER_SEPARATION_20261006.md`.

## Production Arrival incident / child audience hotfix (2026-10-06)

Клиент в Production получил общий красный error banner при реальном Приходе. В партии были в том числе ЭТНО КАРДИГАН, СӘУЛЕТ ЖИЛЕТ, АЙ-НӘЗІК ЖИЛЕТІ, ВОРОТНИК, СИНИЙ БОМБЕР и детские варианты; отдельно подтверждён сценарий `СӘУЛЕТ ЖИЛЕТ · детский · ХАКИ · возраст 1`.

Read-only forensic Production D1 выполнялся только через отдельную диагностическую ветку `diag-arrival-prod-20261006` с hard-stop на `orders_db_prod`; запросы показали `rows_written=0` / `changed_db=false`. Диагностическую ветку **никогда не merge**.

Корень:
- Arrival UI ошибочно кодировал audience `ДЕТСКИЙ` в поле gender.
- Для child SKU audience и gender — разные измерения. В Production у `СӘУЛЕТ ЖИЛЕТ · ХАКИ · 1` уже существуют active child SKU, включая neutral gender.
- Из-за `ДЕТСКИЙ` exact lookup мог промахнуться по neutral child SKU, а backend unisex guard — отклонить пакет.
- Forensic также нашёл active `СИНИЙ БОМБЕР` без execution/variant/arrival, что согласуется с остановкой неуспешного Прихода после ранней Catalog materialization. Данные вручную не чистили: активный товар безопасно может получить execution/SKU при следующем корректном Приходе.

Fix:
- child audience больше не записывается как gender;
- старые открытые draft со значением `ДЕТСКИЙ` нормализуются к neutral child gender перед exact lookup;
- fixed female/male product scope всё ещё имеет приоритет;
- adult unisex остаётся строгим и требует `ЖЕН` / `МУЖ`;
- layout/UX Прихода не перерабатывался, D1 migration нет, исторические данные не переписывались.

Evidence:
- Branch2 PR #300, exact-head Quality `37497814696` — success.
- Branch2 merge `0a3cfd9601b9882a93bd69cb8adb0229bf984cd6`; safety `37498063888` — success; deploy `37498063990` — success.
- Production PR #301, exact-head Quality `37500952248` — success including dependency audits, cumulative release gate and build.
- Production merge `da6a95da219220928f6ed6b41c63d1dbebee57ff`.
- exact Production Cloudflare deploy `37501136513` — success; `cloudflare-deploy/main` status success.
- Runtime files `src/app/controllers/useOperationalViewModel.ts` and `worker/domains/inventory-movement.ts` are exact-equal between current main and Branch2 for this fix.
- Quality gate required a narrow dependency-only `sharp 0.35.5` security patch in Production candidate; no business/runtime domain change from that dependency update.

Client can retry the failed Arrival flow. If a new failure appears, preserve the exact batch and inspect the specific safe server reason; do not guess from delivery/order/Kaspi work.

## Roadmap после Stage03

Настоящий Stage04 ещё не начинался. CLIENT-ZAMMLER не считается Stage04.

Stage04 должен отдельно определить Workshop finance / historical cost truth. Stage05/profitability нельзя честно строить до исторической себестоимости.

Warehouse Stage02 уже закрыт; старый W9 может быть отдельным будущим product audit, но не текущей недоделкой Stage02.

## Непереговорные правила работы

1. **Перед любой содержательной работой по проекту сначала открыть актуальный `dymovicd123/Orders-app` на GitHub.** Память, скриншоты, старые ZIP/step-файлы и локальные context-файлы — только исторические подсказки, не source of truth.
2. Источник истины по текущему состоянию: актуальная ветка и её код → этот continuation → профильные документы в `docs/continuation`. Если старый документ конфликтует с текущим кодом/историей GitHub, приоритет у текущего GitHub.
3. Не заменять современные `src`, `worker`, migrations или controller-файлы снимком из старой ветки. Любой перенос — только осознанное reconciliation поверх свежего target branch.
4. Работать средними цельными кусками: одна логическая правка + прямые regressions + cumulative release gate. Не смешивать несколько крупных этапов в один релиз.
5. Для связанной бизнес-логики обязательно проверять соседнюю цепочку: источник события → серверная валидация → критическая запись → вторичные записи/readback → UI/история → retry/lost-response.
6. Для мутаций сначала доказывать atomicity/idempotency/replay safety и отсутствие false-failure после уже совершённой критической записи. Потерянный ответ или повторный запрос не должен удваивать бизнес-эффект.
7. Историческая финансовая/складская правда не переписывается «для удобства». Исправления должны идти через безопасную correction/reversal логику с историей, а не через скрытый rewrite.
8. Пользовательские интерфейсы не должны показывать служебные комментарии, внутренние шаги разработки, названия регрессий или сообщения, предназначенные разработчику.
9. Предпочитать semantic/domain regression tests exact-source hash/line-count проверкам. Byte-level freeze оставлять только для действительно замороженных артефактов.
10. Не считать релиз завершённым по одному CI. Для deploy нужен успешный статус **точного merged SHA** в соответствующем Cloudflare workflow.
11. Не тратить сессию на бесконечный polling. Если внешний CI/deploy долго ждёт, оставить безопасный checkpoint: ветка/HEAD/run/status/следующее действие.
12. После значимого merge/deploy/нового инварианта обновлять continuation, чтобы новый чат не восстанавливал состояние по древним файлам.

## Жёсткая изоляция окружений

- `main` / Production Worker: `orders-app`.
- Production D1: `orders_db_prod`, id `17e68a41-1d58-4a36-8a63-47c3e32443c4`.
- `branch2` Worker: `orders-app-branch2`.
- Branch2 D1: `orders_db_branch2`, id `40065052-854e-44b8-bcd5-251bdd488301`.
- Никогда не связывать Worker одной среды с D1 другой.
- Никогда не копировать/синхронизировать данные между Production и Branch2 без отдельного явного запроса пользователя.
- Перед любой D1 mutation сначала проверить фактические Worker name + D1 logical name + D1 id; имя ветки само по себе не доказательство.
- Не запускать blanket remote `migrations apply` по старому журналу. Сначала read-only сверка schema/`d1_migrations`, затем только конкретная доказанно нужная migration.
- Environment-specific `wrangler.jsonc`, визуальный marker и regression gate не переносятся вместе с бизнес-кодом.
- Инцидент 2026-09-22 с Production binding в Branch2 считается постоянным предупреждением; исправление: `0f38bf4f1c85ef124237abd952384b05513b946c`.

## Постоянные бизнес-инварианты

### Catalog / Resolver
- Catalog identity: product → execution (`product + material + length`) → exact SKU (execution + adult/child + gender + color + size/age).
- Resolver — **anomaly guard, а не анкета на совместимость**.
- Известный факт считается известным, если он есть в maintained references **или любом активном Catalog SKU**.
- Безопасные различия пунктуации/пробелов, например `ТЕМНО-СЕРЫЙ` и `ТЕМНО СЕРЫЙ`, канонизируются автоматически.
- Harmless punctuation-equivalent **color** spellings не должны материализовываться как два новых physical SKU: runtime использует exact-first lookup + semantic fallback. Подтверждённые Branch2 active collisions исправлены отдельной guarded D1 correction 2026-09-27; исторические inactive rows/snapshots не переписываются.
- Новая точная комбинация уже известных фактов не должна вызывать лишний вопрос; deterministic safe combination path может создать/связать комбинацию с physical stock 0.
- R11 сохраняется: явный пол менеджера → пол выбранного concrete SKU → fixed product scope fallback.
- Reference duplicate protection не переписывает старые заказы/варианты/историю.
- Retired product/SKU остаётся историей, но не должен попадать в рабочие формы выбора; вывод из каталога — soft deactivate, не delete.
- Нельзя создавать новое исполнение/SKU или сохранять активный SKU под retired product.
- Whole-product retirement допустим только после вывода активных SKU и при отсутствии физического остатка, резерва, активного неотправленного заказа, незавершённой задачи Цеха, pending lifecycle и активной ревизии.
- Reactivation retired product обязана заново проверять canonical product identity/aliases, чтобы старый дубль вроде `ОРДА` не мог вернуться в рабочий каталог.

### Warehouse / inventory truth
- `Physical`, `Reserved`, `Available = Physical - Reserved` остаются разными истинами.
- Только явный count/correction workflow может задавать абсолютный Physical.
- Operational possession подтверждает только конкретные единицы текущей операции и никогда не превращается в «полный пересчёт SKU».
- Outbound при нехватке tracked Physical ограничивается снизу нулём; unexplained quantity остаётся audit evidence.
- Arrival / «Приход» заморожен и не меняется без отдельного явного запроса.

### Finance / pricing truth
- Текущая Catalog recommendation, фактическая цена продажи, платежи и долг — разные сущности.
- Исторические заказы не пересчитываются по сегодняшнему Catalog.
- Для будущего/Branch2 `itemized_v1`: `catalog_price_snapshot` — историческая рекомендация, `unit_price` — фактическая цена, `line_total = quantity × unit_price`, платежи независимы.
- Legacy orders остаются `legacy_manual_total`; нельзя выдумывать построчную цену для старой истории.
- Возврат денег и физический возврат — отдельные факты; exchange money также отдельный финансовый факт.

### Operational autonomy
- Нормальные бизнес-коррекции должны быть выполнимы через приложение без разработчика.
- Безопасность достигается stale checks, явными correction/reversal действиями, audit history и idempotency, а не блокировкой законного сценария навсегда.

## Техническая основа

- Frontend: React + TypeScript + Vite.
- Backend: Cloudflare Worker + D1; `worker/index.ts` — composition root, доменная логика разнесена по `worker/domains`.
- Runtime-файл должен быть достижим из `src/main.tsx` или `worker/index.ts`, если он не является deliberately inactive contract/fixture.
- CSS cascade/order считается поведением; широкую CSS-cleanup не смешивать с бизнес-изменениями.
- Step 190.0 access/auth всё ещё отложен до отдельного согласования с клиентом.


## Актуальные подробные документы

- `docs/PROJECT_CONTEXT.md` — постоянные архитектурные/рабочие инварианты.
- `docs/continuation/CATALOG_SEMANTIC_SKU_IDENTITY_20260927.md` — incident/checkpoint по ЭТНО КАРДИГАНУ, PR #220/#221, release evidence и следующий safe data-correction chunk.
- `docs/continuation/STAGE03_H12_FINAL_E2E_AUDIT_20260926.md` — финальная Stage03 интеграционная модель.
- `docs/continuation/CLIENT_ZAMMLER_COMPLETION_20260924.md` — ZAMMLER завершён и не является Stage04.
- `docs/continuation/WAREHOUSE_CURRENT_CONTEXT.md` — Warehouse/Stage02 history; Phase2 уже завершён.
- `docs/continuation/STAGE02_PHASE2_STOCK_TRUTH_MODEL_20260919.md` — stock-truth semantics.
- `docs/continuation/OPERATIONAL_AUTONOMY_AUDIT_20260910.md` — A1–A5 теперь закрыты.

## Точка продолжения

Semantic SKU incident 2026-09-27 закрыт и на Branch2: отдельная correction использовала только Branch2 evidence, не копировала Production data assumptions, и финальный audit показывает `activeCollisionGroups: 0`. Branch2 Stage03 runtime остался сохранённым и не переписывался этой работой. Возвращаться к semantic SKU correction следует только при новом конкретном дефекте; перед следующим проектным шагом заново открыть GitHub и проверить актуальные HEAD/deploy state.

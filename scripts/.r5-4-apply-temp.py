from pathlib import Path

path = Path('worker/domains/order-reservations.ts')
text = path.read_text(encoding='utf-8')
compact_start = text.index('    if (listFlagsOnly) {')
compact_end = text.index('    const orderScope = chunk', compact_start)
compact = text[compact_start:compact_end]

start = compact.index('         latest_check AS (')
end = compact.index('         SELECT\n           ar.order_id', start)
replacement = '''         lineage AS MATERIALIZED (
           SELECT si.*,
                  (SELECT json_array(c.id, c.checked_at)
                   FROM inventory_stock_checks c
                   WHERE c.inventory_source = si.inventory_source
                     AND c.variant_id = si.variant_id
                     AND (
                       (datetime(c.checked_at) < datetime(si.origin_at) AND date(c.checked_at, '+5 hours') >= date(si.order_date))
                       OR (si.has_workshop = 1 AND datetime(c.checked_at) > datetime(si.origin_at))
                     )
                   ORDER BY datetime(c.checked_at) DESC, c.id DESC
                   LIMIT 1) AS check_point,
                  (SELECT json_array(-s.rowid, s.completed_at)
                   FROM inventory_stocktake_sessions s
                   WHERE s.inventory_source = si.inventory_source
                     AND s.status = 'completed'
                     AND s.completed_at IS NOT NULL
                     AND s.id NOT LIKE 'REV-%-P-%'
                     AND datetime(s.started_at) <= datetime(si.origin_at)
                     AND date(s.completed_at, '+5 hours') >= date(si.order_date)
                     AND NOT EXISTS (
                       SELECT 1 FROM inventory_stock_checks exact_sku
                       WHERE exact_sku.inventory_source = si.inventory_source
                         AND exact_sku.variant_id = si.variant_id
                         AND exact_sku.reference_type = 'stocktake'
                         AND exact_sku.reference_id = s.id
                     )
                   ORDER BY datetime(s.completed_at) DESC, s.rowid DESC
                   LIMIT 1) AS full_point,
                  (SELECT json_array(hr.checkpoint_id, hr.checkpoint_at)
                   FROM inventory_handover_reviews hr
                   JOIN order_items reviewed_item ON reviewed_item.id = hr.order_item_id
                   WHERE hr.order_id = si.order_id
                     AND COALESCE(NULLIF(reviewed_item.inventory_obligation_key, ''), 'legacy-order-item:' || reviewed_item.id) = si.obligation_key
                   ORDER BY datetime(hr.checkpoint_at) DESC, hr.checkpoint_id DESC, hr.id DESC
                   LIMIT 1) AS review_point
           FROM scoped_items si
         ),
         resolved AS MATERIALIZED (
           SELECT l.*,
                  CASE
                    WHEN l.check_point IS NULL THEN CAST(json_extract(l.full_point, '$[0]') AS INTEGER)
                    WHEN l.full_point IS NULL THEN CAST(json_extract(l.check_point, '$[0]') AS INTEGER)
                    WHEN datetime(json_extract(l.full_point, '$[1]')) > datetime(json_extract(l.check_point, '$[1]'))
                      THEN CAST(json_extract(l.full_point, '$[0]') AS INTEGER)
                    WHEN datetime(json_extract(l.full_point, '$[1]')) = datetime(json_extract(l.check_point, '$[1]'))
                      AND CAST(json_extract(l.full_point, '$[0]') AS INTEGER) > CAST(json_extract(l.check_point, '$[0]') AS INTEGER)
                      THEN CAST(json_extract(l.full_point, '$[0]') AS INTEGER)
                    ELSE CAST(json_extract(l.check_point, '$[0]') AS INTEGER)
                  END AS checkpoint_id,
                  CASE
                    WHEN l.check_point IS NULL THEN json_extract(l.full_point, '$[1]')
                    WHEN l.full_point IS NULL THEN json_extract(l.check_point, '$[1]')
                    WHEN datetime(json_extract(l.full_point, '$[1]')) > datetime(json_extract(l.check_point, '$[1]'))
                      THEN json_extract(l.full_point, '$[1]')
                    WHEN datetime(json_extract(l.full_point, '$[1]')) = datetime(json_extract(l.check_point, '$[1]'))
                      AND CAST(json_extract(l.full_point, '$[0]') AS INTEGER) > CAST(json_extract(l.check_point, '$[0]') AS INTEGER)
                      THEN json_extract(l.full_point, '$[1]')
                    ELSE json_extract(l.check_point, '$[1]')
                  END AS checkpoint_at,
                  CAST(json_extract(l.review_point, '$[0]') AS INTEGER) AS reviewed_checkpoint_id,
                  json_extract(l.review_point, '$[1]') AS reviewed_checkpoint_at
           FROM lineage l
         ),
'''
compact = compact[:start] + replacement + compact[end:]

replacements = {
    '           si.order_date, si.origin_at AS item_created_at,': '           lineage_row.order_date, lineage_row.origin_at AS item_created_at,',
    '             julianday(cp.checkpoint_at) > 0': '             julianday(lineage_row.checkpoint_at) > 0',
    '               COALESCE(julianday(lr.reviewed_checkpoint_at), 0) < julianday(cp.checkpoint_at)': '               COALESCE(julianday(lineage_row.reviewed_checkpoint_at), 0) < julianday(lineage_row.checkpoint_at)',
    '               OR (julianday(lr.reviewed_checkpoint_at) = julianday(cp.checkpoint_at)': '               OR (julianday(lineage_row.reviewed_checkpoint_at) = julianday(lineage_row.checkpoint_at)',
    '                   AND COALESCE(lr.reviewed_checkpoint_id, 0) <> cp.checkpoint_id)': '                   AND COALESCE(lineage_row.reviewed_checkpoint_id, 0) <> lineage_row.checkpoint_id)',
    '         JOIN scoped_items si ON si.order_item_id = ar.order_item_id\n': '         JOIN resolved lineage_row ON lineage_row.order_item_id = ar.order_item_id\n',
    '         LEFT JOIN selected_checkpoint cp ON cp.order_item_id = ar.order_item_id AND cp.rn = 1\n': '',
    '         LEFT JOIN latest_review lr ON lr.order_item_id = ar.order_item_id AND lr.rn = 1\n': '',
}
for old, new in replacements.items():
    count = compact.count(old)
    if count != 1:
        raise SystemExit(f'Expected exactly one compact replacement target: {old!r}; found {count}')
    compact = compact.replace(old, new, 1)

for marker in ['latest_check AS (', 'latest_full_stocktake AS (', 'selected_checkpoint AS (', 'latest_review AS (']:
    if marker in compact:
        raise SystemExit(f'Legacy compact window CTE survived: {marker}')
if 'lineage AS MATERIALIZED (' not in compact or 'resolved AS MATERIALIZED (' not in compact:
    raise SystemExit('R5.4 materialized lineage CTEs missing')

text = text[:compact_start] + compact + text[compact_end:]
path.write_text(text, encoding='utf-8')
print('R5.4 compact handover patch applied exactly once')

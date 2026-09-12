from pathlib import Path

path = Path('worker/domains/workshop.ts')
text = path.read_text(encoding='utf-8')
old = """  if (view === 'urgent' || urgentOnly) {
    whereParts.push('wt.urgent = 1');
  }
"""
new = """  if (view === 'urgent' || urgentOnly) {
    // Urgency belongs to the order for workshop handling: once one active line is urgent,
    // keep every active workshop line from that order visible together with the same ORD.
    whereParts.push(`wt.order_id IN (
      SELECT DISTINCT urgent_sibling.order_id
      FROM workshop_tasks urgent_sibling
      WHERE urgent_sibling.status = 'active' AND urgent_sibling.urgent = 1
    )`);
  }
"""
if text.count(old) != 1:
    raise SystemExit(f'urgent workshop filter anchor mismatch: {text.count(old)}')
path.write_text(text.replace(old, new, 1), encoding='utf-8')

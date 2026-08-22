// Step 190.6A: structural module extracted from worker/index.ts.
// Business behavior is intentionally unchanged.
import { readTableColumnSet } from '../core/sql.ts'
import { cleanText } from '../core/text.ts'

export let orderItemWorkshopColumnInit: Promise<void> | null = null;


export async function ensureOrderItemWorkshopColumn(db: D1Database) {
  if (!orderItemWorkshopColumnInit) {
    orderItemWorkshopColumnInit = (async () => {
      const info = await db.prepare('PRAGMA table_info(order_items)').all<{ name: string }>();
      const columns = (info.results || []).map(row => cleanText((row as any).name).toLowerCase());
      const addColumnIfMissing = async (name: string, sql: string) => {
        if (columns.includes(name.toLowerCase())) return;
        try {
          await db.prepare(sql).run();
        } catch (error) {
          const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
          if (!message.includes('duplicate column')) {
            throw error;
          }
        }
      };

      await addColumnIfMissing('workshop_comment', 'ALTER TABLE order_items ADD COLUMN workshop_comment TEXT');
      await addColumnIfMissing('workshop_urgent', 'ALTER TABLE order_items ADD COLUMN workshop_urgent INTEGER NOT NULL DEFAULT 0');
      await addColumnIfMissing('workshop_due_date', 'ALTER TABLE order_items ADD COLUMN workshop_due_date TEXT');
    })();
  }

  await orderItemWorkshopColumnInit;
}



export let workshopTaskColumnCache: Set<string> | null = null;


export async function getWorkshopTaskColumnSet(db: D1Database, refresh = false) {
  if (!workshopTaskColumnCache || refresh) {
    workshopTaskColumnCache = await readTableColumnSet(db, 'workshop_tasks');
  }
  return workshopTaskColumnCache;
}


export async function assertWorkshopTaskDetailSchema(db: D1Database) {
  const required = ['order_item_id', 'product_id', 'variant_id', 'gender_snapshot', 'color_snapshot', 'material_snapshot', 'length_snapshot', 'size_snapshot'];
  const columns = await getWorkshopTaskColumnSet(db, true);
  const missing = required.filter((name) => !columns.has(name));
  if (missing.length) {
    throw new Error(`Схема цеха устарела: отсутствуют поля ${missing.join(', ')}. Сначала примените миграции проекта.`);
  }
}

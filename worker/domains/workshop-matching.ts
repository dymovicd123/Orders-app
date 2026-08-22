// Step 190.6A: structural module extracted from worker/index.ts.
// Business behavior is intentionally unchanged.
import { toInt, upperText } from '../core/text.ts'

export function normalizeWorkshopMatchKey(value: unknown) {
  const kazakhLetterMap: Record<string, string> = {
    'Ә': 'А',
    'Ғ': 'Г',
    'Қ': 'К',
    'Ң': 'Н',
    'Ө': 'О',
    'Ұ': 'У',
    'Ү': 'У',
    'Һ': 'Х',
    'І': 'И',
  };

  return upperText(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[ӘҒҚҢӨҰҮҺІ]/g, (letter) => kazakhLetterMap[letter] || letter)
    .replace(/[^A-ZА-ЯЁ0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}


export function workshopTaskItemMatchScore(task: Record<string, unknown>, item: Record<string, unknown>) {
  const taskName = normalizeWorkshopMatchKey(task.product_name_snapshot);
  const itemName = normalizeWorkshopMatchKey(item.product_name_snapshot);
  if (!taskName || !itemName) return Number.NEGATIVE_INFINITY;

  const taskTokens = new Set(taskName.split(' ').filter(Boolean));
  const itemTokens = new Set(itemName.split(' ').filter(Boolean));
  const overlap = Array.from(taskTokens).filter(token => itemTokens.has(token)).length;
  const overlapRatio = overlap / Math.max(1, Math.min(taskTokens.size, itemTokens.size));
  const exactName = taskName === itemName;
  const containedName = taskName.includes(itemName) || itemName.includes(taskName);
  const productIdMatch = toInt(task.product_id, 0) > 0 && toInt(task.product_id, 0) === toInt(item.product_id, 0);

  // A task and an item must at least describe the same product. Size alone is not enough:
  // one order can contain several unrelated products of the same size.
  if (!exactName && !containedName && !productIdMatch && overlapRatio < 0.45) {
    return Number.NEGATIVE_INFINITY;
  }

  let score = 0;
  if (exactName) score += 2400;
  else if (containedName) score += 1500;
  score += overlap * 120 + Math.round(overlapRatio * 500);
  if (productIdMatch) score += 700;

  const compareField = (taskField: string, itemField: string, matchPoints: number, mismatchPoints: number) => {
    const left = normalizeWorkshopMatchKey(task[taskField]);
    const right = normalizeWorkshopMatchKey(item[itemField]);
    if (!left || !right) return;
    score += left === right ? matchPoints : -mismatchPoints;
  };

  compareField('size_snapshot', 'resolved_size', 850, 350);
  compareField('color_snapshot', 'resolved_color', 550, 180);
  compareField('gender_snapshot', 'resolved_gender', 450, 250);
  compareField('material_snapshot', 'resolved_material', 350, 120);
  compareField('length_snapshot', 'resolved_length', 350, 120);

  const itemGender = normalizeWorkshopMatchKey(item.resolved_gender);
  const taskSaysMale = /(^| )МУЖ($| )/.test(taskName);
  const taskSaysFemale = /(^| )ЖЕН($| )/.test(taskName);
  if (taskSaysMale) score += itemGender === 'МУЖ' ? 650 : (itemGender ? -650 : 0);
  if (taskSaysFemale) score += itemGender === 'ЖЕН' ? 650 : (itemGender ? -650 : 0);

  if (toInt(task.quantity, 0) > 0 && toInt(task.quantity, 0) === toInt(item.quantity, 0)) score += 80;
  if (Boolean(toInt(item.is_workshop, 0))) score += 40;
  return score;
}


export function isHighConfidenceWorkshopTaskItemMatch(
  task: Record<string, unknown>,
  item: Record<string, unknown>,
) {
  const exactName = normalizeWorkshopMatchKey(task.product_name_snapshot) === normalizeWorkshopMatchKey(item.product_name_snapshot);
  const productIdMatch = toInt(task.product_id, 0) > 0 && toInt(task.product_id, 0) === toInt(item.product_id, 0);
  if (!exactName && !productIdMatch) return false;

  const pairs: Array<[string, string]> = [
    ['size_snapshot', 'resolved_size'],
    ['color_snapshot', 'resolved_color'],
    ['gender_snapshot', 'resolved_gender'],
    ['material_snapshot', 'resolved_material'],
    ['length_snapshot', 'resolved_length'],
  ];
  let compared = 0;
  for (const [taskField, itemField] of pairs) {
    const left = normalizeWorkshopMatchKey(task[taskField]);
    const right = normalizeWorkshopMatchKey(item[itemField]);
    if (!left || !right) continue;
    compared += 1;
    if (left !== right) return false;
  }
  return compared > 0 && workshopTaskItemMatchScore(task, item) >= 2400;
}


export function matchWorkshopTasksToOrderItems(
  taskRows: Record<string, unknown>[],
  itemRows: Record<string, unknown>[],
) {
  const tasksByOrder = new Map<number, Record<string, unknown>[]>();
  const itemsByOrder = new Map<number, Record<string, unknown>[]>();
  const matches = new Map<number, Record<string, unknown>>();

  for (const task of taskRows) {
    const orderId = toInt(task.order_id, 0);
    if (!orderId) continue;
    if (!tasksByOrder.has(orderId)) tasksByOrder.set(orderId, []);
    tasksByOrder.get(orderId)!.push(task);
  }
  for (const item of itemRows) {
    const orderId = toInt(item.order_id, 0);
    if (!orderId) continue;
    if (!itemsByOrder.has(orderId)) itemsByOrder.set(orderId, []);
    itemsByOrder.get(orderId)!.push(item);
  }

  for (const [orderId, orderTasks] of tasksByOrder) {
    const candidates = (itemsByOrder.get(orderId) || []).sort((a, b) => toInt(a.id, 0) - toInt(b.id, 0));
    const candidatesById = new Map(candidates.map(item => [toInt(item.id, 0), item]));
    const usedItemIds = new Set<number>();
    const sortedTasks = [...orderTasks].sort((a, b) => toInt(a.id, 0) - toInt(b.id, 0));
    const directLinkCounts = new Map<number, number>();
    for (const task of sortedTasks) {
      const directItemId = toInt(task.order_item_id, 0);
      if (directItemId && candidatesById.has(directItemId)) {
        directLinkCounts.set(directItemId, (directLinkCounts.get(directItemId) || 0) + 1);
      }
    }

    // A unique persisted order_item_id is authoritative. A duplicated old link
    // is not: it must go through the one-to-one matcher so two task rows can never
    // be displayed as the same order item.
    for (const task of sortedTasks) {
      const taskId = toInt(task.id, 0);
      const directItemId = toInt(task.order_item_id, 0);
      const directItem = candidatesById.get(directItemId);
      if (!taskId || !directItemId || !directItem || directLinkCounts.get(directItemId) !== 1) continue;
      matches.set(taskId, directItem);
      usedItemIds.add(directItemId);
    }

    for (const task of sortedTasks) {
      const taskId = toInt(task.id, 0);
      if (!taskId || matches.has(taskId)) continue;
      let bestItem: Record<string, unknown> | null = null;
      let bestScore = Number.NEGATIVE_INFINITY;
      for (const item of candidates) {
        const itemId = toInt(item.id, 0);
        if (!itemId || usedItemIds.has(itemId)) continue;
        const score = workshopTaskItemMatchScore(task, item);
        if (score > bestScore) {
          bestScore = score;
          bestItem = item;
        }
      }
      if (!bestItem || !Number.isFinite(bestScore)) continue;
      const itemId = toInt(bestItem.id, 0);
      if (!itemId) continue;
      matches.set(taskId, bestItem);
      usedItemIds.add(itemId);
    }
  }

  return matches;
}

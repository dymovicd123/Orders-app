from pathlib import Path

path = Path('worker/domains/inventory-read.ts')
text = path.read_text(encoding='utf-8')
old = '''  const workshopWarnings = allWorkshop.map(row => {
    const orderDate = cleanText(row.order_date) || cleanText(row.created_at).slice(0, 10);
    const waitingDays = daysBetweenDates(orderDate, today);
    const dueDate = cleanText(row.due_date);
    const overdueDays = dueDate ? daysBetweenDates(dueDate, today) : 0;
    const urgent = Boolean(toInt(row.urgent, 0));
    const score = waitingDays * 10 + overdueDays * 30 + (urgent ? 300 : 0);
    return {
      id: toInt(row.id, 0),
      orderId: toInt(row.order_id, 0),
      orderItemId: toInt(row.resolved_order_item_id, 0) || toInt(row.order_item_id, 0) || null,
      externalOrderId: cleanText(row.external_order_id),
      productId: toInt(row.product_id, 0),
      variantId: toInt(row.variant_id, 0),
      productName: cleanText(row.product_name_snapshot),
      gender: cleanText(row.resolved_gender),
      color: cleanText(row.resolved_color),
      material: cleanText(row.resolved_material),
      length: cleanText(row.resolved_length),
      size: cleanText(row.resolved_size),
      audienceType: cleanText(row.resolved_audience_type) || 'ВЗРОСЛЫЙ',
      quantity: toInt(row.quantity, 1),
      comment: workshopOnlyComment(row.comment),
      urgent,
      dueDate,
      status: cleanText(row.status),
      orderDate,
      waitingDays,
      overdueDays,
      managerName: cleanText(row.manager_name),
      customerPhone: cleanText(row.customer_phone),
      customerName: cleanText(row.customer_name),
      city: cleanText(row.city),
      deliveryType: cleanText(row.delivery_type),
      priorityScore: score,
      reason: dueDate && overdueDays > 0
        ? `Просрочено на ${overdueDays} дн., всего в ожидании ${waitingDays} дн.`
        : `${waitingDays} дн. в ожидании`,
    };
  }).filter(row => row.waitingDays >= workshopAgeLimit || row.overdueDays > 0 || row.urgent)
    .sort((a, b) => b.priorityScore - a.priorityScore || b.waitingDays - a.waitingDays || a.productName.localeCompare(b.productName, 'ru'))
    .slice(0, 80);'''
new = '''  const workshopWarnings = allWorkshop.map(row => {
    const orderDate = cleanText(row.order_date) || cleanText(row.created_at).slice(0, 10);
    const waitingDays = daysBetweenDates(orderDate, today);
    const dueDate = cleanText(row.due_date);
    const overdueDays = dueDate ? daysBetweenDates(dueDate, today) : 0;
    const dueInDays = dueDate && dueDate >= today ? daysBetweenDates(today, dueDate) : null;
    const urgent = Boolean(toInt(row.urgent, 0));
    const attentionTier = overdueDays > 0
      ? 0
      : dueDate && dueInDays !== null && dueInDays <= 2
        ? 1
        : urgent
          ? 2
          : dueDate
            ? 3
            : 4;
    const score = (5 - attentionTier) * 10000 + overdueDays * 100 + waitingDays * 10 + (urgent ? 50 : 0);
    const reason = overdueDays > 0
      ? `Просрочено на ${overdueDays} дн. · ждёт ${waitingDays} дн.`
      : dueDate === today
        ? `Дедлайн сегодня · ждёт ${waitingDays} дн.`
        : dueInDays !== null
          ? `Дедлайн через ${dueInDays} дн. · ждёт ${waitingDays} дн.`
          : urgent
            ? `Срочно · ждёт ${waitingDays} дн.`
            : `Ждёт ${waitingDays} дн.`;
    return {
      id: toInt(row.id, 0),
      orderId: toInt(row.order_id, 0),
      orderItemId: toInt(row.resolved_order_item_id, 0) || toInt(row.order_item_id, 0) || null,
      externalOrderId: cleanText(row.external_order_id),
      productId: toInt(row.product_id, 0),
      variantId: toInt(row.variant_id, 0),
      productName: cleanText(row.product_name_snapshot),
      gender: cleanText(row.resolved_gender),
      color: cleanText(row.resolved_color),
      material: cleanText(row.resolved_material),
      length: cleanText(row.resolved_length),
      size: cleanText(row.resolved_size),
      audienceType: cleanText(row.resolved_audience_type) || 'ВЗРОСЛЫЙ',
      quantity: toInt(row.quantity, 1),
      comment: workshopOnlyComment(row.comment),
      urgent,
      dueDate,
      status: cleanText(row.status),
      orderDate,
      waitingDays,
      overdueDays,
      managerName: cleanText(row.manager_name),
      customerPhone: cleanText(row.customer_phone),
      customerName: cleanText(row.customer_name),
      city: cleanText(row.city),
      deliveryType: cleanText(row.delivery_type),
      priorityScore: score,
      reason,
    };
  }).filter(row => row.waitingDays >= workshopAgeLimit || row.overdueDays > 0 || row.urgent || Boolean(row.dueDate))
    .sort((a, b) => {
      const tier = (row: typeof a) => row.overdueDays > 0
        ? 0
        : row.dueDate && row.dueDate >= today && daysBetweenDates(today, row.dueDate) <= 2
          ? 1
          : row.urgent
            ? 2
            : row.dueDate
              ? 3
              : 4;
      const byTier = tier(a) - tier(b);
      if (byTier) return byTier;
      if (a.overdueDays !== b.overdueDays) return b.overdueDays - a.overdueDays;
      if (a.dueDate && b.dueDate && a.dueDate !== b.dueDate) return a.dueDate.localeCompare(b.dueDate);
      if (a.waitingDays !== b.waitingDays) return b.waitingDays - a.waitingDays;
      const byOrder = a.externalOrderId.localeCompare(b.externalOrderId, 'ru');
      if (byOrder) return byOrder;
      return a.productName.localeCompare(b.productName, 'ru');
    })
    .slice(0, 80);'''
if text.count(old) != 1:
    raise SystemExit(f'workshop warning block mismatch: {text.count(old)}')
path.write_text(text.replace(old, new, 1), encoding='utf-8')

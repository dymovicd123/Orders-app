// Step 190.6A: structural module extracted from worker/index.ts.
// Business behavior is intentionally unchanged.
import { json } from '../core/http.ts'
import { mapSqlRows } from '../core/sql.ts'
import { cleanText, normalizeDate, normalizeEmployeeRole, toInt, upperText } from '../core/text.ts'
import { normalizeManagerColor, parseReportDateRange, resolveActiveManagerId, writeActivityLog } from './activity.ts'

export type EmployeeInput = {
  id?: unknown;
  name?: unknown;
  role?: unknown;
  phone?: unknown;
  colorKey?: unknown;
  hiredAt?: unknown;
  comment?: unknown;
  isActive?: unknown;
};


export type LeadInput = {
  id?: unknown;
  date?: unknown;
  managerId?: unknown;
  managerName?: unknown;
  acceptedCount?: unknown;
  badCount?: unknown;
  comment?: unknown;
};


export type CallCentreInput = {
  id?: unknown;
  date?: unknown;
  managerId?: unknown;
  managerName?: unknown;
  acceptedLeads?: unknown;
  callsMade?: unknown;
  callsAccepted?: unknown;
  fakeCount?: unknown;
  refusalCount?: unknown;
  potentialCount?: unknown;
  comment?: unknown;
};


export type PlanInput = {
  id?: unknown;
  periodStart?: unknown;
  periodEnd?: unknown;
  managerId?: unknown;
  managerName?: unknown;
  plannedAmount?: unknown;
  salaryBase?: unknown;
  bonusHitPercent?: unknown;
  bonusMissPercent?: unknown;
  comment?: unknown;
};


export type DepartmentPlanInput = {
  id?: unknown;
  periodStart?: unknown;
  periodEnd?: unknown;
  plannedAmount?: unknown;
  comment?: unknown;
};



export type TimesheetInput = {
  dates?: unknown;
  managerIds?: unknown;
  workUntil?: unknown;
  comment?: unknown;
  clear?: unknown;
};


export function normalizeMonthParam(value: unknown) {
  const raw = cleanText(value);
  if (/^\d{4}-\d{2}$/.test(raw)) return raw;
  return new Date().toISOString().slice(0, 7);
}


export function getMonthRange(monthValue: string) {
  const [yearText, monthText] = monthValue.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const startDate = `${yearText}-${monthText}-01`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const endDate = `${yearText}-${monthText}-${String(lastDay).padStart(2, '0')}`;
  return { startDate, endDate };
}


export async function countTeamEmployeeReferences(db: D1Database, id: number) {
  const runD1Bounded = async (tasks: Array<() => Promise<any>>) => {
    const results: any[] = [];
    for (let index = 0; index < tasks.length; index += 6) {
      results.push(...await Promise.all(tasks.slice(index, index + 6).map(task => task())));
    }
    return results;
  };

  const [orders, returns, exchanges, plans, leads, callCentre, timesheet, attendance] = await runD1Bounded([
    () => db.prepare('SELECT COUNT(*) AS count FROM orders WHERE manager_id = ?').bind(id).first<any>(),
    () => db.prepare('SELECT COUNT(*) AS count FROM returns WHERE manager_id = ?').bind(id).first<any>(),
    () => db.prepare('SELECT COUNT(*) AS count FROM exchanges WHERE manager_id = ?').bind(id).first<any>(),
    () => db.prepare('SELECT COUNT(*) AS count FROM plans WHERE manager_id = ?').bind(id).first<any>(),
    () => db.prepare('SELECT COUNT(*) AS count FROM lead_records WHERE manager_id = ?').bind(id).first<any>(),
    () => db.prepare('SELECT COUNT(*) AS count FROM call_centre_records WHERE manager_id = ?').bind(id).first<any>(),
    () => db.prepare('SELECT COUNT(*) AS count FROM team_timesheet WHERE manager_id = ?').bind(id).first<any>(),
    () => db.prepare('SELECT COUNT(*) AS count FROM attendance_days WHERE manager_id = ?').bind(id).first<any>(),
  ]);
  return [orders, returns, exchanges, plans, leads, callCentre, timesheet, attendance]
    .reduce((sum, row) => sum + toInt(row?.count, 0), 0);
}


export async function listTeamEmployees(db: D1Database) {
  // Keep this as a single non-compound SELECT. The previous compound reference_rows CTE
  // occasionally hit D1/SQLite's compound-SELECT term limit on the live database.
  // Team size is small, so scalar COUNT subqueries are both predictable and cheap here.
  const result = await db.prepare(
    `SELECT m.id, m.name, m.is_active, COALESCE(m.role, '') AS role, COALESCE(m.phone, '') AS phone,
            COALESCE(m.comment, '') AS comment, COALESCE(m.color_key, '') AS color_key,
            COALESCE((SELECT MIN(o.order_date) FROM orders o WHERE o.manager_id = m.id), m.hired_at, substr(m.created_at, 1, 10)) AS hired_at,
            COALESCE(m.dismissed_at, '') AS dismissed_at,
            m.created_at, m.updated_at,
            (
              (SELECT COUNT(*) FROM orders o WHERE o.manager_id = m.id)
              + (SELECT COUNT(*) FROM returns r WHERE r.manager_id = m.id)
              + (SELECT COUNT(*) FROM exchanges e WHERE e.manager_id = m.id)
              + (SELECT COUNT(*) FROM plans p WHERE p.manager_id = m.id)
              + (SELECT COUNT(*) FROM lead_records lr WHERE lr.manager_id = m.id)
              + (SELECT COUNT(*) FROM call_centre_records cc WHERE cc.manager_id = m.id)
              + (SELECT COUNT(*) FROM team_timesheet tt WHERE tt.manager_id = m.id)
              + (SELECT COUNT(*) FROM attendance_days ad WHERE ad.manager_id = m.id)
            ) AS reference_count
     FROM managers m
     ORDER BY m.is_active DESC, hired_at DESC, m.name ASC, m.id DESC`
  ).all<any>();

  const rows = mapSqlRows(result).map((row: any) => ({
    id: Number(row.id || 0),
    name: cleanText(row.name),
    isActive: Boolean(row.is_active),
    role: cleanText(row.role) || 'Менеджер',
    phone: cleanText(row.phone),
    comment: cleanText(row.comment),
    colorKey: normalizeManagerColor(row.color_key, toInt(row.id, 0) - 1),
    hiredAt: cleanText(row.hired_at),
    dismissedAt: cleanText(row.dismissed_at),
    referenceCount: toInt(row.reference_count, 0),
    canDelete: toInt(row.reference_count, 0) === 0,
    createdAt: cleanText(row.created_at),
    updatedAt: cleanText(row.updated_at),
  }));

  return {
    ok: true,
    employees: rows,
    stats: {
      total: rows.length,
      active: rows.filter(row => row.isActive).length,
      inactive: rows.filter(row => !row.isActive).length,
    },
  };
}


export async function saveTeamEmployee(db: D1Database, input: EmployeeInput) {
  const id = toInt(input.id, 0);
  const name = upperText(input.name);
  if (!name) throw new Error('Укажите имя сотрудника.');
  const role = normalizeEmployeeRole(input.role);
  const phone = cleanText(input.phone);
  const comment = cleanText(input.comment);
  const isActive = input.isActive === false || Number(input.isActive) === 0 ? 0 : 1;
  const now = new Date().toISOString();
  const hiredAt = normalizeDate(input.hiredAt || now);
  const colorKey = normalizeManagerColor(input.colorKey, id || Date.now());

  let employeeId = id;
  if (id) {
    const existing = await db.prepare('SELECT id, salary_base, dismissed_at FROM managers WHERE id = ?').bind(id).first<any>();
    if (!existing?.id) throw new Error('Сотрудник не найден.');
    await db.prepare(
      `UPDATE managers
       SET name = ?, role = ?, phone = ?, comment = ?, color_key = ?, hired_at = ?, is_active = ?,
           dismissed_at = CASE WHEN ? = 1 THEN NULL ELSE COALESCE(dismissed_at, ?) END,
           updated_at = ?
       WHERE id = ?`
    ).bind(name, role, phone || null, comment || null, colorKey, hiredAt, isActive, isActive, now.slice(0, 10), now, id).run();
  } else {
    const inserted = await db.prepare(
      `INSERT INTO managers (name, role, phone, salary_base, comment, color_key, hired_at, dismissed_at, is_active, created_at, updated_at)
       VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(name, role, phone || null, comment || null, colorKey, hiredAt, isActive ? null : now.slice(0, 10), isActive, now, now).run();
    employeeId = Number(inserted.meta?.last_row_id || 0);
  }

  await writeActivityLog(db, {
    eventType: id ? 'team_employee_updated' : 'team_employee_created',
    entityType: 'team_employee',
    entityId: employeeId || null,
    title: `${id ? 'Обновлён' : 'Создан'} сотрудник ${name}`,
    details: `${role}; цвет ${colorKey}; начало ${hiredAt}${phone ? `; ${phone}` : ''}`,
  });

  return { ok: true, employeeId, employee: { id: employeeId, name, role, phone, comment, colorKey, hiredAt, isActive: Boolean(isActive) } };
}


export async function setTeamEmployeeActive(db: D1Database, id: number, isActiveValue: unknown) {
  if (!id) return json({ ok: false, message: 'Сотрудник не найден.' }, { status: 404 });
  const employee = await db.prepare(
    'SELECT id, name, is_active FROM managers WHERE id = ?'
  ).bind(id).first<Record<string, unknown>>();
  if (!employee) return json({ ok: false, message: 'Сотрудник не найден.' }, { status: 404 });

  const isActive = isActiveValue === true || Number(isActiveValue) === 1 ? 1 : 0;
  const now = new Date().toISOString();
  await db.prepare(
    `UPDATE managers
     SET is_active = ?, dismissed_at = CASE WHEN ? = 1 THEN NULL ELSE ? END, updated_at = ?
     WHERE id = ?`
  ).bind(isActive, isActive, now.slice(0, 10), now, id).run();

  await writeActivityLog(db, {
    eventType: isActive ? 'team_employee_restored' : 'team_employee_dismissed',
    entityType: 'team_employee',
    entityId: id,
    title: `${isActive ? 'Возвращён в команду' : 'Уволен сотрудник'} ${cleanText(employee.name)}`,
    details: isActive
      ? 'Сотрудник снова доступен для новых заказов и рабочих назначений.'
      : 'Сотрудник отключён для новых заказов и назначений. Исторические связи сохранены.',
  });

  return json({
    ok: true,
    id,
    isActive: Boolean(isActive),
    message: isActive
      ? `${cleanText(employee.name)} снова доступен в команде.`
      : `${cleanText(employee.name)} перенесён в бывшие сотрудники. История сохранена.`,
  });
}


export async function deleteTeamEmployee(db: D1Database, id: number) {
  if (!id) return json({ ok: false, message: 'Сотрудник не найден.' }, { status: 404 });
  const employee = await db.prepare('SELECT id, name FROM managers WHERE id = ?').bind(id).first<any>();
  if (!employee) return json({ ok: false, message: 'Сотрудник не найден.' }, { status: 404 });

  const references = await countTeamEmployeeReferences(db, id);
  if (references > 0) {
    return json({
      ok: false,
      message: `Удаление недоступно: у ${cleanText(employee.name)} есть история (${references} связанных записей). Используйте «Уволить».`,
    }, { status: 409 });
  }

  await db.prepare('DELETE FROM managers WHERE id = ?').bind(id).run();
  await writeActivityLog(db, {
    eventType: 'team_employee_deleted',
    entityType: 'team_employee',
    entityId: id,
    title: `Удалён сотрудник ${cleanText(employee.name)}`,
    details: 'Удалена ошибочно созданная запись без истории',
  });
  return json({ ok: true, id, message: 'Ошибочная запись сотрудника удалена.' });
}


export async function listLeadRecords(db: D1Database, url: URL) {
  const { startDate, endDate } = parseReportDateRange(url);
  const result = await db.prepare(
    `SELECT lr.id, lr.lead_date, lr.manager_id, m.name AS manager, COALESCE(m.color_key, '#475569') AS manager_color,
            lr.accepted_count, lr.bad_count,
            MAX(0, lr.accepted_count - lr.bad_count) AS qualified_count,
            COALESCE((SELECT COUNT(*) FROM orders o WHERE o.manager_id = lr.manager_id AND o.order_date = lr.lead_date AND o.order_status <> 'deleted'), 0) AS sales_count,
            COALESCE(lr.comment, '') AS comment,
            lr.created_at, lr.updated_at
     FROM lead_records lr
     JOIN managers m ON m.id = lr.manager_id
     WHERE lr.lead_date BETWEEN ? AND ?
     ORDER BY lr.lead_date DESC, m.name ASC`
  ).bind(startDate, endDate).all<any>();

  const rows = mapSqlRows(result).map((row: any) => {
    const accepted = toInt(row.accepted_count, 0);
    const bad = toInt(row.bad_count, 0);
    const qualified = Math.max(0, accepted - bad);
    const sales = toInt(row.sales_count, 0);
    return {
      id: Number(row.id || 0),
      date: cleanText(row.lead_date),
      managerId: toInt(row.manager_id, 0),
      manager: cleanText(row.manager),
      managerColor: normalizeManagerColor(row.manager_color, toInt(row.manager_id, 0) - 1),
      acceptedCount: accepted,
      badCount: bad,
      qualifiedCount: qualified,
      salesCount: sales,
      conversionRate: qualified > 0 ? sales / qualified : 0,
      comment: cleanText(row.comment),
      createdAt: cleanText(row.created_at),
      updatedAt: cleanText(row.updated_at),
    };
  });

  return {
    ok: true,
    startDate,
    endDate,
    rows,
    totals: rows.reduce((acc, row) => {
      acc.acceptedCount += row.acceptedCount;
      acc.badCount += row.badCount;
      acc.qualifiedCount += row.qualifiedCount;
      acc.salesCount += row.salesCount;
      return acc;
    }, { acceptedCount: 0, badCount: 0, qualifiedCount: 0, salesCount: 0 }),
  };
}


export async function saveLeadRecord(db: D1Database, input: LeadInput) {
  const id = toInt(input.id, 0);
  const date = normalizeDate(input.date || new Date().toISOString());
  const managerName = upperText(input.managerName);
  const managerId = await resolveActiveManagerId(db, input.managerId, managerName);
  if (!managerId) throw new Error('Выберите менеджера для лидов.');
  const accepted = Math.max(0, toInt(input.acceptedCount, 0));
  const bad = Math.max(0, toInt(input.badCount, 0));
  const comment = cleanText(input.comment);
  const now = new Date().toISOString();

  if (id > 0) {
    await db.prepare(
      `UPDATE lead_records
       SET lead_date = ?, manager_id = ?, accepted_count = ?, bad_count = ?, comment = ?, updated_at = ?
       WHERE id = ?`
    ).bind(date, managerId, accepted, bad, comment || null, now, id).run();
  } else {
    await db.prepare(
      `INSERT INTO lead_records (lead_date, manager_id, accepted_count, bad_count, comment, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(lead_date, manager_id) DO UPDATE SET
         accepted_count = excluded.accepted_count,
         bad_count = excluded.bad_count,
         comment = excluded.comment,
         updated_at = excluded.updated_at`
    ).bind(date, managerId, accepted, bad, comment || null, now, now).run();
  }

  const row = id > 0
    ? await db.prepare('SELECT id FROM lead_records WHERE id = ?').bind(id).first<any>()
    : await db.prepare('SELECT id FROM lead_records WHERE lead_date = ? AND manager_id = ?').bind(date, managerId).first<any>();
  await writeActivityLog(db, {
    eventType: 'lead_saved',
    entityType: 'lead_record',
    entityId: Number(row?.id || 0) || null,
    title: `Сохранены лиды: ${date} — ${managerName}`,
    details: `Принято: ${accepted}; неквал: ${bad}${comment ? `; ${comment}` : ''}`,
  });

  return { ok: true, id: Number(row?.id || 0), date, managerName };
}


export async function listCallCentreRecords(db: D1Database, url: URL) {
  const { startDate, endDate } = parseReportDateRange(url);
  const result = await db.prepare(
    `SELECT ccr.id, ccr.record_date, ccr.manager_id, m.name AS manager, COALESCE(m.color_key, '#475569') AS manager_color,
            ccr.accepted_leads, ccr.calls_made, ccr.calls_accepted,
            ccr.fake_count, ccr.refusal_count, ccr.potential_count,
            COALESCE(ccr.comment, '') AS comment,
            ccr.created_at, ccr.updated_at
     FROM call_centre_records ccr
     JOIN managers m ON m.id = ccr.manager_id
     WHERE ccr.record_date BETWEEN ? AND ?
     ORDER BY ccr.record_date DESC, m.name ASC`
  ).bind(startDate, endDate).all<any>();

  const rows = mapSqlRows(result).map((row: any) => {
    const callsMade = toInt(row.calls_made, 0);
    const callsAccepted = toInt(row.calls_accepted, 0);
    return {
      id: Number(row.id || 0),
      date: cleanText(row.record_date),
      managerId: toInt(row.manager_id, 0),
      manager: cleanText(row.manager),
      managerColor: normalizeManagerColor(row.manager_color, toInt(row.manager_id, 0) - 1),
      acceptedLeads: toInt(row.accepted_leads, 0),
      callsMade,
      callsAccepted,
      fakeCount: toInt(row.fake_count, 0),
      refusalCount: toInt(row.refusal_count, 0),
      potentialCount: toInt(row.potential_count, 0),
      callAcceptanceRate: callsMade > 0 ? callsAccepted / callsMade : 0,
      comment: cleanText(row.comment),
      createdAt: cleanText(row.created_at),
      updatedAt: cleanText(row.updated_at),
    };
  });

  return {
    ok: true,
    startDate,
    endDate,
    rows,
    totals: rows.reduce((acc, row) => {
      acc.acceptedLeads += row.acceptedLeads;
      acc.callsMade += row.callsMade;
      acc.callsAccepted += row.callsAccepted;
      acc.fakeCount += row.fakeCount;
      acc.refusalCount += row.refusalCount;
      acc.potentialCount += row.potentialCount;
      return acc;
    }, { acceptedLeads: 0, callsMade: 0, callsAccepted: 0, fakeCount: 0, refusalCount: 0, potentialCount: 0 }),
  };
}


export async function saveCallCentreRecord(db: D1Database, input: CallCentreInput) {
  const id = toInt(input.id, 0);
  const date = normalizeDate(input.date || new Date().toISOString());
  const managerName = upperText(input.managerName);
  const managerId = await resolveActiveManagerId(db, input.managerId, managerName);
  if (!managerId) throw new Error('Выберите менеджера для Call Centre.');
  const now = new Date().toISOString();
  const acceptedLeads = Math.max(0, toInt(input.acceptedLeads, 0));
  const callsMade = Math.max(0, toInt(input.callsMade, 0));
  const callsAccepted = Math.max(0, toInt(input.callsAccepted, 0));
  const fakeCount = Math.max(0, toInt(input.fakeCount, 0));
  const refusalCount = Math.max(0, toInt(input.refusalCount, 0));
  const potentialCount = Math.max(0, toInt(input.potentialCount, 0));
  const comment = cleanText(input.comment);

  if (id > 0) {
    await db.prepare(
      `UPDATE call_centre_records
       SET record_date = ?, manager_id = ?, accepted_leads = ?, calls_made = ?, calls_accepted = ?, fake_count = ?, refusal_count = ?, potential_count = ?, comment = ?, updated_at = ?
       WHERE id = ?`
    ).bind(date, managerId, acceptedLeads, callsMade, callsAccepted, fakeCount, refusalCount, potentialCount, comment || null, now, id).run();
  } else {
    await db.prepare(
      `INSERT INTO call_centre_records (
         record_date, manager_id, accepted_leads, calls_made, calls_accepted,
         fake_count, refusal_count, potential_count, comment, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(record_date, manager_id) DO UPDATE SET
         accepted_leads = excluded.accepted_leads,
         calls_made = excluded.calls_made,
         calls_accepted = excluded.calls_accepted,
         fake_count = excluded.fake_count,
         refusal_count = excluded.refusal_count,
         potential_count = excluded.potential_count,
         comment = excluded.comment,
         updated_at = excluded.updated_at`
    ).bind(date, managerId, acceptedLeads, callsMade, callsAccepted, fakeCount, refusalCount, potentialCount, comment || null, now, now).run();
  }

  const row = id > 0
    ? await db.prepare('SELECT id FROM call_centre_records WHERE id = ?').bind(id).first<any>()
    : await db.prepare('SELECT id FROM call_centre_records WHERE record_date = ? AND manager_id = ?').bind(date, managerId).first<any>();
  await writeActivityLog(db, {
    eventType: 'call_centre_saved',
    entityType: 'call_centre_record',
    entityId: Number(row?.id || 0) || null,
    title: `Сохранён Call Centre: ${date} — ${managerName}`,
    details: `Лиды: ${acceptedLeads}; звонки: ${callsMade}/${callsAccepted}; потенциалы: ${potentialCount}`,
  });

  return { ok: true, id: Number(row?.id || 0), date, managerName };
}


export async function listPlans(db: D1Database, url: URL) {
  const { startDate, endDate } = parseReportDateRange(url);
  const managerPlans = await db.prepare(
    `SELECT p.id, p.period_start, p.period_end, p.manager_id, m.name AS manager, COALESCE(m.color_key, '#475569') AS manager_color,
            p.planned_amount, p.salary_base, COALESCE(p.bonus_hit_percent, 0) AS bonus_hit_percent,
            COALESCE(p.bonus_miss_percent, 0) AS bonus_miss_percent,
            COALESCE(p.bonus_amount, 0) AS stored_bonus_amount,
            COALESCE(p.total_salary, 0) AS stored_total_salary,
            COALESCE(p.comment, '') AS comment,
            COALESCE((SELECT SUM(pay.amount) FROM payments pay JOIN orders o ON o.id = pay.order_id WHERE o.manager_id = p.manager_id AND pay.payment_date BETWEEN p.period_start AND p.period_end AND o.order_status <> 'deleted'), 0)
              - COALESCE((SELECT SUM(r.amount) FROM returns r JOIN orders o ON o.id = r.order_id WHERE COALESCE(r.manager_id, o.manager_id) = p.manager_id AND r.return_date BETWEEN p.period_start AND p.period_end AND COALESCE(r.status, 'completed') <> 'cancelled' AND o.order_status <> 'deleted'), 0) AS fact_amount,
            COALESCE((SELECT SUM(r.amount) FROM returns r JOIN orders o ON o.id = r.order_id WHERE COALESCE(r.manager_id, o.manager_id) = p.manager_id AND r.return_date BETWEEN p.period_start AND p.period_end AND COALESCE(r.status, 'completed') <> 'cancelled' AND o.order_status <> 'deleted'), 0) AS return_amount
     FROM plans p
     JOIN managers m ON m.id = p.manager_id
     WHERE p.period_end >= ? AND p.period_start <= ?
     ORDER BY p.period_start DESC, m.name ASC`
  ).bind(startDate, endDate).all<any>();

  const departmentPlans = await db.prepare(
    `SELECT dp.id, dp.period_start, dp.period_end, dp.planned_amount, COALESCE(dp.comment, '') AS comment,
            COALESCE((SELECT SUM(pay.amount) FROM payments pay JOIN orders o ON o.id = pay.order_id WHERE pay.payment_date BETWEEN dp.period_start AND dp.period_end AND o.order_status <> 'deleted'), 0)
              - COALESCE((SELECT SUM(r.amount) FROM returns r JOIN orders o ON o.id = r.order_id WHERE r.return_date BETWEEN dp.period_start AND dp.period_end AND COALESCE(r.status, 'completed') <> 'cancelled' AND o.order_status <> 'deleted'), 0) AS fact_amount,
            COALESCE((SELECT SUM(r.amount) FROM returns r JOIN orders o ON o.id = r.order_id WHERE r.return_date BETWEEN dp.period_start AND dp.period_end AND COALESCE(r.status, 'completed') <> 'cancelled' AND o.order_status <> 'deleted'), 0) AS return_amount
     FROM department_plans dp
     WHERE dp.period_end >= ? AND dp.period_start <= ?
     ORDER BY dp.period_start DESC, dp.id DESC`
  ).bind(startDate, endDate).all<any>();

  const managerRows = mapSqlRows(managerPlans).map((row: any) => {
    const planned = toInt(row.planned_amount, 0);
    const fact = toInt(row.fact_amount, 0);
    return {
      id: Number(row.id || 0),
      periodStart: cleanText(row.period_start),
      periodEnd: cleanText(row.period_end),
      managerId: toInt(row.manager_id, 0),
      manager: cleanText(row.manager),
      managerColor: normalizeManagerColor(row.manager_color, toInt(row.manager_id, 0) - 1),
      plannedAmount: planned,
      salaryBase: toInt(row.salary_base, 0),
      bonusHitPercent: 5,
      bonusMissPercent: 3,
      factAmount: Math.max(0, fact),
      returnAmount: toInt(row.return_amount, 0),
      completionRate: planned > 0 ? Math.max(0, fact) / planned : 0,
      bonusAmount: Math.max(0, Math.round(Math.max(0, fact) * ((planned > 0 && Math.max(0, fact) >= planned ? 5 : 3) / 100))),
      totalSalary: toInt(row.salary_base, 100000) + Math.max(0, Math.round(Math.max(0, fact) * ((planned > 0 && Math.max(0, fact) >= planned ? 5 : 3) / 100))),
      comment: cleanText(row.comment),
    };
  });

  const departmentRows = mapSqlRows(departmentPlans).map((row: any) => {
    const planned = toInt(row.planned_amount, 0);
    const fact = toInt(row.fact_amount, 0);
    return {
      id: Number(row.id || 0),
      periodStart: cleanText(row.period_start),
      periodEnd: cleanText(row.period_end),
      plannedAmount: planned,
      factAmount: fact,
      returnAmount: toInt(row.return_amount, 0),
      completionRate: planned > 0 ? fact / planned : 0,
      comment: cleanText(row.comment),
    };
  });

  return { ok: true, startDate, endDate, managerPlans: managerRows, departmentPlans: departmentRows };
}


export async function saveManagerPlan(db: D1Database, input: PlanInput) {
  const id = toInt(input.id, 0);
  const periodStart = normalizeDate(input.periodStart || new Date().toISOString());
  const periodEnd = normalizeDate(input.periodEnd || periodStart);
  if (periodStart > periodEnd) throw new Error('Начало плана не может быть позже конца.');
  const managerName = upperText(input.managerName);
  const managerId = await resolveActiveManagerId(db, input.managerId, managerName);
  if (!managerId) throw new Error('Выберите менеджера для плана.');
  const plannedAmount = Math.max(0, toInt(input.plannedAmount, 0));
  const salaryBase = Math.max(0, toInt(input.salaryBase, 100000)) || 100000;
  const bonusHitPercent = 5;
  const bonusMissPercent = 3;
  const comment = cleanText(input.comment);
  const now = new Date().toISOString();

  const existing = id > 0
    ? await db.prepare('SELECT id FROM plans WHERE id = ?').bind(id).first<any>()
    : await db.prepare('SELECT id FROM plans WHERE manager_id = ? AND period_start = ? AND period_end = ?')
      .bind(managerId, periodStart, periodEnd).first<any>();

  if (existing?.id) {
    await db.prepare(
      `UPDATE plans SET planned_amount = ?, salary_base = ?, bonus_hit_percent = ?, bonus_miss_percent = ?, comment = ?, updated_at = ? WHERE id = ?`
    ).bind(plannedAmount, salaryBase, bonusHitPercent, bonusMissPercent, comment || null, now, Number(existing.id)).run();
  } else {
    await db.prepare(
      `INSERT INTO plans (manager_id, period_start, period_end, planned_amount, salary_base, bonus_hit_percent, bonus_miss_percent, comment, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(managerId, periodStart, periodEnd, plannedAmount, salaryBase, bonusHitPercent, bonusMissPercent, comment || null, now, now).run();
  }

  const row = await db.prepare('SELECT id FROM plans WHERE manager_id = ? AND period_start = ? AND period_end = ?')
    .bind(managerId, periodStart, periodEnd).first<any>();
  await writeActivityLog(db, {
    eventType: 'manager_plan_saved',
    entityType: 'manager_plan',
    entityId: Number(row?.id || 0) || null,
    title: `Сохранён план менеджера ${managerName}`,
    details: `${periodStart} — ${periodEnd}; оклад ${salaryBase}; бонусы ${bonusHitPercent}% / ${bonusMissPercent}%`,
    amount: plannedAmount,
  });

  return { ok: true, id: Number(row?.id || 0), periodStart, periodEnd, managerName };
}


export async function saveDepartmentPlan(db: D1Database, input: DepartmentPlanInput) {
  const id = toInt(input.id, 0);
  const periodStart = normalizeDate(input.periodStart || new Date().toISOString());
  const periodEnd = normalizeDate(input.periodEnd || periodStart);
  if (periodStart > periodEnd) throw new Error('Начало плана отдела не может быть позже конца.');
  const plannedAmount = Math.max(0, toInt(input.plannedAmount, 0));
  const comment = cleanText(input.comment);
  const now = new Date().toISOString();

  if (id > 0) {
    await db.prepare(
      `UPDATE department_plans SET period_start = ?, period_end = ?, planned_amount = ?, comment = ?, updated_at = ? WHERE id = ?`
    ).bind(periodStart, periodEnd, plannedAmount, comment || null, now, id).run();
  } else {
    await db.prepare(
      `INSERT INTO department_plans (period_start, period_end, planned_amount, comment, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(period_start, period_end) DO UPDATE SET
         planned_amount = excluded.planned_amount,
         comment = excluded.comment,
         updated_at = excluded.updated_at`
    ).bind(periodStart, periodEnd, plannedAmount, comment || null, now, now).run();
  }

  const row = id > 0
    ? await db.prepare('SELECT id FROM department_plans WHERE id = ?').bind(id).first<any>()
    : await db.prepare('SELECT id FROM department_plans WHERE period_start = ? AND period_end = ?')
      .bind(periodStart, periodEnd).first<any>();
  await writeActivityLog(db, {
    eventType: 'department_plan_saved',
    entityType: 'department_plan',
    entityId: Number(row?.id || 0) || null,
    title: 'Сохранён план отдела',
    details: `${periodStart} — ${periodEnd}`,
    amount: plannedAmount,
  });

  return { ok: true, id: Number(row?.id || 0), periodStart, periodEnd };
}



export async function listTeamTimesheet(db: D1Database, url: URL) {
  const month = normalizeMonthParam(url.searchParams.get('month'));
  const { startDate, endDate } = getMonthRange(month);
  const [employeesResult, entriesResult] = await Promise.all([
    db.prepare(
      `SELECT id, name, COALESCE(role, '') AS role, is_active, COALESCE(color_key, '#475569') AS color_key, COALESCE(hired_at, substr(created_at, 1, 10)) AS hired_at
       FROM managers
       WHERE is_active = 1
         AND UPPER(COALESCE(name, '')) NOT LIKE '%СЫМБАТ%'
         AND UPPER(COALESCE(role, '')) NOT LIKE '%АДМИН%'
       ORDER BY name ASC`
    ).all<any>(),
    db.prepare(
      `SELECT tt.id, tt.work_date, tt.manager_id, m.name AS manager, COALESCE(m.color_key, '#475569') AS manager_color,
              COALESCE(tt.work_until, '') AS work_until,
              COALESCE(tt.comment, '') AS comment,
              tt.created_at, tt.updated_at
       FROM team_timesheet tt
       JOIN managers m ON m.id = tt.manager_id
       WHERE tt.work_date BETWEEN ? AND ?
         AND UPPER(COALESCE(m.name, '')) NOT LIKE '%СЫМБАТ%'
         AND UPPER(COALESCE(m.role, '')) NOT LIKE '%АДМИН%'
       ORDER BY tt.work_date ASC, m.name ASC`
    ).bind(startDate, endDate).all<any>(),
  ]);

  return {
    ok: true,
    month,
    startDate,
    endDate,
    employees: mapSqlRows(employeesResult).map((row: any) => ({
      id: Number(row.id || 0),
      name: cleanText(row.name),
      role: cleanText(row.role),
      isActive: Boolean(row.is_active),
      colorKey: normalizeManagerColor(row.color_key, Number(row.id || 0) - 1),
      hiredAt: cleanText(row.hired_at),
    })),
    entries: mapSqlRows(entriesResult).map((row: any) => ({
      id: Number(row.id || 0),
      date: cleanText(row.work_date),
      managerId: Number(row.manager_id || 0),
      manager: cleanText(row.manager),
      managerColor: normalizeManagerColor(row.manager_color, Number(row.manager_id || 0) - 1),
      workUntil: cleanText(row.work_until),
      comment: cleanText(row.comment),
      createdAt: cleanText(row.created_at),
      updatedAt: cleanText(row.updated_at),
    })),
  };
}


export async function saveTeamTimesheet(db: D1Database, input: TimesheetInput) {
  const rawDates = Array.isArray(input.dates) ? input.dates : [];
  const dates = Array.from(new Set(rawDates.map(value => normalizeDate(value)).filter(Boolean)));
  const rawManagerIds = Array.isArray(input.managerIds) ? input.managerIds : [];
  const managerIds = Array.from(new Set(rawManagerIds.map(value => toInt(value, 0)).filter(id => id > 0)));
  const shouldClear = Boolean(input.clear);
  if (!dates.length) throw new Error('Выберите дни табеля.');
  if (!shouldClear && !managerIds.length) throw new Error('Выберите сотрудников.');

  const allowedResult = await db.prepare(
    `SELECT id
     FROM managers
     WHERE is_active = 1
       AND UPPER(COALESCE(name, '')) NOT LIKE '%СЫМБАТ%'
       AND UPPER(COALESCE(role, '')) NOT LIKE '%АДМИН%'`
  ).all<any>();
  const allowedIds = new Set(mapSqlRows(allowedResult).map((row: any) => Number(row.id || 0)).filter(Boolean));
  const safeManagerIds = managerIds.filter(id => allowedIds.has(id));
  if (!shouldClear && !safeManagerIds.length) throw new Error('В табель можно назначать только обычных активных сотрудников.');

  const workUntil = cleanText(input.workUntil);
  const comment = cleanText(input.comment);
  const now = new Date().toISOString();
  const datesJson = JSON.stringify(dates);
  const managerIdsJson = JSON.stringify(safeManagerIds);

  // Step 190.2: one calendar action must not turn employee × day into hundreds of D1 statements.
  if (shouldClear) {
    if (safeManagerIds.length) {
      await db.prepare(
        `DELETE FROM team_timesheet
         WHERE work_date IN (SELECT CAST(value AS TEXT) FROM json_each(?))
           AND manager_id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))`
      ).bind(datesJson, managerIdsJson).run();
    } else {
      await db.prepare(
        `DELETE FROM team_timesheet
         WHERE work_date IN (SELECT CAST(value AS TEXT) FROM json_each(?))`
      ).bind(datesJson).run();
    }
  } else {
    await db.prepare(
      `INSERT INTO team_timesheet (work_date, manager_id, work_until, comment, created_at, updated_at)
       SELECT CAST(d.value AS TEXT), CAST(m.value AS INTEGER), ?, ?, ?, ?
       FROM json_each(?) d
       CROSS JOIN json_each(?) m
       WHERE 1
       ON CONFLICT(work_date, manager_id) DO UPDATE SET
         work_until = excluded.work_until,
         comment = excluded.comment,
         updated_at = excluded.updated_at`
    ).bind(workUntil || null, comment || null, now, now, datesJson, managerIdsJson).run();
  }

  await writeActivityLog(db, {
    eventType: shouldClear ? 'timesheet_cleared' : 'timesheet_saved',
    entityType: 'team_timesheet',
    title: shouldClear ? 'Очищен табель' : 'Сохранён табель',
    details: `Дней: ${dates.length}; сотрудников: ${safeManagerIds.length}${workUntil ? `; до ${workUntil}` : ''}`,
  });

  return { ok: true, dates: dates.length, managers: safeManagerIds.length, cleared: shouldClear };
}


export function normalizeTeamActivityType(value: unknown) {
  const text = cleanText(value).toLowerCase();
  if (['orders', 'order', 'заказы'].includes(text)) return 'orders';
  if (['debt', 'debts', 'долги'].includes(text)) return 'debt';
  if (['payments', 'payment', 'оплаты'].includes(text)) return 'payments';
  if (['returns', 'return', 'возвраты'].includes(text)) return 'returns';
  if (['exchanges', 'exchange', 'обмены'].includes(text)) return 'exchanges';
  return 'all';
}


export async function listTeamActivity(db: D1Database, url: URL) {
  const { startDate, endDate } = parseReportDateRange(url);
  const actionType = normalizeTeamActivityType(url.searchParams.get('actionType'));
  const query = upperText(url.searchParams.get('q'));
  const limit = Math.min(100, Math.max(20, toInt(url.searchParams.get('limit'), 50)));
  const offset = Math.max(0, toInt(url.searchParams.get('offset'), 0));
  const fetchLimit = offset + limit;

  // Step 189D.1 Rev 2: D1 rejected the old compound activity report in production.
  // Keep each business source as its own small SELECT, then merge the already
  // normalized rows and manager aggregates in the Worker. This is deliberately
  // boring: no compound SELECT, no temporary table, and no write-side state.
  const rowStatements: D1PreparedStatement[] = [];
  const summaryStatements: D1PreparedStatement[] = [];
  const addDomain = (rowsSql: string, summarySql: string, bindings: unknown[]) => {
    rowStatements.push(db.prepare(rowsSql).bind(...bindings, fetchLimit));
    summaryStatements.push(db.prepare(summarySql).bind(...bindings));
  };
  const searchBindings = (extra: unknown[] = []) => [startDate, endDate, ...extra, query, query];
  const include = (...types: string[]) => actionType === 'all' || types.includes(actionType);

  if (include('orders')) {
    const where = `o.order_date BETWEEN ? AND ?
       AND o.order_status <> 'deleted'
       AND (? = '' OR INSTR(UPPER(COALESCE(m.name, o.manager_snapshot_name, '') || ' ' || COALESCE(o.external_id, '') || ' ЗАКАЗ СОЗДАН ' || COALESCE(o.city, '') || ' ' || COALESCE(o.comment, '')), ?) > 0)`;
    addDomain(
      `SELECT
         'order_created' AS action_type,
         o.id AS action_id,
         COALESCE(NULLIF(o.created_at, ''), o.order_date || 'T12:00:00.000Z') AS action_at,
         o.order_date AS action_date,
         o.id AS order_id,
         o.external_id,
         COALESCE(m.id, 0) AS manager_id,
         COALESCE(m.name, o.manager_snapshot_name, '') AS manager,
         COALESCE(m.color_key, '#475569') AS manager_color,
         COALESCE(m.role, '') AS role,
         'Заказ создан' AS title,
         COALESCE(o.total_amount, 0) AS amount,
         COALESCE(o.city, '') || CASE WHEN COALESCE(o.comment, '') = '' THEN '' ELSE ' · ' || o.comment END AS details
       FROM orders o
       LEFT JOIN managers m ON m.id = o.manager_id
       WHERE ${where}
       ORDER BY action_at DESC, action_id DESC
       LIMIT ?`,
      `SELECT
         COALESCE(m.id, 0) AS manager_id,
         COALESCE(m.name, o.manager_snapshot_name, '') AS manager,
         COALESCE(m.color_key, '#475569') AS manager_color,
         COALESCE(m.role, '') AS role,
         COUNT(*) AS orders,
         0 AS debt_closed,
         0 AS payments,
         0 AS returns,
         0 AS exchanges,
         COUNT(*) AS total_actions,
         COALESCE(SUM(o.total_amount), 0) AS total_amount
       FROM orders o
       LEFT JOIN managers m ON m.id = o.manager_id
       WHERE ${where}
       GROUP BY COALESCE(m.id, 0), COALESCE(m.name, o.manager_snapshot_name, ''), COALESCE(m.color_key, '#475569'), COALESCE(m.role, '')`,
      searchBindings(),
    );
  }

  if (include('debt', 'payments')) {
    const moneyTypeWhere = actionType === 'debt'
      ? `fe.event_type = 'debt_close'`
      : actionType === 'payments'
        ? `fe.event_type IN ('order_payment', 'order_extra', 'exchange_extra')`
        : `fe.event_type IN ('order_payment', 'order_extra', 'exchange_extra', 'debt_close')`;
    const where = `fe.event_date BETWEEN ? AND ?
       AND fe.amount_delta > 0
       AND ${moneyTypeWhere}
       AND (? = '' OR INSTR(UPPER(COALESCE(m.name, o.manager_snapshot_name, '') || ' ' || COALESCE(fe.external_order_id, o.external_id, '') || ' ' || CASE WHEN fe.event_type = 'debt_close' THEN 'ДОЛГ ЗАКРЫТ' ELSE 'ОПЛАТА' END || ' ' || COALESCE(fe.payment_method, '') || ' ' || COALESCE(fe.comment, '')), ?) > 0)`;
    addDomain(
      `SELECT
         CASE WHEN fe.event_type = 'debt_close' THEN 'debt_closed' ELSE 'payment_added' END AS action_type,
         fe.id AS action_id,
         fe.event_at AS action_at,
         fe.event_date AS action_date,
         o.id AS order_id,
         COALESCE(fe.external_order_id, o.external_id) AS external_id,
         COALESCE(m.id, 0) AS manager_id,
         COALESCE(m.name, o.manager_snapshot_name, '') AS manager,
         COALESCE(m.color_key, '#475569') AS manager_color,
         COALESCE(m.role, '') AS role,
         CASE WHEN fe.event_type = 'debt_close' THEN 'Долг закрыт' ELSE 'Оплата' END AS title,
         COALESCE(fe.amount_delta, 0) AS amount,
         COALESCE(fe.payment_method, '') || CASE WHEN COALESCE(fe.comment, '') = '' THEN '' ELSE ' · ' || fe.comment END AS details
       FROM financial_events fe
       JOIN orders o ON o.id = fe.order_id
       LEFT JOIN managers m ON m.id = o.manager_id
       WHERE ${where}
       ORDER BY action_at DESC, action_id DESC
       LIMIT ?`,
      `SELECT
         COALESCE(m.id, 0) AS manager_id,
         COALESCE(m.name, o.manager_snapshot_name, '') AS manager,
         COALESCE(m.color_key, '#475569') AS manager_color,
         COALESCE(m.role, '') AS role,
         0 AS orders,
         SUM(CASE WHEN fe.event_type = 'debt_close' THEN 1 ELSE 0 END) AS debt_closed,
         SUM(CASE WHEN fe.event_type <> 'debt_close' THEN 1 ELSE 0 END) AS payments,
         0 AS returns,
         0 AS exchanges,
         COUNT(*) AS total_actions,
         COALESCE(SUM(fe.amount_delta), 0) AS total_amount
       FROM financial_events fe
       JOIN orders o ON o.id = fe.order_id
       LEFT JOIN managers m ON m.id = o.manager_id
       WHERE ${where}
       GROUP BY COALESCE(m.id, 0), COALESCE(m.name, o.manager_snapshot_name, ''), COALESCE(m.color_key, '#475569'), COALESCE(m.role, '')`,
      searchBindings(),
    );
  }

  if (include('returns')) {
    const createdWhere = `r.return_date BETWEEN ? AND ?
       AND (? = '' OR INSTR(UPPER(COALESCE(m.name, o.manager_snapshot_name, '') || ' ' || COALESCE(o.external_id, '') || ' ВОЗВРАТ ОФОРМЛЕН ' || COALESCE(r.comment, '')), ?) > 0)`;
    addDomain(
      `SELECT
         'return_created' AS action_type,
         r.id AS action_id,
         COALESCE(NULLIF(r.created_at, ''), r.return_date || 'T12:00:00.000Z') AS action_at,
         r.return_date AS action_date,
         o.id AS order_id,
         o.external_id,
         COALESCE(m.id, 0) AS manager_id,
         COALESCE(m.name, o.manager_snapshot_name, '') AS manager,
         COALESCE(m.color_key, '#475569') AS manager_color,
         COALESCE(m.role, '') AS role,
         'Возврат оформлен' AS title,
         COALESCE(r.amount, 0) AS amount,
         COALESCE(r.comment, '') AS details
       FROM returns r
       JOIN orders o ON o.id = r.order_id
       LEFT JOIN managers m ON m.id = COALESCE(r.manager_id, o.manager_id)
       WHERE ${createdWhere}
       ORDER BY action_at DESC, action_id DESC
       LIMIT ?`,
      `SELECT
         COALESCE(m.id, 0) AS manager_id,
         COALESCE(m.name, o.manager_snapshot_name, '') AS manager,
         COALESCE(m.color_key, '#475569') AS manager_color,
         COALESCE(m.role, '') AS role,
         0 AS orders,
         0 AS debt_closed,
         0 AS payments,
         COUNT(*) AS returns,
         0 AS exchanges,
         COUNT(*) AS total_actions,
         COALESCE(SUM(r.amount), 0) AS total_amount
       FROM returns r
       JOIN orders o ON o.id = r.order_id
       LEFT JOIN managers m ON m.id = COALESCE(r.manager_id, o.manager_id)
       WHERE ${createdWhere}
       GROUP BY COALESCE(m.id, 0), COALESCE(m.name, o.manager_snapshot_name, ''), COALESCE(m.color_key, '#475569'), COALESCE(m.role, '')`,
      searchBindings(),
    );

    const cancelledWhere = `COALESCE(r.status, 'completed') = 'cancelled'
       AND substr(COALESCE(NULLIF(r.cancelled_at, ''), r.return_date), 1, 10) BETWEEN ? AND ?
       AND (? = '' OR INSTR(UPPER(COALESCE(m.name, o.manager_snapshot_name, '') || ' ' || COALESCE(o.external_id, '') || ' ВОЗВРАТ ОТМЕНЁН ' || COALESCE(r.cancellation_comment, '')), ?) > 0)`;
    addDomain(
      `SELECT
         'return_cancelled' AS action_type,
         r.id AS action_id,
         COALESCE(NULLIF(r.cancelled_at, ''), NULLIF(r.created_at, ''), r.return_date || 'T12:00:00.000Z') AS action_at,
         substr(COALESCE(NULLIF(r.cancelled_at, ''), r.return_date), 1, 10) AS action_date,
         o.id AS order_id,
         o.external_id,
         COALESCE(m.id, 0) AS manager_id,
         COALESCE(m.name, o.manager_snapshot_name, '') AS manager,
         COALESCE(m.color_key, '#475569') AS manager_color,
         COALESCE(m.role, '') AS role,
         'Возврат отменён' AS title,
         COALESCE(r.amount, 0) AS amount,
         COALESCE(r.cancellation_comment, '') AS details
       FROM returns r
       JOIN orders o ON o.id = r.order_id
       LEFT JOIN managers m ON m.id = COALESCE(r.manager_id, o.manager_id)
       WHERE ${cancelledWhere}
       ORDER BY action_at DESC, action_id DESC
       LIMIT ?`,
      `SELECT
         COALESCE(m.id, 0) AS manager_id,
         COALESCE(m.name, o.manager_snapshot_name, '') AS manager,
         COALESCE(m.color_key, '#475569') AS manager_color,
         COALESCE(m.role, '') AS role,
         0 AS orders,
         0 AS debt_closed,
         0 AS payments,
         0 AS returns,
         0 AS exchanges,
         COUNT(*) AS total_actions,
         COALESCE(SUM(r.amount), 0) AS total_amount
       FROM returns r
       JOIN orders o ON o.id = r.order_id
       LEFT JOIN managers m ON m.id = COALESCE(r.manager_id, o.manager_id)
       WHERE ${cancelledWhere}
       GROUP BY COALESCE(m.id, 0), COALESCE(m.name, o.manager_snapshot_name, ''), COALESCE(m.color_key, '#475569'), COALESCE(m.role, '')`,
      searchBindings(),
    );
  }

  if (include('exchanges')) {
    const createdWhere = `e.exchange_date BETWEEN ? AND ?
       AND (? = '' OR INSTR(UPPER(COALESCE(m.name, o.manager_snapshot_name, '') || ' ' || COALESCE(o.external_id, '') || ' ОБМЕН ОФОРМЛЕН ' || COALESCE(e.comment, '')), ?) > 0)`;
    addDomain(
      `SELECT
         'exchange_created' AS action_type,
         e.id AS action_id,
         COALESCE(NULLIF(e.created_at, ''), e.exchange_date || 'T12:00:00.000Z') AS action_at,
         e.exchange_date AS action_date,
         o.id AS order_id,
         o.external_id,
         COALESCE(m.id, 0) AS manager_id,
         COALESCE(m.name, o.manager_snapshot_name, '') AS manager,
         COALESCE(m.color_key, '#475569') AS manager_color,
         COALESCE(m.role, '') AS role,
         'Обмен оформлен' AS title,
         COALESCE(e.financial_amount, 0) AS amount,
         COALESCE(e.comment, '') AS details
       FROM exchanges e
       JOIN orders o ON o.id = e.order_id
       LEFT JOIN managers m ON m.id = COALESCE(e.manager_id, o.manager_id)
       WHERE ${createdWhere}
       ORDER BY action_at DESC, action_id DESC
       LIMIT ?`,
      `SELECT
         COALESCE(m.id, 0) AS manager_id,
         COALESCE(m.name, o.manager_snapshot_name, '') AS manager,
         COALESCE(m.color_key, '#475569') AS manager_color,
         COALESCE(m.role, '') AS role,
         0 AS orders,
         0 AS debt_closed,
         0 AS payments,
         0 AS returns,
         COUNT(*) AS exchanges,
         COUNT(*) AS total_actions,
         COALESCE(SUM(e.financial_amount), 0) AS total_amount
       FROM exchanges e
       JOIN orders o ON o.id = e.order_id
       LEFT JOIN managers m ON m.id = COALESCE(e.manager_id, o.manager_id)
       WHERE ${createdWhere}
       GROUP BY COALESCE(m.id, 0), COALESCE(m.name, o.manager_snapshot_name, ''), COALESCE(m.color_key, '#475569'), COALESCE(m.role, '')`,
      searchBindings(),
    );

    const cancelledWhere = `COALESCE(e.status, 'completed') = 'cancelled'
       AND substr(COALESCE(NULLIF(e.cancelled_at, ''), e.exchange_date), 1, 10) BETWEEN ? AND ?
       AND (? = '' OR INSTR(UPPER(COALESCE(m.name, o.manager_snapshot_name, '') || ' ' || COALESCE(o.external_id, '') || ' ОБМЕН ОТМЕНЁН ' || COALESCE(e.cancellation_comment, '')), ?) > 0)`;
    addDomain(
      `SELECT
         'exchange_cancelled' AS action_type,
         e.id AS action_id,
         COALESCE(NULLIF(e.cancelled_at, ''), NULLIF(e.created_at, ''), e.exchange_date || 'T12:00:00.000Z') AS action_at,
         substr(COALESCE(NULLIF(e.cancelled_at, ''), e.exchange_date), 1, 10) AS action_date,
         o.id AS order_id,
         o.external_id,
         COALESCE(m.id, 0) AS manager_id,
         COALESCE(m.name, o.manager_snapshot_name, '') AS manager,
         COALESCE(m.color_key, '#475569') AS manager_color,
         COALESCE(m.role, '') AS role,
         'Обмен отменён' AS title,
         COALESCE(e.financial_amount, 0) AS amount,
         COALESCE(e.cancellation_comment, '') AS details
       FROM exchanges e
       JOIN orders o ON o.id = e.order_id
       LEFT JOIN managers m ON m.id = COALESCE(e.manager_id, o.manager_id)
       WHERE ${cancelledWhere}
       ORDER BY action_at DESC, action_id DESC
       LIMIT ?`,
      `SELECT
         COALESCE(m.id, 0) AS manager_id,
         COALESCE(m.name, o.manager_snapshot_name, '') AS manager,
         COALESCE(m.color_key, '#475569') AS manager_color,
         COALESCE(m.role, '') AS role,
         0 AS orders,
         0 AS debt_closed,
         0 AS payments,
         0 AS returns,
         0 AS exchanges,
         COUNT(*) AS total_actions,
         COALESCE(SUM(e.financial_amount), 0) AS total_amount
       FROM exchanges e
       JOIN orders o ON o.id = e.order_id
       LEFT JOIN managers m ON m.id = COALESCE(e.manager_id, o.manager_id)
       WHERE ${cancelledWhere}
       GROUP BY COALESCE(m.id, 0), COALESCE(m.name, o.manager_snapshot_name, ''), COALESCE(m.color_key, '#475569'), COALESCE(m.role, '')`,
      searchBindings(),
    );
  }

  const statements = [...rowStatements, ...summaryStatements];
  const results = statements.length ? await db.batch(statements) : [];
  const rawRows: any[] = [];
  for (let index = 0; index < rowStatements.length; index += 1) {
    rawRows.push(...mapSqlRows(results[index] as D1Result<any>));
  }
  rawRows.sort((left: any, right: any) => {
    const leftAt = cleanText(left.action_at);
    const rightAt = cleanText(right.action_at);
    if (leftAt !== rightAt) return leftAt < rightAt ? 1 : -1;
    const leftType = cleanText(left.action_type);
    const rightType = cleanText(right.action_type);
    if (leftType !== rightType) return leftType < rightType ? 1 : -1;
    return Number(right.action_id || 0) - Number(left.action_id || 0);
  });

  const pageRows = rawRows.slice(offset, offset + limit);
  const rows = pageRows.map((row: any) => ({
    id: `${cleanText(row.action_type)}-${Number(row.action_id || 0)}-${cleanText(row.action_at)}`,
    actionType: cleanText(row.action_type),
    actionAt: cleanText(row.action_at),
    actionDate: cleanText(row.action_date),
    orderId: Number(row.order_id || 0),
    externalOrderId: cleanText(row.external_id),
    managerId: Number(row.manager_id || 0),
    manager: cleanText(row.manager) || 'Не указан',
    managerColor: normalizeManagerColor(row.manager_color, Number(row.manager_id || 0) - 1),
    role: cleanText(row.role),
    title: cleanText(row.title),
    amount: toInt(row.amount, 0),
    details: cleanText(row.details),
  }));

  const summaryMap = new Map<string, any>();
  const summaryOffset = rowStatements.length;
  for (let index = 0; index < summaryStatements.length; index += 1) {
    const resultRows = mapSqlRows(results[summaryOffset + index] as D1Result<any>);
    for (const row of resultRows) {
      const managerId = Number(row.manager_id || 0);
      const manager = cleanText(row.manager) || 'Не указан';
      const managerColor = normalizeManagerColor(row.manager_color, managerId - 1);
      const role = cleanText(row.role) || 'Менеджер';
      const key = managerId > 0 ? `id:${managerId}` : `legacy:${manager}|${managerColor}|${role}`;
      const current = summaryMap.get(key) || {
        managerId,
        manager,
        managerColor,
        role,
        orders: 0,
        debtClosed: 0,
        payments: 0,
        returns: 0,
        exchanges: 0,
        totalActions: 0,
        totalAmount: 0,
      };
      current.orders += Math.max(0, toInt(row.orders, 0));
      current.debtClosed += Math.max(0, toInt(row.debt_closed, 0));
      current.payments += Math.max(0, toInt(row.payments, 0));
      current.returns += Math.max(0, toInt(row.returns, 0));
      current.exchanges += Math.max(0, toInt(row.exchanges, 0));
      current.totalActions += Math.max(0, toInt(row.total_actions, 0));
      current.totalAmount += Number(row.total_amount || 0);
      summaryMap.set(key, current);
    }
  }

  const summary = Array.from(summaryMap.values()).sort((left: any, right: any) => {
    if (right.totalActions !== left.totalActions) return right.totalActions - left.totalActions;
    return String(left.manager).localeCompare(String(right.manager), 'ru');
  });
  const totals = summary.reduce((acc, row) => ({
    actions: acc.actions + row.totalActions,
    orders: acc.orders + row.orders,
    debtClosed: acc.debtClosed + row.debtClosed,
    payments: acc.payments + row.payments,
    returns: acc.returns + row.returns,
    exchanges: acc.exchanges + row.exchanges,
  }), { actions: 0, orders: 0, debtClosed: 0, payments: 0, returns: 0, exchanges: 0 });

  return {
    ok: true,
    startDate,
    endDate,
    actionType,
    count: totals.actions,
    offset,
    limit,
    hasMore: offset + rows.length < totals.actions,
    rows,
    summary,
    totals,
  };
}


export async function listTeamSalaryPreview(db: D1Database, url: URL) {
  const { startDate, endDate } = parseReportDateRange(url);
  const planReport = await listPlans(db, url);

  const [employeesResult, timesheetResult, activityResult] = await Promise.all([
    db.prepare(
      `SELECT id, name, COALESCE(role, '') AS role, COALESCE(salary_base, 0) AS salary_base, is_active, COALESCE(color_key, '#475569') AS color_key
       FROM managers
       ORDER BY is_active DESC, name ASC`
    ).all<any>(),
    db.prepare(
      `SELECT m.id AS manager_id, m.name AS manager, COUNT(DISTINCT tt.work_date) AS work_days
       FROM team_timesheet tt
       JOIN managers m ON m.id = tt.manager_id
       WHERE tt.work_date BETWEEN ? AND ?
       GROUP BY m.id, m.name`
    ).bind(startDate, endDate).all<any>(),
    db.prepare(
      `SELECT COALESCE(m.id, 0) AS manager_id, COALESCE(m.name, '') AS manager, COUNT(*) AS actions_count
       FROM activity_log al
       LEFT JOIN orders o ON o.id = al.order_id
       LEFT JOIN managers m ON m.id = o.manager_id
       WHERE al.created_at BETWEEN ? AND ?
       GROUP BY COALESCE(m.id, 0), COALESCE(m.name, '')`
    ).bind(`${startDate}T00:00:00.000Z`, `${endDate}T23:59:59.999Z`).all<any>(),
  ]);

  const workDaysByManager = new Map(mapSqlRows(timesheetResult).map((row: any) => [Number(row.manager_id || 0), Number(row.work_days || 0)]));
  const actionsByManager = new Map(mapSqlRows(activityResult).map((row: any) => [Number(row.manager_id || 0), Number(row.actions_count || 0)]));
  const plansByManager = new Map((planReport.managerPlans || []).map((row: any) => [Number(row.managerId || 0), row]));

  const rows = mapSqlRows(employeesResult).map((employee: any) => {
    const managerId = Number(employee.id || 0);
    const manager = cleanText(employee.name);
    const plan = plansByManager.get(managerId) as any;
    const salaryBase = plan ? Number(plan.salaryBase || 0) : Number(employee.salary_base || 0);
    const bonusAmount = plan ? Number(plan.bonusAmount || 0) : 0;
    return {
      managerId,
      manager,
      managerColor: normalizeManagerColor(employee.color_key, managerId - 1),
      role: cleanText(employee.role) || 'Менеджер',
      isActive: Boolean(employee.is_active),
      workDays: workDaysByManager.get(managerId) || 0,
      actionsCount: actionsByManager.get(managerId) || 0,
      plannedAmount: plan ? Number(plan.plannedAmount || 0) : 0,
      factAmount: plan ? Number(plan.factAmount || 0) : 0,
      returnAmount: plan ? Number(plan.returnAmount || 0) : 0,
      completionRate: plan ? Number(plan.completionRate || 0) : 0,
      salaryBase,
      bonusAmount,
      totalSalary: salaryBase + bonusAmount,
    };
  });

  return {
    ok: true,
    startDate,
    endDate,
    rows,
    totals: {
      employees: rows.length,
      active: rows.filter(row => row.isActive).length,
      workDays: rows.reduce((sum, row) => sum + Number(row.workDays || 0), 0),
      salaryBase: rows.reduce((sum, row) => sum + Number(row.salaryBase || 0), 0),
      bonusAmount: rows.reduce((sum, row) => sum + Number(row.bonusAmount || 0), 0),
      totalSalary: rows.reduce((sum, row) => sum + Number(row.totalSalary || 0), 0),
    },
  };
}


export async function deleteLeadRecord(db: D1Database, id: number) {
  if (!id) throw new Error('Запись лидов не найдена.');
  await db.prepare('DELETE FROM lead_records WHERE id = ?').bind(id).run();
  await writeActivityLog(db, { eventType: 'lead_deleted', entityType: 'lead_record', entityId: id, title: 'Удалена запись лидов' });
  return { ok: true, id };
}


export async function deleteCallCentreRecord(db: D1Database, id: number) {
  if (!id) throw new Error('Запись Call Centre не найдена.');
  await db.prepare('DELETE FROM call_centre_records WHERE id = ?').bind(id).run();
  await writeActivityLog(db, { eventType: 'call_centre_deleted', entityType: 'call_centre_record', entityId: id, title: 'Удалена запись Call Centre' });
  return { ok: true, id };
}


export async function deleteManagerPlanRecord(db: D1Database, id: number) {
  if (!id) throw new Error('План менеджера не найден.');
  await db.prepare('DELETE FROM plans WHERE id = ?').bind(id).run();
  await writeActivityLog(db, { eventType: 'manager_plan_deleted', entityType: 'manager_plan', entityId: id, title: 'Удалён план менеджера' });
  return { ok: true, id };
}


export async function deleteDepartmentPlanRecord(db: D1Database, id: number) {
  if (!id) throw new Error('План отдела не найден.');
  await db.prepare('DELETE FROM department_plans WHERE id = ?').bind(id).run();
  await writeActivityLog(db, { eventType: 'department_plan_deleted', entityType: 'department_plan', entityId: id, title: 'Удалён план отдела' });
  return { ok: true, id };
}

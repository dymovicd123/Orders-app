export type ItemizedOrderLineMoneyInput = {
  quantity: unknown;
  unitPrice: unknown;
};

export type ItemizedPaymentMoneyInput = {
  amount: unknown;
};

export type ItemizedOrderMoney = {
  lineTotals: number[];
  totalAmount: number;
  receivedAmount: number;
  debtAmount: number;
  overpaymentAmount: number;
};

export class ItemizedPricingValidationError extends Error {
  readonly status = 400;
  readonly code: string;

  constructor(message: string, code = 'itemized_pricing_invalid') {
    super(message);
    this.name = 'ItemizedPricingValidationError';
    this.code = code;
  }
}

function requiredSafeInteger(value: unknown, label: string, minimum: number) {
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
    throw new ItemizedPricingValidationError(`${label} не указана.`);
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || !Number.isSafeInteger(numeric) || numeric < minimum) {
    throw new ItemizedPricingValidationError(`${label} должна быть целым числом от ${minimum}.`);
  }
  return numeric;
}

function checkedMoneyAdd(left: number, right: number, label: string) {
  const total = left + right;
  if (!Number.isSafeInteger(total) || total < 0) {
    throw new ItemizedPricingValidationError(`${label} слишком велика для точного расчёта.`);
  }
  return total;
}

export function calculateItemizedOrderMoney(
  lines: readonly ItemizedOrderLineMoneyInput[],
  payments: readonly ItemizedPaymentMoneyInput[],
): ItemizedOrderMoney {
  const lineTotals = lines.map((line, index) => {
    const quantity = requiredSafeInteger(line?.quantity, `Количество в позиции ${index + 1}`, 1);
    const unitPrice = requiredSafeInteger(line?.unitPrice, `Цена позиции ${index + 1}`, 0);
    const lineTotal = quantity * unitPrice;
    if (!Number.isSafeInteger(lineTotal) || lineTotal < 0) {
      throw new ItemizedPricingValidationError(`Сумма позиции ${index + 1} слишком велика для точного расчёта.`);
    }
    return lineTotal;
  });

  const totalAmount = lineTotals.reduce(
    (sum, lineTotal) => checkedMoneyAdd(sum, lineTotal, 'Цена заказа'),
    0,
  );
  const receivedAmount = payments.reduce((sum, payment, index) => {
    const amount = requiredSafeInteger(payment?.amount, `Сумма оплаты ${index + 1}`, 0);
    return checkedMoneyAdd(sum, amount, 'Сумма оплат');
  }, 0);

  return {
    lineTotals,
    totalAmount,
    receivedAmount,
    debtAmount: Math.max(0, totalAmount - receivedAmount),
    overpaymentAmount: Math.max(0, receivedAmount - totalAmount),
  };
}

export function assertItemizedOrderMoneyNotOverpaid(
  lines: readonly ItemizedOrderLineMoneyInput[],
  payments: readonly ItemizedPaymentMoneyInput[],
): ItemizedOrderMoney {
  const result = calculateItemizedOrderMoney(lines, payments);
  if (result.overpaymentAmount > 0) {
    throw new ItemizedPricingValidationError(
      `Оплаты (${result.receivedAmount}) больше цены заказа (${result.totalAmount}). Исправьте цену или оплаты.`,
      'itemized_overpayment',
    );
  }
  return result;
}

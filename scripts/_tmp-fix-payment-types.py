from pathlib import Path
p=Path('worker/domains/orders-write.ts')
text=p.read_text(encoding='utf-8')
old="""      const rawPaymentCorrections = Array.isArray(input.paymentCorrections)
        ? input.paymentCorrections
        : (Array.isArray(input.paymentMethodCorrections)
          ? input.paymentMethodCorrections.map((correction) => ({ paymentId: correction.paymentId, method: correction.method }))
          : []);
      const requestedPaymentCorrections = new Map<number, (typeof rawPaymentCorrections)[number]>();"""
new="""      type PaymentCorrectionInput = NonNullable<OrderInput['paymentCorrections']>[number];
      const rawPaymentCorrections: PaymentCorrectionInput[] = Array.isArray(input.paymentCorrections)
        ? input.paymentCorrections
        : (Array.isArray(input.paymentMethodCorrections)
          ? input.paymentMethodCorrections.map((correction) => ({ paymentId: correction.paymentId, method: correction.method }))
          : []);
      const requestedPaymentCorrections = new Map<number, PaymentCorrectionInput>();"""
if text.count(old)!=1:
    raise SystemExit(f'expected correction input block once, got {text.count(old)}')
p.write_text(text.replace(old,new,1),encoding='utf-8')
print('fixed payment correction union typing')

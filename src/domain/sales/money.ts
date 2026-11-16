/** Saf para hesapları: tutarlar tam sayı kuruş, adet milli (1 adet = 1000). */

export function lineGrossKurus(qtyMilli: number, unitPriceKurus: number): number {
  return Math.round((qtyMilli * unitPriceKurus) / 1000);
}

/** round(adet × fiyat × (1000 − iskonto) / 1000), adet milli olduğundan bir kez daha 1000'e bölünür. */
export function lineNetKurus(qtyMilli: number, unitPriceKurus: number, discountPermille: number): number {
  return Math.round((qtyMilli * unitPriceKurus * (1000 - discountPermille)) / 1_000_000);
}

export function vatKurus(netKurus: number, vatRate: number): number {
  return Math.round((netKurus * vatRate) / 100);
}

export type TotalsLine = { qtyMilli: number; unitPriceKurus: number; discountPermille: number; vatRate: number; status: string };

export type OrderTotals = {
  grossBeforeDiscountKurus: number;
  discountKurus: number;
  netKurus: number;
  vatByRate: Record<string, number>;
  vatKurus: number;
  totalKurus: number;
};

/** İptal edilen satırlar sayılmaz. KDV, oran başına toplanan net tutar üzerinden hesaplanır. */
export function orderTotals(lines: TotalsLine[]): OrderTotals {
  let gross = 0;
  let net = 0;
  const netByRate = new Map<number, number>();
  for (const l of lines) {
    if (l.status === "cancelled") continue;
    const lineNet = lineNetKurus(l.qtyMilli, l.unitPriceKurus, l.discountPermille);
    gross += lineGrossKurus(l.qtyMilli, l.unitPriceKurus);
    net += lineNet;
    netByRate.set(l.vatRate, (netByRate.get(l.vatRate) ?? 0) + lineNet);
  }
  const vatByRate: Record<string, number> = {};
  let vat = 0;
  for (const [rate, rateNet] of [...netByRate].sort((a, b) => a[0] - b[0])) {
    const v = vatKurus(rateNet, rate);
    vatByRate[String(rate)] = v;
    vat += v;
  }
  return {
    grossBeforeDiscountKurus: gross,
    discountKurus: gross - net,
    netKurus: net,
    vatByRate,
    vatKurus: vat,
    totalKurus: net + vat,
  };
}

/* Selected-tire card math. Loaded by new-tires.html and required by tests.
   The card is tire merchandise + tire eco fee + 13% tax on those two.
   The off-rim swap is a separate charge and is not an input here.
   Quantity is applied once: a stored price may be the per-tire price or the
   price of the whole set, and a scraped eco fee may be per tire or already extended. */
(function exposeNewTireMoney(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.EastCordNewTireMoney = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const OFF_RIM_UNIT_PRICES = [16.25, 18.75, 21.25, 25];

  function roundMoney(value) {
    const amount = Number(value);
    if (!Number.isFinite(amount)) return 0;
    return Math.round((amount + Number.EPSILON) * 100) / 100;
  }

  function uniqueAmounts(values) {
    const seen = new Set();
    const amounts = [];
    values.forEach((value) => {
      const amount = roundMoney(value);
      if (!(amount > 0) || seen.has(amount)) return;
      seen.add(amount);
      amounts.push(amount);
    });
    return amounts;
  }

  function isOffRimUnitPrice(amount) {
    return OFF_RIM_UNIT_PRICES.some((price) => Math.abs(price - Number(amount)) < 0.001);
  }

  function selectedTireCardMoney(input = {}) {
    const qty = Math.max(1, Math.min(8, Math.round(Number(input.qty) || 1)));
    const stored = Math.max(0, Number(input.storedPrice) || 0);
    const tireTotal = Math.max(0, Number(input.tireTotal) || 0);
    let perTire = Math.max(0, Number(input.perTire) || 0);
    const scrapedEco = Math.max(0, Number(input.scrapedEco) || 0);
    const target = Math.max(0, Number(input.targetWithTax) || 0);
    const taxRate = Number(input.taxRate) > 0 ? Number(input.taxRate) : 0.13;
    if (perTire > 0 && isOffRimUnitPrice(perTire) && stored > perTire + 1) perTire = 0;

    const tireChoices = uniqueAmounts([
      tireTotal,
      perTire > 0 ? perTire * qty : 0,
      stored,
      qty > 1 ? stored * qty : 0,
    ]);
    const ecoChoices = uniqueAmounts([
      scrapedEco,
      qty > 1 ? scrapedEco * qty : 0,
    ]);
    if (!ecoChoices.length) ecoChoices.push(0);

    let tireAmount = tireTotal || (perTire > 0 ? roundMoney(perTire * qty) : roundMoney(stored * qty));
    let ecoFee = scrapedEco;
    if (target > 0 && tireChoices.length) {
      let bestGap = Infinity;
      tireChoices.forEach((amount) => {
        ecoChoices.forEach((eco) => {
          const withTax = roundMoney((amount + eco) * (1 + taxRate));
          const gap = Math.abs(withTax - target);
          if (gap < bestGap - 0.001) {
            bestGap = gap;
            tireAmount = amount;
            ecoFee = eco;
          }
        });
      });
    }

    const taxes = roundMoney((tireAmount + ecoFee) * taxRate);
    const total = roundMoney(tireAmount + ecoFee + taxes);
    const unit = qty > 0 ? roundMoney(tireAmount / qty) : 0;
    return { qty, unit, tireAmount, ecoFee, taxes, total };
  }

  return {
    OFF_RIM_UNIT_PRICES,
    roundMoney,
    selectedTireCardMoney,
  };
}));

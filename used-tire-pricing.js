(function (root) {
  const MARKDOWN_STOCK_LIMIT = 4;
  const MARKDOWN_RATE = 0.15;
  const MARKDOWN_PERCENT = Math.round(MARKDOWN_RATE * 100);

  function roundMoney(value) {
    const amount = Number(value);
    return Number.isFinite(amount) ? Math.round(amount * 100) / 100 : 0;
  }

  function isMarkdownStock(stock) {
    const count = Math.max(0, Number(stock) || 0);
    return count > 0 && count < MARKDOWN_STOCK_LIMIT;
  }

  function getUsedTireUnitPrice(listPrice, stock) {
    const price = Number(listPrice);
    if (!Number.isFinite(price) || price <= 0) return null;
    if (!isMarkdownStock(stock)) return roundMoney(price);
    return roundMoney(price * (1 - MARKDOWN_RATE));
  }

  function listedSetCount(stock) {
    const count = Math.max(0, Number(stock) || 0);
    if (!count) return 0;
    return count >= 4 ? 4 : count;
  }

  function unitPriceFromSet(setPrice, stock) {
    const count = listedSetCount(stock);
    const price = Number(setPrice);
    if (!Number.isFinite(price) || price <= 0 || !count) return null;
    return roundMoney(price / count);
  }

  function priceForSetQuantity(setPrice, stock, qty) {
    const price = Number(setPrice);
    const count = Math.max(0, Number(stock) || 0);
    const amount = Math.max(0, Number(qty) || 0);
    if (!Number.isFinite(price) || price <= 0 || !count || !amount) return null;
    if (amount === count) return roundMoney(price);
    return roundMoney((price * amount) / count);
  }

  root.EastCordUsedTirePricing = {
    MARKDOWN_STOCK_LIMIT,
    MARKDOWN_RATE,
    MARKDOWN_PERCENT,
    roundMoney,
    isMarkdownStock,
    getUsedTireUnitPrice,
    listedSetCount,
    unitPriceFromSet,
    priceForSetQuantity,
  };
})(window);

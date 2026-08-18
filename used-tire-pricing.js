(function (root) {
  const MARKDOWN_STOCK_LIMIT = 4;
  const MARKDOWN_RATE = 0.2;

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

  root.EastCordUsedTirePricing = {
    MARKDOWN_STOCK_LIMIT,
    MARKDOWN_RATE,
    roundMoney,
    isMarkdownStock,
    getUsedTireUnitPrice,
  };
})(window);

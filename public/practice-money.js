/* Game-dollar denomination only. Keep simulation balances and Bitcoin history unchanged. */
(() => {
  'use strict';
  const dollarsPerUnit = 10;
  const startingUnits = 100;
  const currency = new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 2,
  });
  const toDollars = units => units * dollarsPerUnit;
  // A cent now represents the same precision as one dollar before the 100:1 rescale.
  const profit = units => (Math.round(toDollars(units) * 100) - toDollars(startingUnits) * 100) / 100;
  globalThis.BitcoinPracticeMoney = Object.freeze({
    dollarsPerUnit, toDollars, profit,
    format: units => currency.format(toDollars(units)),
    formatDollars: value => currency.format(value),
  });
})();

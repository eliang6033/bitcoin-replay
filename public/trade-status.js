/* One source of truth for order feedback and snapshot ordering. */
(() => {
  const dollars = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const cash = amount => dollars.format(amount * 1000);
  const sideName = side => side === "up" ? "Up" : side === "down" ? "Down" : "both bets";
  function receipt(fill) {
    const buying = fill.action === "buy" || fill.action === "buyCash";
    const fraction = !buying && fill.side !== "both" && fill.holdingsBefore?.[fill.side] > 0
      ? Math.round(100 * fill.quantity / fill.holdingsBefore[fill.side]) + "% of " : "";
    const headline = (buying ? "✓ Bought " : "✓ Sold ") + fraction + sideName(fill.side) + " · " +
      (buying ? "Paid " : "Received ") + cash(fill.total);
    const details = fill.cashAfter == null ? "Confirmed trade." : "Cash available: " + cash(fill.cashAfter) + ".";
    return { kind: "success", headline, details: details + (buying ? " This purchase pays " + cash(fill.quantity * 10) +
      " if " + sideName(fill.side) + " wins at the finish, or $0 if it loses." : " Sale proceeds are not the same as profit.") };
  }
  function failure(error) {
    if (!error.rejected) return { kind: "uncertain", headline: "Confirmation lost — check Your trades", details: "The order may have filled. Reconnect and check your balance before trying again." };
    const moved = /price changed|Another team traded/i.test(error.message);
    return { kind: "error", headline: "Not filled · " + (moved ? "Price moved" : "Order rejected"),
      details: moved ? "This order did not change your cash or holdings. Check the new amount and tap again." : error.message };
  }
  function shouldApply(current, incoming, request, applied) {
    if (current?.roundId === incoming.roundId && Number.isSafeInteger(current.revision) && Number.isSafeInteger(incoming.revision))
      return incoming.revision > current.revision;
    return request > applied;
  }
  globalThis.BitcoinTradeStatus = { receipt, failure, shouldApply };
})();

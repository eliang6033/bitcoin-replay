# Market depth calibration

Polymarket uses an order book, while this classroom game uses a continuous LMSR pricing rule. The real market samples below are context, not a fitted model, a historical Polymarket replay, or a claim about typical liquidity across all markets.

## What the public snapshots show

We retrieved two public order books on 9 November 2026 at about 20:42 Pacific (10 November 04:42 UTC). The [saved public responses](research/market-depth-2026-11-09.json) contain timestamps, prices, quantities and source URLs. We sorted asks from lowest to highest and walked a hypothetical $100,000 immediate purchase. Calculations omit fees, cancellations and incoming orders, and assume the recorded orders can all be matched. They are snapshot calculations, not executed trades.

- **Bilibili Gaming vs Gen.G:** best ask 38 cents per $1 payout. About $296,704 of asks were available from 38 through 40 cents. The hypothetical $100,000 purchase fit entirely at 38 cents.
- **No change in Fed rates after the December 2026 meeting:** best ask 19 cents. About $93,428 of asks were available from 19 through 21 cents. A $100,000 purchase reached the 22-cent level, averaging about 20.52 cents.

These examples demonstrate variation, not an average. Cumulative trading volume and headline liquidity cannot substitute for currently executable depth near the desired price. See Polymarket's [Prices & Orderbook](https://docs.polymarket.com/concepts/prices-orderbook) and [order-book data documentation](https://docs.polymarket.com/market-data/prices-order-books).

## Classroom parameters

The internal full-share payout is 10, displayed as $10,000. A student's initial 100 internal units display as $100,000. New rounds increase LMSR depth from 18 to 540. Starting balances and settlement payouts for students are unchanged.

For an immediate purchase with internal budget C and starting probability p, the terminal marginal probability is:

`p_after = 1 - (1 - p) * exp(-C / (10 * 540))`

At a 10% opening chance, $25,000 moves it to about 10.42%; $100,000 moves it to about 11.65%; $250,000 moves it to about 14.07%, before any other trades. All positive purchases still have an effect. Twenty full student wallets together can move a 50% book to about 65.5%.

The maximum upward impact of a $100,000 buy is less than 1.84 percentage points, even near an extreme. Larger accumulated balances can cause greater impact; there is no artificial guarantee that any size order moves prices by less than two points. Selling prices depend on the size of the position and the current book. Immediate buy-and-sell round trips without intervening orders neither create nor destroy money in this fee-free model. Market moves and final settlement can still produce losses.

Background NPC capital, opening quantities and order quantities scale by the same factor of 30, giving each of 20 NPCs $3 million in simulated opening capital. The NPC event clock, sentiment process and historical Bitcoin inputs are unchanged. Across 30 seeds and 300 one-second samples per seed, the no-human-trading marginal probabilities and total NPC order counts matched the former engine. NPCs are larger background participants, not clones of student wallets.

Saved rounds keep their existing depth and NPC sizes so upgrading cannot reprice existing positions or change completed results. A host refresh followed by a new round activates the deeper market. This is a deliberately simplified, liquid classroom market, not a full limit-order-book simulation.

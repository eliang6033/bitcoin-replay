# Historical data for Bitcoin Replay

Facilitator reference. Contains the date and settlement result. Keep this file off the student screen until the round ends.

The replay covers 19 May 2021, 11:30–15:30 UTC (04:30–08:30 in San Diego). Five classroom minutes represent four historical hours. All timestamps in the JSON are Unix seconds, UTC.

## Price series

The source is Coinbase Exchange BTC-USD, granularity 60 seconds. [Exact request](https://api.exchange.coinbase.com/products/BTC-USD/candles?start=2021-05-19T11:30:00Z&end=2021-05-19T15:30:00Z&granularity=60) · [Candle field definitions](https://docs.cdp.coinbase.com/api-reference/exchange-api/rest-api/products/get-product-candles)

Retain buckets whose opening timestamps are at or after 11:30 and strictly before 15:30. Sort by ascending time. The request also returns a bucket that starts at 15:30. Discard that bucket to avoid including trades after the round.

The chart begins with the opening trade of the 11:30 bucket, $37,978.10. Each subsequent observation is one completed bucket's closing trade, displayed at the end of its minute. The 15:29 bucket closes at $37,024.50. DOWN wins. These are historical one-minute price observations. Any animated line between samples is a visual transition. Class UP/DOWN ticket quotes come from the classroom simulator.

Polymarket was operating by June 2020. Its public catalog of markets closing around this replay did not yield a contract for the same four-hour Bitcoin question. The game uses its own orders to price Higher and Lower tickets. This lets students trade alongside simulated participants and change the price other teams see. [CFTC record](https://www.cftc.gov/PressRoom/PressReleases/8478-22) · [Polymarket archive query](https://gamma-api.polymarket.com/markets?closed=true&end_date_min=2021-05-18&end_date_max=2021-05-21&limit=100)

## Block series

Blockstream's public Esplora API supplies the Bitcoin main-chain blocks. Each request returns ten consecutive blocks descending from the requested height. Relevant pages: [684188](https://blockstream.info/api/blocks/684188), [684198](https://blockstream.info/api/blocks/684198), [684208](https://blockstream.info/api/blocks/684208) and [684218](https://blockstream.info/api/blocks/684218). [Esplora API](https://github.com/Blockstream/esplora/blob/master/API.md#blocksstart_height)

The source pages checked collectively cover heights 684149–684218. We verified consecutive heights and each next block’s parent hash before filtering by header timestamp in the half-open interval [11:30, 15:30). Block 684187 has timestamp 11:14:21, block 684188 has 11:34:40, block 684208 has 15:13:45 and block 684209 has 15:42:10. Block 684208 was also located by [mempool.space's timestamp lookup](https://mempool.space/api/v1/mining/blocks/timestamp/1621438200).

There are 21 qualifying blocks, heights 684188–684208. The sum of their reported transaction counts is 53,191, including each block’s coinbase transaction. Each entry in the replay retains the full block hash for independent verification. Header timestamps give historical ordering for the replay, with the usual limits of miner-reported timestamps. The counts refer to the whole network. A block's transaction count measures transaction inclusion, not electricity use or local emissions. Classroom trades occur only in the game.

## Snapshot checks

Checked 240 consecutive one-minute buckets and their OHLC bounds, yielding 241 plotted points. Checked the source chain's parent links and flanking timestamps. The archived JSON has SHA-256 `c2c0d9df7a642ab34c9a63a9fd388b42f90d96176627ec636d599f248dcf1542`. The snapshot can run in class without a live market-data connection.

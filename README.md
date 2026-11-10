# Bitcoin Replay

Run a shared five-minute prediction game, reveal the real Bitcoin price, then rewind the same four hours to watch blocks arrive. The activity ends with a classroom discussion about mining in Granbury, Texas. All prices and blocks are bundled with the project. Participants only need a browser.

## Play online

Open [Bitcoin Replay](https://eliang6033.github.io/bitcoin-replay/) and select **Create a room**, or enter a friend's five-digit room code. Each room has its own invitation link and downloadable QR code. Share that room link with your group; everyone with it can **Join the market** or **View live leaderboard** without joining. The homepage also offers a return link to the last room used in this browser. Existing eight-character room links still work. New numeric codes skip occupied rooms without changing their games.

Rooms have independent players, balances, price paths, clocks and rankings. Starting or resetting one never changes another. The historical Bitcoin price window is the same teaching dataset in each room; the trading-agent simulation and human orders run independently. Old host links and already-open clients retain access to the earlier room as `?room=CLASSROOM`, without granting a host role.

There is no presenter account or host browser. Any joined player can start the five-minute replay when the class is ready. A running round cannot be reset; after settlement, anyone can open a new round, even if every previous player has left. Starting a new round clears the previous round's players and balances. Download the round log first if needed.

The public page is still hosted on GitHub Pages. A separate shared service stores the room in a durable database and uses a server clock. Closing every browser does not pause the round: on return the service catches up the scheduled NPC orders and settles at the original deadline. A player identity is saved in this browser profile, so reloading or reopening restores the same balance. A different browser/device or cleared browser storage creates a different identity. No wallet, password, or real money is needed.

Each new round includes **120 trading AI agents** (simulated traders with programmed strategies), each starting with **$5,000**. They share the same $600,000 opening capital as the previous 20 large NPCs, spread across smaller accounts. Every NPC buy and sale is capped at **$1,000**, even if its balance grows. Students still start with $1,000. The NPCs trade about 10–14 times a second in quiet periods and faster during sharp moves, with different opinions based only on the Bitcoin prices already shown. This creates frequent small trades rather than occasional oversized fills.

Market depth remains 540. A $1,000 buy moves its outcome by less than 2 percentage points before other orders; 20 classmates buying Up with $1,000 each can together move a 50% book to about 65.5%. These are educational calibration choices, not measured Polymarket averages. [Market-depth notes](MARKET_DEPTH.md) explain the comparison and tradeoffs. The shared room uses these market rules for every new round.

**For a classroom screen:** connect to the room, then select **View live leaderboard** below the join form. No name or market entry is needed. Players can also open it from **Live leaderboard** in the navigation. It shows every classmate, live profit/loss, changing ranks and medals for the top three places. NPCs are excluded. Live profit uses cash plus the proceeds from selling current positions, so it can change before settlement; the final board uses actual winning payouts. **Back to market** returns to trading without changing positions.

The Up and Down rows show each outcome's market-implied chance to one decimal place and how many students currently own it. Small real changes remain visible even near the bottom. New rounds preserve differing NPC opinions after the shared crash signal reaches its limit, with slightly stronger changing sentiment. The more frequent small orders keep the same market depth and historical Bitcoin prices. Old rounds keep their original NPC behavior until reset. A player who holds both outcomes counts once on each side. The live activity beside the chart shows confirmed buys and sales in practice dollars, with NPC orders marked separately. It can be paused independently of the round.

Each player gets **$1,000 in practice cash**. The gold line is the historical price of one bitcoin in US dollars. The labeled horizontal line marks where Bitcoin started. Choose 10%, 25%, 50% or 100%, then press one of the four large buttons. Buy Up and Buy Down sit directly above Sell Up and Sell Down. Buying uses the chosen fraction of available cash, including small remaining balances. Selling closes the chosen fraction of that side’s holdings. Both sides can be held at once. Total value includes cash plus the amount received by selling all open bets now. Cash you can spend shows the available buying balance. Profit or loss is shown directly underneath.

Each click shows a pending confirmation, then a confirmed payment or sale receipt. Rejected orders are marked **Not filled**; a lost connection is marked **Confirmation lost** until the exact order can be found in the player's history. Orders are never silently retried. **Your trades** retains every confirmed personal trade for the round, including the cash balance after execution. Any joined player can download a round log that excludes private player identity tokens. Rounds begun before this feature are explicitly marked as incomplete; older fills cannot be recovered from the short live ticker.

The displayed market chance is the marginal room price, not the average price for a large order. The gold Bitcoin line is a separate price. Sale previews include the full order's price impact; execution uses the latest committed room price, so incoming trades can change the actual proceeds. Those proceeds are not themselves profit. At settlement, remaining losing bets pay zero even if bought cheaply. Server-issued revisions prevent an older response from replacing a newer balance. Every accepted order is persisted before confirmation. Concurrent orders use a database version check and are revalidated against the latest committed market; repeated order references cannot fill twice.

## Try the local edition on one computer

Open a terminal in this folder and run the following with Python 3.9 or newer.

```sh
python3 server.py
```

Open the **Host** link printed in the terminal. Enter your name or nickname, select **Join the market**, then **Start 5-minute replay**. To try a separate student view, open the **Students** link in a private browser window. **Reset practice round** clears the game and returns everyone to the lobby.

## Run it with classmates

1. Stop the practice server with Control-C and run `python3 server.py --bind 0.0.0.0` on the presenting laptop. If the preview is already using the default port and you want to keep it, add `--port 5190`.
2. Open the new **Host** link on that laptop. Project the lobby to display the student QR. **Share invite link** also gives the student address. Everyone must be on a network that lets devices reach the laptop. Try the address on a phone before class. If campus Wi-Fi isolates devices, use a shared hotspot or let the class play by table on the projected screen.
3. Ask students to join with an individual name or nickname. Pick a percentage and press Buy Up, Buy Down, Sell Up, or Sell Down. The four buttons display what the purchase spends or the sale is estimated to return. If both sides are held, Sell both bets closes them together. The cash-out total includes the effect of the entire sale on the room price. A dollar purchase spends the chosen amount. Buttons submit market orders without a price limit: buys receive the shares available for that budget, and sales receive the current whole-order proceeds. Price movement alone does not reject an order. Closed rounds, insufficient holdings and invalid balances still reject it. A rejected or unconfirmed order is never silently resubmitted.
4. Start the clock when the class is ready. Five classroom minutes represent four historical hours. At the closing bell the site reveals the exact UTC window. Each full winning share pays $100 in practice cash. Fractional shares receive the same fraction of this payout. The “at or below” outcome wins a tie. Players can spend only the cash they have and sell only shares they own. Everyone who joined appears on the final leaderboard, including players who made no trades. Profit or loss is the final balance less the starting $1,000. Ranks use practice cents. Tied players share a place and each of the top three places receives its own trophy color.
5. Select **Replay the network**. Over 60 seconds the website reveals the blocks recorded in those same four historical hours. Then select **Open discussion** and compare proposals for a community living near a mine.

Keep the local server running and the presenting laptop awake. Reloading the page keeps a player in the round in the same browser. Resetting the local room or stopping the Python server clears all balances.

## Data and checks

The post-game screen links to the Coinbase prices and individual block records. [DATA.md](DATA.md) documents the source queries, time boundaries and settlement result for facilitators. It contains spoilers. During normal play the shared service sends players only the prices revealed so far. The public repository and historical archive contain the complete round, so share the room invite with players and save these reference materials for afterward.

The GitHub Actions workflow tests the local server and online game logic before publishing the public files. Run the same checks with `python3 -m unittest discover -s tests -v` and `node --test tests/*.cjs`. `python3 build_pages.py` prepares the Pages site in `dist/`.

## Shared service maintenance

`shared-server/service.mjs` wraps the same `public/room-engine.js` used by the simulation tests. Each room has a separate D1 row storing its private snapshot; public responses omit identity tokens, creation markers and future prices. Room creation uses an idempotent request marker, and entering an unknown code never silently creates a room. `shared-server/drizzle/` contains the database migrations. The classroom allows anonymous spectators and browser-specific player credentials. Players have equal controls; it is designed for a cooperative class, not as an unrestricted real-money exchange.

The server source is packaged separately for managed Worker/D1 hosting. `public/shared-room.js` contains its public endpoint. The original GitHub Pages deployment remains independent of the backend deployment, Who Pays for AI, and the personal website. `node --test tests/shared-room.test.cjs` tests real SQLite concurrency, duplicate orders, clock catch-up, identity recovery, shared controls, room isolation, creation retries and legacy-link routing.

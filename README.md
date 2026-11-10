# Bitcoin Replay

Run a shared five-minute prediction game, reveal the real Bitcoin price, then rewind the same four hours to watch blocks arrive. The activity ends with a classroom discussion about mining in Granbury, Texas. All prices and blocks are bundled with the project. Participants only need a browser.

## Play online

Open [Bitcoin Replay](https://eliang6033.github.io/bitcoin-replay/) and select **Create a room**. The host lobby displays a QR code, a live player count and the start button together. Project the lobby for everyone to scan, or select **Download QR code** to save the image for a slide. The code opens that specific room. To reuse a downloaded code later, reopen the room on the same device in the same browser profile. Each student enters their own name or nickname. The host can also join as a player. Start the five-minute replay once everyone appears in the room.

Keep the host tab open and the device awake. On GitHub Pages the host's browser manages the shared market. PeerJS helps players connect to it over WebRTC. Students can use different networks if their browsers can establish a connection. If a participant has trouble connecting, check that the host tab is open and try a different network. For a classroom with restricted connections, the local network option below uses a shared Python server.

Each new round includes **20 simulated traders**. They look at how far Bitcoin has moved from its starting price, its recent direction and the time left. Shared, changing sentiment produces runs and reversals, with some traders taking the opposite view. They trade faster when the price moves sharply. They see the same historical prices as the class. A student's purchase or sale changes the price everyone can trade at.

The Up and Down rows show each outcome's market-implied chance and how many students currently own it. A player who holds both outcomes counts once on each side. The live activity beside the chart shows confirmed buys and sales in practice dollars, with NPC orders marked separately. It can be paused independently of the round.

Each player gets **$100,000 in practice cash**. The gold line is the historical price of one bitcoin in US dollars. The labeled horizontal line marks where Bitcoin started. Choose $10,000, $25,000, $50,000 or All cash, then press Buy Up or Buy Down. Dollar purchases can include fractional shares, so All cash uses the full available balance. The large total includes cash plus the amount received by selling all open bets now. Profit or loss is shown directly underneath.

## Try the local edition on one computer

Open a terminal in this folder and run the following with Python 3.9 or newer.

```sh
python3 server.py
```

Open the **Host** link printed in the terminal. Enter your name or nickname, select **Join the market**, then **Start 5-minute replay**. To try a separate student view, open the **Students** link in a private browser window. **Reset practice round** clears the game and returns everyone to the lobby.

## Run it with classmates

1. Stop the practice server with Control-C and run `python3 server.py --bind 0.0.0.0` on the presenting laptop. If the preview is already using the default port and you want to keep it, add `--port 5190`.
2. Open the new **Host** link on that laptop. Project the lobby to display the student QR. **Share invite link** also gives the student address. Everyone must be on a network that lets devices reach the laptop. Try the address on a phone before class. If campus Wi-Fi isolates devices, use a shared hotspot or let the class play by table on the projected screen.
3. Ask students to join with an individual name or nickname. Pick a dollar amount and press Buy Up or Buy Down. Each open bet has its own Sell half and Sell all controls. If both sides are held, Sell both bets closes them together. The cash-out total includes the effect of the entire sale on the room price. A dollar purchase spends the chosen amount. Orders are rejected if the available shares fall more than 3% below the preview. Sales protect a minimum return of 97% of the preview. A rejection asks for a fresh click and never silently resubmits.
4. Start the clock when the class is ready. Five classroom minutes represent four historical hours. At the closing bell the site reveals the exact UTC window. Each full winning share pays $10,000 in practice cash. Fractional shares receive the same fraction of this payout. The “at or below” outcome wins a tie. Players can spend only the cash they have and sell only shares they own. Everyone who joined appears on the final leaderboard, including players who made no trades. Profit or loss is the final balance less the starting $100,000. Ranks use whole practice dollars. Tied players share a place and each of the top three places receives its own trophy color.
5. Select **Replay the network**. Over 60 seconds the website reveals the blocks recorded in those same four historical hours. Then select **Open discussion** and compare proposals for a community living near a mine.

Keep the local server running and the presenting laptop awake. Reloading the page keeps a player in the round in the same browser. Resetting the local room or stopping the Python server clears all balances.

## Data and checks

The post-game screen links to the Coinbase prices and individual block records. [DATA.md](DATA.md) documents the source queries, time boundaries and settlement result for facilitators. It contains spoilers. During normal play the host sends students only the prices revealed so far. The public repository and historical archive contain the complete round, so share the room invite with players and save these reference materials for afterward.

The GitHub Actions workflow tests the local server and online game logic before publishing the public files. Run the same checks with `python3 -m unittest discover -s tests -v` and `node --test tests/*.cjs`. `python3 build_pages.py` prepares the Pages site in `dist/`.

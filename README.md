# Bitcoin Replay

Run a shared five-minute prediction game, reveal the real Bitcoin price, then rewind the same four hours to watch blocks arrive. The activity ends with a classroom discussion about mining in Granbury, Texas. All prices and blocks are bundled with the project. Participants only need a browser.

## Play online

Open [Bitcoin Replay](https://eliang6033.github.io/bitcoin-replay/) and select **Create a room**. Select **Class QR code** and let everyone scan it, or download the PNG to put on a slide. The code opens that specific room. To reuse a downloaded code later, reopen the room on the same device in the same browser profile. Each team enters a nickname. The host can also join as a player. Start the five-minute replay once everyone appears in the room.

Keep the host tab open and the device awake. On GitHub Pages the host's browser manages the shared market. PeerJS helps players connect to it over WebRTC. Students can use different networks if their browsers can establish a connection. If a participant has trouble connecting, check that the host tab is open and try a different network. For a classroom with restricted connections, the local network option below uses a shared Python server.

## Try the local edition on one computer

Open a terminal in this folder and run the following with Python 3.9 or newer.

```sh
python3 server.py
```

Open the **Host** link printed in the terminal. Enter a practice team name, select **Join the market**, then **Start 5-minute replay**. To try a separate student view, open the **Students** link in a private browser window. **Reset practice round** clears the game and returns everyone to the lobby.

## Run it with classmates

1. Stop the practice server with Control-C and run `python3 server.py --bind 0.0.0.0` on the presenting laptop. If the preview is already using the default port and you want to keep it, add `--port 5190`.
2. Open the new **Host** link on that laptop. Use **Class QR code** to display the student QR and address. Everyone must be on a network that lets devices reach the laptop. Try the address on a phone before class. If campus Wi-Fi isolates devices, use a shared hotspot or let the class play by table on the projected screen.
3. Ask students to join with a team nickname. One browser holds one position. Each team starts with 100 points. Choose 1–10 tickets per order, then buy UP or DOWN, sell tickets you hold, or wait. Both the single-ticket quote and the total depend on trades in the room. Each team has its own cash balance and holdings. The separate BTC price follows the recorded exchange data.
4. Start the clock when the class is ready. Five classroom minutes represent four historical hours. At the closing bell the site reveals the exact UTC window and settles tickets. Each winning ticket pays 10 points. DOWN wins a tie.
5. Select **Replay the network**. Over 60 seconds the website reveals the blocks recorded in those same four historical hours. Then select **Open discussion** and compare proposals for a community living near a mine.

Keep the local server running and the presenting laptop awake. Reloading the page keeps a team in the round in the same browser. Resetting the local room or stopping the Python server clears all balances.

## Data and checks

The post-game screen links to the Coinbase prices and individual block records. [DATA.md](DATA.md) documents the source queries, time boundaries and settlement result for facilitators. It contains spoilers. During normal play the host sends students only the prices revealed so far. The public repository and historical archive contain the complete round, so share the room invite with players and save these reference materials for afterward.

The GitHub Actions workflow tests the local server and online game logic before publishing the public files. Run the same checks with `python3 -m unittest discover -s tests -v` and `node --test tests/*.cjs`. `python3 build_pages.py` prepares the Pages site in `dist/`.

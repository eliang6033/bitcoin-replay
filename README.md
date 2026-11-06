# Bitcoin Replay

Run a shared five-minute prediction game, reveal the real Bitcoin price, then rewind the same four hours to watch blocks arrive. The activity ends with a classroom discussion about mining in Granbury, Texas. All prices and blocks are bundled with the project. Participants only need a browser.

## Try it on one computer

Open a terminal in this folder and run the following with Python 3.9 or newer.

```sh
python3 server.py
```

Open the **Host** link printed in the terminal. Enter a practice team name, select **Join the market**, then **Start 5-minute replay**. To try a separate student view, open the **Students** link in a private browser window. **Reset practice round** clears the game and returns everyone to the lobby.

## Run it with classmates

1. Stop the practice server with Control-C and run `python3 server.py --bind 0.0.0.0` on the presenting laptop. If the preview is already using the default port and you want to keep it, add `--port 5190`.
2. Open the new **Host** link on that laptop. Use **Invite class** to display the student address. Everyone must be on a network that lets devices reach the laptop. Try the address on a phone before class. If campus Wi-Fi isolates devices, use a shared hotspot or let the class play by table on the projected screen.
3. Ask students to join with a team nickname. One browser holds one position. Each team starts with 100 points. Buy an UP or DOWN ticket, sell a ticket you already hold, or wait. The quoted ticket cost changes as the class trades. The separate BTC price follows the recorded exchange data.
4. Start the clock when the class is ready. Five classroom minutes represent four historical hours. At the closing bell the site reveals the exact UTC window and settles tickets. Each winning ticket pays 10 points. DOWN wins a tie.
5. Select **Replay the network**. Over 60 seconds the website reveals the blocks recorded in those same four historical hours. Then select **Open discussion** and compare proposals for a community living near a mine.

Keep the server running and the presenting laptop awake. Reloading the page keeps a team in the round in the same browser. Resetting the room or stopping the server clears all balances. This version uses one Python process to synchronize players. Static GitHub Pages hosting alone cannot run the room.

## Data and checks

The post-game screen links to the Coinbase prices and individual block records. [DATA.md](DATA.md) documents the source queries, time boundaries and settlement result for facilitators. It contains spoilers. The bundled price and block archive stays on the server, and student browsers receive prices only as they play.

Run the tests from this folder with `python3 -m unittest discover -s tests -v`.

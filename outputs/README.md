# Speedle

A real-time party game for 2–8 players, plus a solo daily speed challenge. Players can join from their own phone or computer with a four-character room code. Guess top speeds in the room’s chosen units, preserve your health, and be the last player still standing.

## Play with friends on one Wi-Fi network

1. Install Node.js 20 or newer on the computer that will host the room.
2. In this folder, run `node server.mjs`.
3. Open the local address shown in the terminal to create a room.
4. Share the room code and the **On your Wi-Fi** address with the other players. They open that address on their own devices and choose **Join a room**.
5. The host starts once at least one other player has joined.

The host computer needs to stay on while you play. The game itself uses the local network and needs no account, package install, or external game service.

## Public hosting

Run this as a single Node web service with `outputs` as its root directory and `node server.mjs` as its start command. The server uses the hosting provider’s `PORT` setting. Set `PUBLIC_URL` to the public HTTPS origin so room invites point to the hosted site; Render’s `RENDER_EXTERNAL_URL` is used automatically when available. Rooms are held in memory, so restarting or redeploying the service ends active games, and multiple server instances cannot share a room.

## Daily Guess

Choose **Daily guess** on the home page to play solo. Everyone receives the same object for the UTC date, with one guess per browser per day. The answer is revealed with an accuracy score, and today’s result is saved locally on that browser.

## Rules

- The host chooses 100, 300, or 500 starting HP, a 15, 30, or 45 second guess timer, and Imperial (mph) or Metric (km/h) units in the lobby. The host starts each round; players set a speed guess in the room’s chosen units.
- During guesses, the upper speed line keeps the answer hidden behind the object’s silhouette. A separate slider sets the speed value and changes how quickly an arrow moves left to right on the lower line. On reveal, the object moves along the upper line at its real speed so players can compare both runs.
- A perfect guess costs 0 HP. Damage is `round(100 × absolute error ÷ slider range)`, capped at 100 HP.
- A player who does not submit before the timer ends loses 100 HP.
- A player is eliminated at 0 HP. Rounds continue until just one player remains; they win.
- After a game ends, the host can return everyone to the same lobby and play again.
- The health check uses a heart that drains as a player loses HP and pulses when their health is critical.

The game currently includes a curated deck of animal, human, vehicle, and aircraft speeds. Speeds are illustrative approximations where the real value varies by conditions.

# Rook Online

Play Rook in the browser with up to three friends. Computer players fill any empty seats, and you can pick how strong they are (Easy, Medium or Hard). The game runs on the server, so each player only ever gets their own cards.

## What's in here

| File | What it does |
| --- | --- |
| `server.js` | Web server: serves the page and runs every table |
| `engine.js` | Rook rules and the computer players |
| `public/index.html` | The page players see |
| `public/sounds.js` | Sound effects (made in the browser, no audio files) |
| `package.json` | Tells the host to install `ws` and run `npm start` |

## Put it online for free (Render)

You need a free GitHub account and a free Render account. It takes about 10 minutes.

1. **Upload the code to GitHub.**
   - Sign in at github.com, click **New repository**, name it `rook-online`, and click **Create repository**.
   - On the next page, click **uploading an existing file**. Drag in everything from this folder: `server.js`, `engine.js`, `package.json`, `README.md` and the `public` folder. Then click **Commit changes**.
2. **Create the web service on Render.**
   - Sign up at render.com with your GitHub account.
   - Click **New +** and then **Web Service**, and choose your `rook-online` repository.
   - Use these settings:
     - Language/Runtime: **Node**
     - Build Command: `npm install`
     - Start Command: `npm start`
     - Instance Type: **Free**
   - Click **Create Web Service** and wait for "Live". Your address looks like `https://rook-online-xxxx.onrender.com`.
3. **Play.** Open your address, type your name and click **Create table**. Click **Copy link** and send it to your friends. Friends who open the link join the table. Anyone can click **Sit here** to move to another seat, and partners sit across from each other. Click **Start game** when everyone is ready.

### Good to know about the free plan

- After about 15 minutes with nobody connected, Render puts the service to sleep. The next visit wakes it up, which can take up to a minute.
- An open table keeps the service awake, because each open page checks in with the server every 25 seconds.
- Tables are kept in memory. If the service sleeps or restarts, games in progress are lost.
- Your friends only need the link. They don't need accounts.

## How a table works

- Each table has a 4-letter code, and the link includes it (`...?t=ABCD`).
- If a player refreshes or briefly drops, they get their seat and cards back. If they're gone for more than 20 seconds, a computer plays their seat until they return.
- Anyone who joins after the four seats are filled watches the game. A watcher can take over any seat a computer is playing.
- Anyone at the table can change the difficulty, and the change takes effect on the computer players' next move.
- These settings are saved in each player's own browser: sound on/off and volume, and whether to suggest trump and discards.

## Run it on your own computer

Install Node.js 18 or newer (nodejs.org). Then run these commands in this folder:

```
npm install
npm start
```

Open http://localhost:3000. People on the same Wi-Fi can join at `http://<your computer's IP>:3000`.

For testing, `ROOK_SPEED=0.2 npm start` makes the computer players move five times faster.

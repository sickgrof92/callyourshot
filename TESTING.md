# Try Call Your Shot on your phone (Android or iPhone)

This takes about 20 minutes the first time. You'll put the server online for free with Render, then open the app on your phone with Expo Go. It works the same on Android and iPhone; the only differences are where you get Expo Go and how you scan the QR code.

## Part 1: Put the server online (Render)

1. Go to [render.com](https://render.com) and sign up with your GitHub account.
2. In the Render dashboard, click **New** > **Blueprint**.
3. Pick the **callyourshot** repository. Render reads the `render.yaml` file and shows one service, `callyourshot-api`.
4. Render asks for two secret values. Paste them in:
   - `ODDS_API_KEY`: your key from the-odds-api.com
   - `ADMIN_TOKEN`: your admin password (a long random string is best)
5. Click **Apply**. The first deploy takes a few minutes.
6. When it says **Live**, copy the URL at the top of the service page. It looks like `https://callyourshot-api.onrender.com`.
7. Check it works: open `<your URL>/health` in a browser. You should see `{"ok":true}`.

The plan size (500 credits) and renewal day (16th) are already filled in. When you upgrade to the $30 plan, open the service's **Environment** tab, change `ODDS_API_MONTHLY_CREDITS` to `20000`, and save.

### Keep it awake

Render's free plan puts the server to sleep after 15 minutes with no visitors. While it sleeps, it can't update lines or grade picks, and the first request after a nap takes up to a minute.

The repo includes a GitHub workflow called **"Keep Render server awake (pings every 10 min)"**. It visits your server every 10 minutes so it never falls asleep. It needs to know your Render URL, which you save as a repository *variable* (not a secret):

1. Open your repo on GitHub and click the **Settings** tab (top right of the repo page).
2. In the left menu, click **Secrets and variables**, then **Actions**.
3. Click the **Variables** tab (next to "Secrets").
4. Click **New repository variable**.
5. Name: `RENDER_URL`
6. Value: your Render URL with nothing after it, like `https://callyourshot-api.onrender.com`
7. Click **Add variable**.

Check that it works: click the repo's **Actions** tab, then **Keep Render server awake** in the left list, then **Run workflow** > **Run workflow**. Open the new run. It should show a green check and a note saying "Server is awake". If it shows a yellow warning saying "RENDER_URL not set", go back and check step 5. After this it runs on its own every 10 minutes.

### Good to know about the free plan

- **The database resets whenever the server restarts or redeploys** (for example, after new code is merged). Test accounts, points and picks start over. That's fine for testing. Before real players join, switch to Render's Starter plan with a disk (instructions are in `render.yaml`).
- After a restart, the server may spend a few extra Odds API credits reloading lines.

## Part 2: Run the app on your phone

You need a computer (Mac or Windows) on the same Wi-Fi as your phone.

1. On your phone, install **Expo Go**:
   - **Android:** from the Google Play Store.
   - **iPhone:** from the App Store.
2. On your computer, install **Node.js** (the LTS version) from [nodejs.org](https://nodejs.org).
3. Download the code. Either:
   - with Git: `git clone https://github.com/sickgrof92/callyourshot.git`, or
   - on GitHub, click **Code** > **Download ZIP**, and unzip it.
4. Open a terminal (Terminal on Mac, PowerShell on Windows) and go into the app folder:
   ```
   cd callyourshot/app
   ```
5. Install the app's packages (a few minutes):
   ```
   npm install
   ```
6. Tell the app where your server is. Create a file named `.env.local` in the `app` folder containing one line, with your Render URL:
   ```
   EXPO_PUBLIC_API_URL=https://callyourshot-api.onrender.com
   ```
7. Start the app:
   ```
   npx expo start
   ```
8. A QR code appears in the terminal. Scan it:
   - **Android:** open the **Expo Go** app and tap **Scan QR code**, then point it at the QR code. (Your regular camera app won't open it.)
   - **iPhone:** open the **Camera** app, point it at the QR code, and tap the banner to open it in Expo Go.

If your phone can't connect, stop it with Ctrl+C and run `npx expo start --tunnel` instead.

## Troubleshooting: "Couldn't reach the server"

The message shows the address the app is trying. If it says `http://localhost:8080`, the app didn't find your Render URL.

1. **Is the server up?** On your phone's browser, open your Render URL with `/health` on the end. Wait up to a minute. You should see `{"ok":true}`. If not, check the service's **Logs** in Render.
2. **Check the address file.** In the `app` folder there must be a file named exactly `.env.local` containing `EXPO_PUBLIC_API_URL=https://your-url.onrender.com` (no `/health`, no slash at the end).
   - **Windows:** Notepad may have saved it as `.env.local.txt`. In File Explorer turn on **View** > **Show** > **File name extensions** and rename it if needed.
   - **Mac:** dot files are hidden in Finder; press Cmd+Shift+. to show them.
3. **Restart with a clean start.** The address is only read when the app starts. Press Ctrl+C in the terminal, run `npx expo start --clear`, and scan the QR code again.

## Part 3: Try it

First, create a contest or two on the admin page (`https://your-url.onrender.com/admin`, password is your `ADMIN_TOKEN`). "7-day contests, one starting each day" sets up a week of them at once. Contests have to be created before they start, so the first ones open tomorrow; for a quick test, make one that starts a few minutes from now.

1. Tap **Continue with Apple** or **Continue with Google**. In test mode no real sign-in happens; your account is tied to the phone. Fill in a display name, email, phone, and state or province, and tick the agreement.
2. On **Contests**, tap **Join free** on a live contest. Each contest starts you at 0. The strip at the top of Games and Points shows which contest you're playing; tap another to switch.
3. On the **Points** tab, tap **Watch video for 10 points**. In test mode a fake 5-second video plays instead of a real ad.
4. Go to **Games**, pick a sport, and tap a line. Tap **Watch ad to confirm pick**, let the ad finish, then tap **Confirm pick**.
5. Once you're at 0 points with no picks in play in that contest, Points lets you watch for 10 more (up to 5 times a day in each contest).
6. After a game starts, **My Picks** shows a red **FORFEIT THIS PICK** button on that pick. Forfeiting counts it as a loss, so you can get back to 0 and watch for new points sooner.
7. Check **My Picks** after the game ends. Picks are graded a few hours after games finish (on the free plan, scores are checked a few times a day).
8. Open a contest to see its board. Tap any name to see that player's record.
9. The bell at the top left turns each kind of notification on or off. On Android, Expo Go can't receive push notifications, so that part needs a development build; on iPhone, Expo Go works.
10. When a contest ends, tap **Pick winner** on the admin page. The winner sees **Claim your prize** on the contest. Their details then appear under **Winners** on the admin page.

Lines only appear after the server's first update for that sport. On the free plan, 2 or 3 sports get fresh lines each day, about 2 hours before their first game, and the sports take turns. A sport that shows "Lines coming soon" will usually have lines later today or tomorrow. If a sport shows no games, try another one or check back later.

## Admin checks (optional)

The admin page at `/admin` shows how many Odds API credits are left at the top. The README describes everything else on it.

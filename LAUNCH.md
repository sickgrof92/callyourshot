# Launch checklist

Everything here is only needed when you go live with real players. For testing, the defaults (stub sign-in, stub ads, Render free plan) work as they are.

## 1. Keep the data: Render Starter plan and a disk

The free plan has no disk, so the database resets on every restart or deploy.

1. In Render, open the **callyourshot-api** service, then **Settings** > **Instance Type**, and choose **Starter**.
2. Open **Disks** > **Add disk**. Name `data`, mount path `/var/data`, size 1 GB.
3. In **Environment**, set `DB_PATH` to `/var/data/callyourshot.db`.
4. Save. The service redeploys and from then on keeps its data.

(The same steps are commented in `render.yaml` if you'd rather edit the Blueprint.)

## 2. Server settings (Render > Environment)

| Setting | Value | What it does |
| --- | --- | --- |
| `CLAIMS_KEY` | a long random string (Render can generate it) | Encrypts winners' prize details (legal name, address, birth date, tax ID). Winners can't claim until it's set. **Never change it after launch**, or old claims can't be read. |
| `AUTH_MODE` | `live` | Checks real Apple and Google sign-ins. `stub` lets anyone sign in for testing. |
| `APPLE_CLIENT_IDS` | `com.callyourshot.app` (your iOS bundle id) | Which Apple sign-ins to accept. |
| `GOOGLE_CLIENT_IDS` | your Google iOS, Android and web client ids, comma separated | Which Google sign-ins to accept. |
| `AD_PROVIDER` | `admob` | Points only come from AdMob's signed server callback, never from the app. |
| `ADMOB_AD_UNIT_IDS` | your rewarded ad unit ids, comma separated | Callbacks from any other ad unit are refused. |
| `TERMS_VERSION` | the date of your final rules, e.g. `2026-12-01` | Recorded with each player's agreement at sign-up. |
| `EXPO_ACCESS_TOKEN` | optional | Only if you turn on "enhanced push security" in Expo. |

The server warns in its log at startup if sign-in or ads are still stubbed, or `CLAIMS_KEY` is missing.

### Grading picks within 5 minutes (paid Odds API plan)

The FAQ tells players picks are graded within about 5 minutes of a game ending. On the free tier (500 credits a month) the server can't afford that: it checks scores about once per sport every 12 hours, after that day's games. When you move to a paid plan, set these two and redeploy:

| Setting | Value | What it does |
| --- | --- | --- |
| `ODDS_API_MONTHLY_CREDITS` | your plan's credits, e.g. `20000` on the $30 plan | Takes the server out of its free-tier "lean" mode. |
| `SCORES_INTERVAL_MINUTES` | `5` (default `30`) | How often scores are checked once a game with picks on it should be over. Each check costs 2 credits per sport, and checks stop once every pick is graded. If the month runs short, the server stretches the gap on its own so it never runs out. |

Postponed and cancelled games don't depend on this: the schedule is free to check, so the server looks every 30 minutes and refunds those picks as soon as the game is moved or dropped.

## 3. Sign in with Apple

1. In your Apple Developer account, open **Certificates, Identifiers & Profiles** > **Identifiers**, select the app id `com.callyourshot.app` (create it if needed), and tick **Sign in with Apple**.
2. Nothing else is needed for the app: `app.json` already has `usesAppleSignIn` and the plugin. EAS Build picks up the capability.
3. App Store rule: apps with sign-in must let players delete their account from inside the app. That's in the menu (Delete my account). Mention in the privacy policy that paid prize records are kept for tax purposes.

## 4. Sign in with Google

1. In Google Cloud Console, create a project and set up the **OAuth consent screen**.
2. Under **Credentials**, create three OAuth client ids: **iOS** (bundle id `com.callyourshot.app`), **Android** (package name and your signing key's SHA-1 from `eas credentials`), and **Web**.
3. In `app/app.json`, replace `REPLACE_WITH_IOS_CLIENT_ID` in the google-signin plugin's `iosUrlScheme` with the iOS client id's reversed form (Google shows it as "iOS URL scheme").
4. Set these for app builds (EAS secrets or `.env.local`):
   - `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`
   - `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`
5. Put all three client ids in the server's `GOOGLE_CLIENT_IDS`.

Real Apple and Google sign-in need a development or store build (`eas build`); Expo Go only supports the test sign-in.

## 5. Push notifications

1. In `app/`, run `npx eas init` once. It adds your EAS project id to `app.json`, which push tokens need.
2. Build with EAS. For iOS, EAS sets up the push key when it asks. For Android, upload an FCM key in the Expo dashboard (**Credentials** > **FCM V1**).
3. Expo Go on Android can't receive remote push; use a development build to test it. The app handles that case and just doesn't offer push.

## 6. AdMob

See "Turning on real ads (AdMob)" in the README. Add each rewarded unit id to `ADMOB_AD_UNIT_IDS` too.

## 7. Legal text

The Official Rules and Privacy Policy are served by the server at `/rules` and `/privacy`, and the app links to them at sign-up and on the Rules screen. Put the final text in:

- `server/src/legal/rules.html`
- `server/src/legal/privacy.html`

Then bump `TERMS_VERSION`. Use the same URLs in App Store Connect and Google Play.

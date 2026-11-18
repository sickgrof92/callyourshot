# Android build for Google Play testing

New personal Google Play developer accounts can't publish an app until it has been in a **closed test with at least 12 testers, opted in for 14 days in a row**. This guide gets a build into a closed test so that clock starts.

The build talks to your Render server and follows its settings. While Render has `AUTH_MODE=stub` and `AD_PROVIDER=stub`, testers get the test sign-in and the 5-second fake video, exactly like Expo Go. Nothing in the app has to change for that.

## Before you start

- **Check the server address.** `app/eas.json` points builds at `https://callyourshot-api.onrender.com`. If your Render URL is different, change both `EXPO_PUBLIC_API_URL` lines in `app/eas.json` to your URL (no slash at the end). The address is built into the app, so a wrong one means rebuilding.
- **Keep testers' data.** Set up `DATABASE_URL` first (TESTING.md, "Keep your data"). Without it, Render's free plan wipes every account, contest and point whenever the server restarts, redeploys or sleeps.

## Part 1: Expo account and first build (about 30 minutes, mostly waiting)

1. Make a free account at [expo.dev](https://expo.dev/signup).
2. On your computer, open a terminal in the `app` folder. Get the latest code first (`git pull`, or download the ZIP again), then run `npm install`.
3. Log in:
   ```
   npx eas-cli@latest login
   ```
4. Link the app to your Expo account. It asks to create a project, so say yes. This adds a project id to `app.json`.
   ```
   npx eas-cli@latest init
   ```
5. Optional quick check on your own phone: build an APK you can install directly.
   ```
   npx eas-cli@latest build --platform android --profile preview
   ```
   When it asks to generate a new Android keystore, say **yes**. When it finishes, it shows a link and a QR code. Open it on your Android phone and install the app. You may need to allow installs from your browser.
6. Build for Google Play. This makes an `.aab` file, which is what Play wants:
   ```
   npx eas-cli@latest build --platform android --profile production
   ```
   Builds take about 10 to 20 minutes on the free plan, sometimes longer in a queue. When it's done, open the build page on expo.dev and click **Download** to save the `.aab` file.

Keep the keystore EAS made. It lives on Expo's servers and signs every future update. You never need to handle it yourself.

## Part 2: Google Play Console

1. Sign up at [play.google.com/console](https://play.google.com/console). There's a one-time $25 fee, and Google checks your identity, which can take a few days.
2. Click **Create app**:
   - App name: Call Your Shot
   - Default language: English (United States)
   - App or game: **Game**
   - Free or paid: **Free**
   - Accept the declarations.
3. Under **Test and release** > **Testing** > **Closed testing**, open the default track (often called "Alpha"), or create one.
4. **Testers:** choose **Email lists** and create a list, or use a **Google Group** (easiest for 12+ people, since they just join the group). Add at least 12 Google accounts. 15 or more is safer, in case someone drops out before day 14. Save, and copy the **opt-in link** shown there.
5. **Create a release** on that track, upload the `.aab` from Part 1, give it a name like "1.0.0 test 1", and save.
6. Play won't let you send the release for review until the **App content** and store listing sections are filled in (Dashboard shows a checklist). The main ones:
   - **Privacy policy URL:** `https://callyourshot-api.onrender.com/privacy`, or your own URL.
   - **Ads:** Yes, the app contains ads.
   - **App access:** say sign-in is required and give instructions. While the server is in test mode, any reviewer can just tap a sign-in button, so write: "Test mode: tap Continue with Google or Apple to sign in, no account needed."
   - **Content rating:** fill in the questionnaire honestly. There's no real-money play and no purchases. Prizes are awarded in free contests.
   - **Target audience:** 18 and over.
   - **Data safety:** the app collects email, phone number, approximate location (region check), date of birth, and, for winners, name and address. It uses ads (advertising ID). Data is encrypted in transit, and players can delete their account in the app.
   - **Store listing:** short and full description, the app icon (512×512), a feature graphic (1024×500) and at least 2 phone screenshots.
7. Click **Send for review** (under **Publishing overview**). The first review usually takes a few days.
8. Once it's approved, send testers the **opt-in link**. Each tester opens it while signed in to the Google account on your list, taps **Become a tester**, then installs Call Your Shot from the Play Store link on that page.

The 14 days count from when at least 12 testers have opted in. Testers need to stay opted in the whole time. After 14 days, **Apply for production** shows up on the Dashboard.

## Sending testers an update

Change what you need, then run the production build again (step 6 in Part 1). The version code goes up automatically. Then create a new release on the same closed testing track and upload the new `.aab`. Updates are reviewed too, usually faster than the first one.

Most changes don't need a new build at all. Contests, lines, picks, rules and anything else on the server update for testers as soon as Render redeploys. Only changes to the app's screens need a new build.

## Before the real launch

Testing can stay in test mode. Before production, follow LAUNCH.md: real Google sign-in, real AdMob ads, the paid Render plan, and `AUTH_MODE=live` and `AD_PROVIDER=admob` on the server. Then make a new build.

One catch: once the server is in live mode, the test sign-in stops working, so every build has to be set up for real sign-in first (LAUNCH.md, step 4). For Google sign-in on Android, the SHA-1 to give Google is shown by `npx eas-cli@latest credentials`. Add the **App signing key** SHA-1 from Play Console too (**Test and release** > **Setup** > **App signing**), since Play re-signs the app.

# CPulls Cards — Mobile App Guide

Two ways to install CPulls Cards on a phone. Both are live now.

---

## Option A — Install as a PWA (works today, no store needed)

Nothing to build or submit. The site is already installable.

### iPhone / iPad (Safari)
1. Open `https://ccc-inventory-jd8a.onrender.com` in Safari
2. Tap the **Share** button (square with arrow up)
3. Scroll down → **Add to Home Screen**
4. Tap **Add** in the top-right

The app opens fullscreen (no Safari chrome), boots from the aubergine + gold "CC" icon, and works offline for browsing the last-visited pages.

### Android (Chrome / Edge / Samsung Internet)
1. Open the shop URL
2. The **Install CPulls Cards** banner appears at the bottom — tap **Install**
3. Or open the browser menu → **Install app** / **Add to Home Screen**

The install prompt inside the app also fires the native install flow.

### Desktop (Chrome / Edge)
1. Look for the install icon in the URL bar (small monitor with a down arrow)
2. Or use the in-app "Install" prompt
3. Runs in its own window like a regular desktop app

---

## Option B — Native iOS + Android apps (App Store / Play Store)

The Capacitor projects are already scaffolded under `ios/` and `android/`. You'll need Xcode (Mac) for iOS and Android Studio for Android — those can't run in this Linux sandbox.

The apps ship in **remote mode**: the native shell loads `https://ccc-inventory-jd8a.onrender.com` directly. That means every code change you push to `main` is instantly live in the apps too — no App Store resubmission needed for feature updates. Only submit a new binary when:
- You change the app icon or splash screen
- You update Capacitor plugins
- Apple/Google require a re-signed build

### One-time setup

**Bundle IDs already configured**:
- iOS: `com.cpullscards.app`
- Android: `com.cpullscards.app`

If you want a different ID (e.g. reverse of a domain you own), change `appId` in `capacitor.config.ts` and run `npx cap sync`.

### Building iOS (Mac only)

```bash
# From the repo root
npm run mobile:sync            # sync web assets + config into native project
npm run mobile:ios              # opens Xcode
```

In Xcode:
1. Select your team in **Signing & Capabilities**
2. Pick a physical device or simulator
3. Press ▶ to build and run

**To ship to App Store**:
1. Product → Archive
2. Distribute App → App Store Connect
3. Upload and submit for review through [App Store Connect](https://appstoreconnect.apple.com)

You'll need:
- Apple Developer account ($99/year)
- Screenshots for iPhone 6.7", 6.5", and iPad Pro (the site's storefront + a POS screen work well)
- Privacy policy URL
- App description, keywords, support URL

### Building Android (any OS)

```bash
npm run mobile:sync
npm run mobile:android          # opens Android Studio
```

In Android Studio:
1. Wait for Gradle sync
2. Pick an emulator or connected device
3. Press ▶ to build and run

**To ship to Play Store**:
1. **Build → Generate Signed Bundle / APK → Android App Bundle (.aab)**
2. Create a new upload keystore on first run (save it — you'll need it for every future update)
3. Upload the `.aab` to [Google Play Console](https://play.google.com/console)

You'll need:
- Google Play developer account ($25 one-time)
- Feature graphic (1024×500)
- Screenshots (at least 2, phone size)
- App description and content rating questionnaire

---

## Regenerating icons + splash

Master assets live in `resources/` (icon.png 1024×1024, splash.png 2732×2732). To regenerate every platform-specific size:

```bash
npm run mobile:icons            # runs @capacitor/assets against resources/
npm run mobile:sync             # copy the new assets into ios/ + android/
```

To change the master icons, edit `gen_icons.py` in the repo root and re-run it (produces both `client/public/*` and `resources/*` when combined with the Python script that lives above).

---

## Update flow (day-to-day)

**PWA updates**: just `git push` — every user's app picks up the new build within seconds via the service worker.

**Native app updates**:
- Web-only changes → nothing to do, the remote-mode shell already loads the new site.
- Icon / splash / native plugin changes → `npm run mobile:sync`, rebuild in Xcode / Android Studio, upload a new binary.

---

## Files added for the app layer

```
client/public/
  manifest.webmanifest          # PWA manifest with 5 icons + 4 shortcuts
  sw.js                         # Service worker (offline shell, smart cache)
  icon-192.png                  # Standard PWA icon
  icon-512.png                  # Standard PWA icon
  icon-192-maskable.png         # Android adaptive icon
  icon-512-maskable.png         # Android adaptive icon
  apple-touch-icon.png          # iOS home-screen icon (180×180)
  favicon.png                   # Browser tab icon
  splash-*.png                  # iOS + Android launch screens

client/src/
  main.tsx                      # Registers the service worker
  components/InstallPrompt.tsx  # Cross-platform "Install app" card

server/
  static.ts                     # Serves sw.js with Service-Worker-Allowed header

resources/
  icon.png, icon-only.png,
  icon-background.png,
  icon-foreground.png,          # Adaptive icon (Android 8+)
  splash.png, splash-dark.png   # Master 2732×2732 splashes

capacitor.config.ts             # Remote-mode config pointing at the Render URL
ios/                            # Xcode project (open with mobile:ios)
android/                        # Android Studio project (open with mobile:android)
```

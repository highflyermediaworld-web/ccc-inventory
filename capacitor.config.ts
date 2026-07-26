import type { CapacitorConfig } from "@capacitor/cli";

/**
 * CPulls Cards — Capacitor config.
 *
 * We ship in "remote-first" mode: the native app is a thin shell that loads
 * https://ccc-inventory-jd8a.onrender.com. Benefits:
 *   • Every code change goes live via the normal `git push` deploy.
 *   • No App Store / Play Store resubmission for feature updates.
 *   • The PWA service worker already handles offline caching.
 *
 * `webDir` still points at the built PWA so the app has a fallback shell to
 * load on first install (before the SW is registered).
 */

const config: CapacitorConfig = {
  appId: "com.cpullscards.app",
  appName: "CPulls Cards",
  webDir: "dist/public",

  server: {
    // Remote mode — load the live site directly.
    url: "https://ccc-inventory-jd8a.onrender.com",
    cleartext: false,
    // Only navigate within the allowed host; external links open in the system browser.
    allowNavigation: ["ccc-inventory-jd8a.onrender.com", "*.cpulls.cards"],
    androidScheme: "https",
    iosScheme: "https",
  },

  ios: {
    // Aubergine background matches the theme_color so there's no white flash.
    backgroundColor: "#361e3fff",
    contentInset: "always",
    limitsNavigationsToAppBoundDomains: false,
  },

  android: {
    backgroundColor: "#361e3fff",
    allowMixedContent: false,
  },

  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      launchAutoHide: true,
      backgroundColor: "#361e3fff",
      // Vector or PNG splash matches the aubergine + gold "CC" mark.
      androidSplashResourceName: "splash",
      iosSpinnerStyle: "small",
      spinnerColor: "#d4a428",
      showSpinner: true,
      splashFullScreen: true,
      splashImmersive: true,
    },
    StatusBar: {
      // Cream text/icons over aubergine background.
      style: "DARK",
      backgroundColor: "#361e3f",
      overlaysWebView: false,
    },
  },
};

export default config;

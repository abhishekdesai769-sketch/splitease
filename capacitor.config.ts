import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "ca.klarityit.spliiit",
  appName: "Spliiit",
  webDir: "dist/public",
  server: {
    // Load from the live Render backend so API calls work on device
    url: "https://spliiit.klarityit.ca",
    androidScheme: "https",
    iosScheme: "https",
  },
  ios: {
    contentInset: "automatic",
    preferredContentMode: "mobile",
    scheme: "Spliiit",
    minVersion: "16.0",
  },
  plugins: {
    // @codetrix-studio/capacitor-google-auth config
    // serverClientId = your Web OAuth Client ID (same as GOOGLE_CLIENT_ID on the server)
    // iosClientId   = the iOS OAuth Client ID you created in Google Cloud Console
    //                 (Application type: iOS, Bundle ID: ca.klarityit.spliiit)
    GoogleAuth: {
      scopes: ["profile", "email"],
      serverClientId: "314660995062-dd9g2np13sq0ojjim68pkjk606kse95t.apps.googleusercontent.com",
      iosClientId: "314660995062-9n1tqoks8mm5eb0ockhaff7r3tp6gq0e.apps.googleusercontent.com",
      forceCodeForRefreshToken: true,
    },
    SplashScreen: {
      launchAutoHide: true,
      launchShowDuration: 2000,
      backgroundColor: "#0a0f0d",
      showSpinner: false,
    },
    StatusBar: {
      style: "dark",
      backgroundColor: "#0a0f0d",
    },
    // iOS Push Notifications.
    // presentationOptions controls what shows when a push arrives while
    // the app is in the FOREGROUND. Without this, iOS silences foreground
    // pushes by default. With ['badge', 'sound', 'alert'] the user sees
    // a banner + hears the sound + the badge count updates even mid-use.
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },
  },
};

export default config;

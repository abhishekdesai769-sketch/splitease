import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "ca.klarityit.spliiit",
  appName: "Spliiit",
  webDir: "dist/public",
  server: {
    // In production, the app loads from the bundled web assets.
    // During development, you can uncomment the url below to use live reload:
    // url: "http://192.168.x.x:5000",
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
  },
};

export default config;

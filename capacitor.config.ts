import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "ca.klarityit.spliiit",
  appName: "Spliiit",
  webDir: "dist/public",
  server: {
    // Load from the live Render backend so API calls work on device
    url: "https://splitease-81re.onrender.com",
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

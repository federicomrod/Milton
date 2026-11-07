import type { ExpoConfig } from "expo/config";

// Staging by default: the stable r1-staging branch alias on Vercel. Override
// for local runs with EXPO_PUBLIC_API_BASE_URL (for example your Mac's LAN
// address while `npm run dev` runs the web app). No secret lives here: the app
// only ever holds a cook's device token, kept in the phone's secure store.
const DEFAULT_API_BASE_URL =
  "https://milton-git-r1-staging-federicomrods-projects.vercel.app";

const CAMERA_ES = "Milton usa la cámara para que envíes fotos de la cocina.";
const CAMERA_EN = "Milton uses the camera so you can send kitchen photos.";
const PHOTOS_ES = "Milton usa tus fotos para que envíes imágenes de la cocina.";
const PHOTOS_EN = "Milton uses your photos so you can send kitchen images.";
const MIC_ES = "Milton usa el micrófono para que envíes notas de voz.";
const MIC_EN = "Milton uses the microphone so you can send voice notes.";

const FACE_ES =
  "Milton usa Face ID para que entres más rápido con tu cara. Tu PIN se guarda solo en este teléfono.";
const FACE_EN =
  "Milton uses Face ID so you can sign in faster. Your PIN stays only on this phone.";

const both = (es: string, en: string) => `${es} / ${en}`;

const config: ExpoConfig = {
  name: "Milton",
  slug: "milton-cocina",
  scheme: "milton",
  version: "0.1.0",
  orientation: "portrait",
  userInterfaceStyle: "light",
  icon: "./assets/icon.png",
  ios: {
    // PROPOSED, not registered anywhere yet: confirm the Apple team and this
    // id before the first signed build (see README, «iOS development build»).
    bundleIdentifier: "com.miltonlabs.milton",
    supportsTablet: false,
    infoPlist: {
      NSCameraUsageDescription: both(CAMERA_ES, CAMERA_EN),
      NSPhotoLibraryUsageDescription: both(PHOTOS_ES, PHOTOS_EN),
      NSMicrophoneUsageDescription: both(MIC_ES, MIC_EN),
    },
  },
  android: {
    adaptiveIcon: {
      backgroundColor: "#FFFFFF",
      foregroundImage: "./assets/android-icon-foreground.png",
      backgroundImage: "./assets/android-icon-background.png",
      monochromeImage: "./assets/android-icon-monochrome.png",
    },
    predictiveBackGestureEnabled: false,
  },
  plugins: [
    "expo-router",
    "expo-dev-client",
    "expo-secure-store",
    ["expo-local-authentication", { faceIDPermission: both(FACE_ES, FACE_EN) }],
    [
      "expo-image-picker",
      {
        cameraPermission: both(CAMERA_ES, CAMERA_EN),
        photosPermission: both(PHOTOS_ES, PHOTOS_EN),
        microphonePermission: false,
      },
    ],
    ["expo-audio", { microphonePermission: both(MIC_ES, MIC_EN) }],
  ],
  extra: {
    apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL || DEFAULT_API_BASE_URL,
  },
};

export default config;

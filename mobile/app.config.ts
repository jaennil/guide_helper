import type { ExpoConfig } from "expo/config";

const apiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL ?? "https://guidehelper.dubrovskih.ru";
const googleMapsApiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;

const config: ExpoConfig = {
  name: "Guide Helper Mobile",
  slug: "guide-helper-mobile",
  version: "0.1.0",
  platforms: ["android"],
  orientation: "portrait",
  userInterfaceStyle: "dark",
  scheme: "guidehelper-mobile",
  plugins: [
    [
      "expo-location",
      {
        locationWhenInUsePermission:
          "Разрешите Guide Helper использовать геопозицию для записи маршрута во время движения.",
        locationAlwaysAndWhenInUsePermission:
          "Разрешите Guide Helper использовать геопозицию в фоне, чтобы маршрут не обрывался при сворачивании приложения.",
        isIosBackgroundLocationEnabled: true,
        isAndroidBackgroundLocationEnabled: true,
        isAndroidForegroundServiceEnabled: true,
      },
    ],
    [
      "expo-image-picker",
      {
        photosPermission:
          "Разрешите Guide Helper доступ к фото, чтобы прикреплять изображения к точкам маршрута.",
        cameraPermission:
          "Разрешите Guide Helper использовать камеру, чтобы фотографировать точки маршрута прямо во время прогулки.",
        microphonePermission: false,
      },
    ],
  ],
  android: {
    package: "ru.dubrovskih.guidehelper.mobile",
    config: googleMapsApiKey
      ? {
          googleMaps: {
            apiKey: googleMapsApiKey,
          },
        }
      : undefined,
  },
  extra: {
    apiBaseUrl,
    googleMapsApiKeyPresent: Boolean(googleMapsApiKey),
  },
};

export default config;

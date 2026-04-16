import * as Location from "expo-location";

export const BACKGROUND_TRACKING_TASK = "guide-helper-background-location-task";

export const FOREGROUND_TRACKING_OPTIONS: Location.LocationOptions = {
  accuracy: Location.Accuracy.BestForNavigation,
  timeInterval: 5000,
  distanceInterval: 5,
  mayShowUserSettingsDialog: true,
};

export const BACKGROUND_TRACKING_OPTIONS: Location.LocationTaskOptions = {
  accuracy: Location.Accuracy.BestForNavigation,
  timeInterval: 5000,
  distanceInterval: 5,
  deferredUpdatesDistance: 25,
  deferredUpdatesInterval: 60_000,
  pausesUpdatesAutomatically: false,
  showsBackgroundLocationIndicator: true,
  foregroundService: {
    notificationTitle: "Guide Helper записывает маршрут",
    notificationBody: "Трек продолжается даже при свёрнутом приложении.",
  },
};

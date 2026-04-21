import { useMemo, useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { TrackingScreen } from "./src/screens/TrackingScreen";
import { RoutesScreen } from "./src/screens/RoutesScreen";
import { RouteDetailsScreen } from "./src/screens/RouteDetailsScreen";

type AppScreen = "track" | "routes" | "route-details";

export default function App() {
  const [screen, setScreen] = useState<AppScreen>("track");
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const [selectedPendingUploadId, setSelectedPendingUploadId] = useState<string | null>(null);

  const navItems = useMemo(
    () => [
      { id: "track" as const, label: "Запись" },
      { id: "routes" as const, label: "Маршруты" },
    ],
    [],
  );

  function openRouteDetails(routeId: string) {
    setSelectedRouteId(routeId);
    setScreen("route-details");
  }

  function openPendingUpload(uploadId: string) {
    setSelectedPendingUploadId(uploadId);
    setScreen("track");
  }

  function renderScreen() {
    if (screen === "routes") {
      return (
        <RoutesScreen
          isActive
          onNavigateTrack={() => {
            setScreen("track");
          }}
          onOpenRoute={openRouteDetails}
          onOpenPendingUpload={openPendingUpload}
        />
      );
    }

    if (screen === "route-details" && selectedRouteId) {
      return (
        <RouteDetailsScreen
          routeId={selectedRouteId}
          isActive
          onBack={() => {
            setScreen("routes");
          }}
          onDeleted={() => {
            setSelectedRouteId(null);
            setScreen("routes");
          }}
        />
      );
    }

    return (
      <TrackingScreen
        pendingUploadToOpenId={selectedPendingUploadId}
        onPendingUploadHandled={() => {
          setSelectedPendingUploadId(null);
        }}
      />
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.screenContainer}>{renderScreen()}</View>

      <View style={styles.tabBar}>
        {navItems.map((item) => {
          const isActive =
            (screen === "track" && item.id === "track") ||
            ((screen === "routes" || screen === "route-details") && item.id === "routes");

          return (
            <TouchableOpacity
              key={item.id}
              activeOpacity={0.86}
              onPress={() => {
                setScreen(item.id);
              }}
              style={[styles.tabButton, isActive && styles.tabButtonActive]}
            >
              <Text style={[styles.tabButtonText, isActive && styles.tabButtonTextActive]}>
                {item.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#0f1221",
  },
  screenContainer: {
    flex: 1,
  },
  tabBar: {
    alignItems: "center",
    backgroundColor: "rgba(14, 18, 33, 0.96)",
    borderColor: "#252c52",
    borderRadius: 22,
    borderWidth: 1,
    bottom: 16,
    flexDirection: "row",
    gap: 12,
    left: 16,
    padding: 8,
    position: "absolute",
    right: 16,
  },
  tabButton: {
    alignItems: "center",
    borderRadius: 16,
    flex: 1,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  tabButtonActive: {
    backgroundColor: "#4f7cff",
  },
  tabButtonText: {
    color: "#9aa3c7",
    fontSize: 14,
    fontWeight: "700",
  },
  tabButtonTextActive: {
    color: "#f7f8fd",
  },
});

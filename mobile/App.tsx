import "./src/location/locationTask";

import { useEffect, useState } from "react";
import {
  Alert,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import MapView, { Marker, Polyline } from "react-native-maps";
import { clearStoredTokens, getStoredTokens, login, register } from "./src/api/auth";
import { useTrackingSession } from "./src/hooks/useTrackingSession";
import { formatDistance, formatDuration } from "./src/utils/geo";

const FALLBACK_REGION = {
  latitude: 55.7558,
  longitude: 37.6173,
  latitudeDelta: 0.02,
  longitudeDelta: 0.02,
};
const HAS_ANDROID_MAPS_KEY = Boolean(process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY);

function buildRegion(
  coordinates: Array<{ latitude: number; longitude: number }>,
) {
  if (coordinates.length === 0) {
    return FALLBACK_REGION;
  }

  if (coordinates.length === 1) {
    return {
      latitude: coordinates[0].latitude,
      longitude: coordinates[0].longitude,
      latitudeDelta: 0.01,
      longitudeDelta: 0.01,
    };
  }

  const latitudes = coordinates.map((point) => point.latitude);
  const longitudes = coordinates.map((point) => point.longitude);
  const minLatitude = Math.min(...latitudes);
  const maxLatitude = Math.max(...latitudes);
  const minLongitude = Math.min(...longitudes);
  const maxLongitude = Math.max(...longitudes);

  return {
    latitude: (minLatitude + maxLatitude) / 2,
    longitude: (minLongitude + maxLongitude) / 2,
    latitudeDelta: Math.max(0.01, (maxLatitude - minLatitude) * 1.6),
    longitudeDelta: Math.max(0.01, (maxLongitude - minLongitude) * 1.6),
  };
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metricCard}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

function ActionButton({
  title,
  onPress,
  variant = "primary",
  disabled = false,
}: {
  title: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "danger";
  disabled?: boolean;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.button,
        variant === "secondary" && styles.buttonSecondary,
        variant === "danger" && styles.buttonDanger,
        disabled && styles.buttonDisabled,
      ]}
    >
      <Text style={styles.buttonText}>{title}</Text>
    </TouchableOpacity>
  );
}

export default function App() {
  const {
    session,
    metrics,
    foregroundPermission,
    backgroundPermission,
    backgroundActive,
    backgroundAvailable,
    isBusy,
    isUploading,
    error,
    startSession,
    pauseSession,
    resumeSession,
    stopSession,
    resetSession,
    renameSession,
    saveRoute,
  } = useTrackingSession();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [hasAuthSession, setHasAuthSession] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);

  useEffect(() => {
    async function bootstrapAuth() {
      const tokens = await getStoredTokens();
      setHasAuthSession(Boolean(tokens?.access_token));
    }

    void bootstrapAuth();
  }, []);

  const coordinates = session.samples.map((sample) => ({
    latitude: sample.latitude,
    longitude: sample.longitude,
  }));
  const lastCoordinate = coordinates[coordinates.length - 1];
  const mapRegion = buildRegion(coordinates);
  const canRenderNativeMap = Platform.OS !== "android" || HAS_ANDROID_MAPS_KEY;

  async function runAuthAction(mode: "login" | "register") {
    if (!email.trim() || !password.trim()) {
      Alert.alert("Нужны учётные данные", "Укажи email и пароль.");
      return;
    }

    setAuthBusy(true);

    try {
      if (mode === "login") {
        await login(email.trim(), password);
      } else {
        await register(email.trim(), password);
      }

      setHasAuthSession(true);
      Alert.alert("Готово", mode === "login" ? "Вход выполнен." : "Аккаунт создан.");
    } catch (authError) {
      Alert.alert(
        "Ошибка авторизации",
        authError instanceof Error ? authError.message : "Не удалось авторизоваться.",
      );
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleLogout() {
    await clearStoredTokens();
    setHasAuthSession(false);
  }

  async function handleSaveRoute() {
    try {
      const savedRoute = await saveRoute();
      Alert.alert("Маршрут сохранён", `ID: ${savedRoute.id}`);
    } catch (saveError) {
      Alert.alert(
        "Сохранение не удалось",
        saveError instanceof Error ? saveError.message : "Не удалось сохранить маршрут.",
      );
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <Text style={styles.kicker}>Guide Helper Mobile</Text>
          <Text style={styles.title}>GPS-трекинг маршрута</Text>
          <Text style={styles.subtitle}>
            Запись пути, времени и скорости на устройстве с последующей выгрузкой в текущую
            модель маршрутов Guide Helper.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Авторизация</Text>
          <Text style={styles.cardHint}>
            Трек можно записывать и без логина. Авторизация нужна для выгрузки маршрута на сервер.
          </Text>

          {hasAuthSession ? (
            <View style={styles.inlineRow}>
              <Text style={styles.statusOk}>Сессия сохранена</Text>
              <ActionButton
                title="Выйти"
                variant="secondary"
                onPress={() => {
                  void handleLogout();
                }}
              />
            </View>
          ) : (
            <>
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                placeholder="Email"
                placeholderTextColor="#6c7293"
                style={styles.input}
                value={email}
                onChangeText={setEmail}
              />
              <TextInput
                secureTextEntry
                placeholder="Пароль"
                placeholderTextColor="#6c7293"
                style={styles.input}
                value={password}
                onChangeText={setPassword}
              />
              <View style={styles.buttonRow}>
                <ActionButton
                  title={authBusy ? "Вход..." : "Войти"}
                  onPress={() => {
                    void runAuthAction("login");
                  }}
                  disabled={authBusy}
                />
                <ActionButton
                  title={authBusy ? "Регистрация..." : "Регистрация"}
                  variant="secondary"
                  onPress={() => {
                    void runAuthAction("register");
                  }}
                  disabled={authBusy}
                />
              </View>
            </>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Сессия записи</Text>
          <Text style={styles.cardHint}>
            В фоне запись работает только в development build. В Expo Go background-tracking
            ограничен самой платформой Expo.
          </Text>

          <TextInput
            placeholder="Название маршрута"
            placeholderTextColor="#6c7293"
            style={styles.input}
            value={session.name}
            onChangeText={(value) => {
              void renameSession(value);
            }}
          />

          <View style={styles.inlineRowWrap}>
            <Text style={styles.chip}>Статус: {session.status}</Text>
            <Text style={styles.chip}>FG: {foregroundPermission}</Text>
            <Text style={styles.chip}>BG: {backgroundPermission}</Text>
            <Text style={styles.chip}>
              Фон: {backgroundAvailable ? (backgroundActive ? "активен" : "готов") : "недоступен"}
            </Text>
          </View>

          <View style={styles.metricsGrid}>
            <MetricCard label="Дистанция" value={formatDistance(metrics.distanceKm)} />
            <MetricCard label="Время" value={formatDuration(metrics.durationMs)} />
            <MetricCard label="Средняя скорость" value={`${metrics.averageSpeedKmh.toFixed(1)} км/ч`} />
            <MetricCard label="Пик" value={`${metrics.maxSpeedKmh.toFixed(1)} км/ч`} />
          </View>

          <View style={styles.mapFrame}>
            {canRenderNativeMap ? (
              <MapView style={styles.map} region={mapRegion} showsUserLocation>
                {coordinates.length > 1 && (
                  <Polyline coordinates={coordinates} strokeColor="#4f7cff" strokeWidth={5} />
                )}
                {coordinates[0] && (
                  <Marker coordinate={coordinates[0]} title="Старт" pinColor="#22c55e" />
                )}
                {lastCoordinate && (
                  <Marker coordinate={lastCoordinate} title="Текущая точка" pinColor="#ef4444" />
                )}
              </MapView>
            ) : (
              <View style={styles.mapFallback}>
                <Text style={styles.mapFallbackTitle}>Карта временно отключена</Text>
                <Text style={styles.mapFallbackText}>
                  Для Android-превью нужен `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY`. Трекинг, метрики и
                  сохранение маршрута можно проверять и без карты.
                </Text>
                <Text style={styles.mapFallbackMeta}>
                  Последняя точка:{" "}
                  {lastCoordinate
                    ? `${lastCoordinate.latitude.toFixed(5)}, ${lastCoordinate.longitude.toFixed(5)}`
                    : "ещё не записана"}
                </Text>
              </View>
            )}
          </View>

          <Text style={styles.mapCaption}>
            Точек: {session.samples.length}
            {session.lastSavedRouteId ? ` • Последний route_id: ${session.lastSavedRouteId}` : ""}
          </Text>

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          <View style={styles.buttonRow}>
            {(session.status === "idle" || session.status === "stopped") && (
              <ActionButton
                title={isBusy ? "Запуск..." : "Старт"}
                onPress={() => {
                  void startSession();
                }}
                disabled={isBusy}
              />
            )}

            {session.status === "recording" && (
              <>
                <ActionButton
                  title="Пауза"
                  variant="secondary"
                  onPress={() => {
                    void pauseSession();
                  }}
                />
                <ActionButton
                  title="Финиш"
                  variant="danger"
                  onPress={() => {
                    void stopSession();
                  }}
                />
              </>
            )}

            {session.status === "paused" && (
              <>
                <ActionButton
                  title="Продолжить"
                  onPress={() => {
                    void resumeSession();
                  }}
                />
                <ActionButton
                  title="Завершить"
                  variant="danger"
                  onPress={() => {
                    void stopSession();
                  }}
                />
              </>
            )}
          </View>

          <View style={styles.buttonRow}>
            <ActionButton
              title={isUploading ? "Сохранение..." : "Выгрузить маршрут"}
              onPress={() => {
                void handleSaveRoute();
              }}
              disabled={!hasAuthSession || isUploading || session.samples.length < 2}
            />
            <ActionButton
              title="Сбросить"
              variant="secondary"
              onPress={() => {
                void resetSession();
              }}
              disabled={session.status === "recording"}
            />
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#0f1221",
  },
  content: {
    padding: 18,
    gap: 18,
  },
  hero: {
    gap: 8,
  },
  kicker: {
    color: "#7d8cff",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1.4,
    textTransform: "uppercase",
  },
  title: {
    color: "#f7f8fd",
    fontSize: 28,
    fontWeight: "800",
  },
  subtitle: {
    color: "#abb1cc",
    fontSize: 15,
    lineHeight: 22,
  },
  card: {
    backgroundColor: "#171b31",
    borderColor: "#2a3158",
    borderWidth: 1,
    borderRadius: 20,
    padding: 16,
    gap: 12,
  },
  cardTitle: {
    color: "#f7f8fd",
    fontSize: 18,
    fontWeight: "700",
  },
  cardHint: {
    color: "#98a0be",
    fontSize: 13,
    lineHeight: 20,
  },
  input: {
    backgroundColor: "#101426",
    borderColor: "#30385f",
    borderWidth: 1,
    borderRadius: 14,
    color: "#f7f8fd",
    fontSize: 15,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  buttonRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  inlineRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
  },
  inlineRowWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  chip: {
    backgroundColor: "#101426",
    borderColor: "#2f3560",
    borderRadius: 999,
    borderWidth: 1,
    color: "#c9d0ea",
    fontSize: 12,
    overflow: "hidden",
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  metricsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  metricCard: {
    backgroundColor: "#101426",
    borderColor: "#293053",
    borderRadius: 16,
    borderWidth: 1,
    minWidth: "47%",
    padding: 12,
  },
  metricLabel: {
    color: "#8a92b4",
    fontSize: 12,
    marginBottom: 6,
  },
  metricValue: {
    color: "#f7f8fd",
    fontSize: 18,
    fontWeight: "700",
  },
  mapFrame: {
    borderColor: "#2c345b",
    borderRadius: 18,
    borderWidth: 1,
    overflow: "hidden",
  },
  map: {
    height: 280,
    width: "100%",
  },
  mapFallback: {
    backgroundColor: "#0f1324",
    gap: 10,
    minHeight: 280,
    justifyContent: "center",
    padding: 18,
  },
  mapFallbackTitle: {
    color: "#f7f8fd",
    fontSize: 18,
    fontWeight: "700",
  },
  mapFallbackText: {
    color: "#aab1cb",
    fontSize: 14,
    lineHeight: 21,
  },
  mapFallbackMeta: {
    color: "#7f88aa",
    fontSize: 12,
  },
  mapCaption: {
    color: "#8f97b8",
    fontSize: 12,
  },
  button: {
    alignItems: "center",
    backgroundColor: "#4f7cff",
    borderRadius: 14,
    justifyContent: "center",
    minHeight: 48,
    minWidth: 140,
    paddingHorizontal: 16,
  },
  buttonSecondary: {
    backgroundColor: "#262d4f",
  },
  buttonDanger: {
    backgroundColor: "#d94b63",
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  buttonText: {
    color: "#f7f8fd",
    fontSize: 15,
    fontWeight: "700",
  },
  statusOk: {
    color: "#4ade80",
    fontSize: 14,
    fontWeight: "600",
  },
  errorText: {
    color: "#ff8a8a",
    fontSize: 13,
    lineHeight: 18,
  },
});

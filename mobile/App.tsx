import "./src/location/locationTask";

import { useEffect, useState } from "react";
import {
  Platform,
  ScrollView,
  StyleSheet,
  StatusBar,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
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

type FeedbackTone = "success" | "error" | "info";

type UiFeedback = {
  tone: FeedbackTone;
  title: string;
  text?: string;
};

type PillTone = "neutral" | "success" | "info" | "warning";

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

function StatusPill({ label, tone = "neutral" }: { label: string; tone?: PillTone }) {
  return (
    <View
      style={[
        styles.heroBadge,
        tone === "success" && styles.heroBadgeSuccess,
        tone === "info" && styles.heroBadgeInfo,
        tone === "warning" && styles.heroBadgeWarning,
      ]}
    >
      <Text style={styles.heroBadgeText}>{label}</Text>
    </View>
  );
}

function NoticeBanner({
  tone,
  title,
  text,
}: {
  tone: FeedbackTone;
  title: string;
  text?: string;
}) {
  return (
    <View
      style={[
        styles.noticeBanner,
        tone === "success" && styles.noticeBannerSuccess,
        tone === "error" && styles.noticeBannerError,
        tone === "info" && styles.noticeBannerInfo,
      ]}
    >
      <Text style={styles.noticeTitle}>{title}</Text>
      {text ? <Text style={styles.noticeText}>{text}</Text> : null}
    </View>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

function ActionButton({
  title,
  onPress,
  variant = "primary",
  disabled = false,
  fullWidth = false,
}: {
  title: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "danger";
  disabled?: boolean;
  fullWidth?: boolean;
}) {
  return (
    <TouchableOpacity
      activeOpacity={0.86}
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.button,
        !fullWidth && styles.buttonGrow,
        fullWidth && styles.buttonFullWidth,
        variant === "secondary" && styles.buttonSecondary,
        variant === "danger" && styles.buttonDanger,
        disabled && styles.buttonDisabled,
      ]}
    >
      <Text style={styles.buttonText}>{title}</Text>
    </TouchableOpacity>
  );
}

function formatGpsAccuracy(accuracy?: number | null) {
  if (typeof accuracy !== "number") {
    return "точность ещё не определена";
  }

  return `±${Math.round(accuracy)} м`;
}

function getGpsQuality(accuracy?: number | null) {
  if (typeof accuracy !== "number") {
    return "Ожидание GPS";
  }

  if (accuracy <= 15) {
    return "GPS отличный";
  }

  if (accuracy <= 40) {
    return "GPS хороший";
  }

  if (accuracy <= 100) {
    return "GPS слабый";
  }

  return "GPS неточный";
}

function getSessionTone(status: string): PillTone {
  if (status === "recording") {
    return "success";
  }

  if (status === "paused") {
    return "warning";
  }

  if (status === "stopped") {
    return "info";
  }

  return "neutral";
}

function getGpsTone(accuracy?: number | null): PillTone {
  if (typeof accuracy !== "number") {
    return "neutral";
  }

  if (accuracy <= 15) {
    return "success";
  }

  if (accuracy <= 40) {
    return "info";
  }

  if (accuracy <= 100) {
    return "warning";
  }

  return "neutral";
}

function getQueueTone(pendingUploadsCount: number): PillTone {
  if (pendingUploadsCount > 0) {
    return "warning";
  }

  return "neutral";
}

function getSessionStatusLabel(status: string) {
  if (status === "recording") {
    return "Идёт запись";
  }

  if (status === "paused") {
    return "Пауза";
  }

  if (status === "stopped") {
    return "Маршрут завершён";
  }

  return "Готов к старту";
}

function getBackgroundStatusLabel(backgroundAvailable: boolean, backgroundActive: boolean) {
  if (!backgroundAvailable) {
    return "Недоступна в текущей сборке";
  }

  if (backgroundActive) {
    return "Активна";
  }

  return "Готова";
}

function getServerStatusLabel(hasAuthSession: boolean, pendingUploadsCount: number) {
  if (hasAuthSession && pendingUploadsCount > 0) {
    return `Подключено, ожидают отправки: ${pendingUploadsCount}`;
  }

  if (hasAuthSession) {
    return "Подключено";
  }

  if (pendingUploadsCount > 0) {
    return `${pendingUploadsCount} маршрутов ждут входа и синхронизации`;
  }

  return "Не подключено";
}

function getRouteSummaryText({
  samplesCount,
  hasSavedRoute,
  pendingUploadsCount,
}: {
  samplesCount: number;
  hasSavedRoute: boolean;
  pendingUploadsCount: number;
}) {
  if (samplesCount === 0) {
    return "Маршрут ещё не начат.";
  }

  if (hasSavedRoute) {
    return "Последняя версия маршрута уже выгружена на сервер.";
  }

  if (pendingUploadsCount > 0) {
    return "Есть локальный черновик, который можно синхронизировать позже.";
  }

  if (samplesCount === 1) {
    return "Получена первая GPS-точка. Продолжай запись, чтобы построить маршрут.";
  }

  return `Записано ${samplesCount} точек. Маршрут готов к сохранению.`;
}

function getRecordingHint(status: string, samplesCount: number) {
  if (status === "recording") {
    return "Маршрут записывается. При необходимости можно поставить запись на паузу.";
  }

  if (status === "paused") {
    return "Запись остановлена временно. Можно продолжить или завершить маршрут.";
  }

  if (status === "stopped" && samplesCount >= 2) {
    return "Запись завершена. Теперь сохрани маршрут на сервер или локально.";
  }

  return "Сначала начни запись, затем пройди маршрут и заверши его.";
}

function getSaveHint(hasAuthSession: boolean, pendingUploadsCount: number) {
  if (hasAuthSession && pendingUploadsCount > 0) {
    return "Серверная сессия активна. Можно выгрузить текущий маршрут и синхронизировать локальные черновики.";
  }

  if (hasAuthSession) {
    return "Серверная сессия активна. Можно сразу выгружать маршрут.";
  }

  if (pendingUploadsCount > 0) {
    return "Локальные черновики уже сохранены. Войди в аккаунт, чтобы отправить их на сервер.";
  }

  return "Без входа доступно локальное сохранение. Для выгрузки на сервер нужен аккаунт.";
}

function formatSessionMoments(startedAt?: string, endedAt?: string) {
  if (!startedAt) {
    return "Запись ещё не запускалась.";
  }

  const started = new Date(startedAt).toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  });

  if (!endedAt) {
    return `Старт записи: ${started}`;
  }

  const ended = new Date(endedAt).toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  });

  return `Старт: ${started} • Завершение: ${ended}`;
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
    isSyncing,
    error,
    pendingUploads,
    startSession,
    pauseSession,
    resumeSession,
    stopSession,
    resetSession,
    renameSession,
    saveRoute,
    queueRouteForUpload,
    syncPendingUploads,
  } = useTrackingSession();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [hasAuthSession, setHasAuthSession] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [authExpanded, setAuthExpanded] = useState(false);
  const [feedback, setFeedback] = useState<UiFeedback | null>(null);
  const { height: windowHeight } = useWindowDimensions();

  useEffect(() => {
    async function bootstrapAuth() {
      const tokens = await getStoredTokens();
      setHasAuthSession(Boolean(tokens?.access_token));
    }

    void bootstrapAuth();
  }, []);

  useEffect(() => {
    if (error) {
      setFeedback({
        tone: "error",
        title: "Не удалось выполнить действие",
        text: error,
      });
    }
  }, [error]);

  useEffect(() => {
    if (hasAuthSession) {
      setAuthExpanded(false);
    }
  }, [hasAuthSession]);

  const coordinates = session.samples.map((sample) => ({
    latitude: sample.latitude,
    longitude: sample.longitude,
  }));
  const lastSample = session.samples[session.samples.length - 1];
  const lastCoordinate = coordinates[coordinates.length - 1];
  const mapRegion = buildRegion(coordinates);
  const canRenderNativeMap = Platform.OS !== "android" || HAS_ANDROID_MAPS_KEY;
  const canSaveRoute = session.samples.length >= 2;
  const showSaveSection = canSaveRoute || pendingUploads.length > 0;
  const primaryRecordButtonLabel =
    session.status === "stopped" && session.samples.length > 0 ? "Новая запись" : "Начать запись";
  const mapHeight = Math.max(190, Math.min(280, Math.round(windowHeight * 0.28)));

  async function runAuthAction(mode: "login" | "register") {
    if (!email.trim() || !password.trim()) {
      setFeedback({
        tone: "error",
        title: "Нужны учётные данные",
        text: "Укажи email и пароль, чтобы войти и выгружать маршруты на сервер.",
      });
      return;
    }

    setAuthBusy(true);
    setFeedback(null);

    try {
      if (mode === "login") {
        await login(email.trim(), password);
      } else {
        await register(email.trim(), password);
      }

      setHasAuthSession(true);
      setFeedback({
        tone: "success",
        title: mode === "login" ? "Вход выполнен" : "Аккаунт создан",
        text: "Теперь маршрут можно сразу выгрузить на сервер.",
      });
    } catch (authError) {
      setFeedback({
        tone: "error",
        title: "Ошибка авторизации",
        text: authError instanceof Error ? authError.message : "Не удалось авторизоваться.",
      });
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleLogout() {
    await clearStoredTokens();
    setHasAuthSession(false);
    setFeedback({
      tone: "info",
      title: "Сессия очищена",
      text: "Запись и локальное сохранение по-прежнему доступны без входа.",
    });
  }

  async function handleStartSession() {
    setFeedback(null);
    await startSession();
  }

  async function handlePauseSession() {
    await pauseSession();
    setFeedback({
      tone: "info",
      title: "Запись на паузе",
      text: "Текущий трек сохранён и готов к продолжению.",
    });
  }

  async function handleResumeSession() {
    setFeedback(null);
    await resumeSession();
  }

  async function handleStopSession() {
    await stopSession();
    setFeedback({
      tone: "success",
      title: "Маршрут завершён",
      text: "Теперь его можно сохранить локально или выгрузить на сервер.",
    });
  }

  async function handleResetSession() {
    await resetSession();
    setFeedback({
      tone: "info",
      title: "Черновик очищен",
      text: "Можно начать новую запись маршрута.",
    });
  }

  async function handleSaveRoute() {
    if (!hasAuthSession) {
      setAuthExpanded(true);
      setFeedback({
        tone: "info",
        title: "Нужен вход",
        text: "Чтобы выгрузить маршрут на сервер, войди в аккаунт. Локальное сохранение доступно и без входа.",
      });
      return;
    }

    try {
      await saveRoute();
      setFeedback({
        tone: "success",
        title: "Маршрут выгружен",
        text: "Сервер сохранил текущую версию маршрута.",
      });
    } catch (saveError) {
      setFeedback({
        tone: "error",
        title: "Сохранение не удалось",
        text: saveError instanceof Error ? saveError.message : "Не удалось сохранить маршрут.",
      });
    }
  }

  async function handleQueueRoute() {
    try {
      await queueRouteForUpload();
      setFeedback({
        tone: "success",
        title: "Маршрут сохранён локально",
        text: "Черновик останется на устройстве и сможет уйти на сервер позже.",
      });
    } catch (queueError) {
      setFeedback({
        tone: "error",
        title: "Локальное сохранение не удалось",
        text: queueError instanceof Error ? queueError.message : "Не удалось сохранить маршрут локально.",
      });
    }
  }

  async function handleSyncPendingUploads() {
    if (!hasAuthSession) {
      setAuthExpanded(true);
      setFeedback({
        tone: "info",
        title: "Нужен вход",
        text: "Войди в аккаунт, чтобы отправить локальные черновики на сервер.",
      });
      return;
    }

    try {
      const result = await syncPendingUploads();
      setFeedback({
        tone: result.failed > 0 ? "info" : "success",
        title: result.failed > 0 ? "Синхронизация завершена частично" : "Синхронизация завершена",
        text:
          result.failed > 0
            ? `Успешно отправлено: ${result.synced}. С ошибкой осталось: ${result.failed}.`
            : `Успешно отправлено: ${result.synced}. Очередь пуста.`,
      });
    } catch (syncError) {
      setFeedback({
        tone: "error",
        title: "Синхронизация не удалась",
        text: syncError instanceof Error ? syncError.message : "Не удалось синхронизировать маршруты.",
      });
    }
  }

  return (
    <View style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.hero}>
          <Text style={styles.kicker}>Guide Helper Mobile</Text>
          <Text style={styles.title}>Запись маршрута</Text>
          <Text style={styles.subtitle}>
            Один экран для трекинга, локального сохранения и серверной выгрузки маршрута.
          </Text>

          <View style={styles.heroBadgeRow}>
            <StatusPill
              label={getSessionStatusLabel(session.status)}
              tone={getSessionTone(session.status)}
            />
            <StatusPill
              label={getGpsQuality(lastSample?.accuracy)}
              tone={getGpsTone(lastSample?.accuracy)}
            />
            <StatusPill
              label={pendingUploads.length > 0 ? `${pendingUploads.length} к синхронизации` : "Очередь пуста"}
              tone={getQueueTone(pendingUploads.length)}
            />
          </View>
        </View>

        {feedback ? (
          <NoticeBanner tone={feedback.tone} title={feedback.title} text={feedback.text} />
        ) : null}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Текущий маршрут</Text>
          <Text style={styles.cardHint}>{getRecordingHint(session.status, session.samples.length)}</Text>

          <TextInput
            placeholder="Название маршрута"
            placeholderTextColor="#6c7293"
            style={styles.input}
            value={session.name}
            onChangeText={(value) => {
              void renameSession(value);
            }}
          />

          <Text style={styles.routeMeta}>{formatSessionMoments(session.startedAt, session.endedAt)}</Text>

          <View style={styles.mapFrame}>
            {canRenderNativeMap ? (
              <MapView style={[styles.map, { height: mapHeight }]} region={mapRegion} showsUserLocation>
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
              <View style={[styles.mapFallback, { minHeight: mapHeight }]}>
                <Text style={styles.mapFallbackTitle}>Запись работает и без карты</Text>
                <Text style={styles.mapFallbackText}>
                  В Android preview карта сейчас недоступна, но трекинг, метрики и сохранение маршрута уже работают.
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

          <Text style={styles.routeSummary}>
            {getRouteSummaryText({
              samplesCount: session.samples.length,
              hasSavedRoute: Boolean(session.lastSavedRouteId),
              pendingUploadsCount: pendingUploads.length,
            })}
          </Text>

          <View style={styles.detailList}>
            <DetailRow label="GPS" value={`${getGpsQuality(lastSample?.accuracy)} • ${formatGpsAccuracy(lastSample?.accuracy)}`} />
            <DetailRow
              label="Фоновая запись"
              value={getBackgroundStatusLabel(backgroundAvailable, backgroundActive)}
            />
            <DetailRow
              label="Сервер"
              value={getServerStatusLabel(hasAuthSession, pendingUploads.length)}
            />
            {foregroundPermission !== "granted" ? (
              <DetailRow label="Геолокация" value="Нужно разрешение на доступ к местоположению" />
            ) : null}
            {backgroundPermission === "denied" ? (
              <DetailRow
                label="Фон"
                value="Доступ запрещён. В фоне запись будет ограничена."
              />
            ) : null}
          </View>

          <View style={styles.metricsGrid}>
            <MetricCard label="Дистанция" value={formatDistance(metrics.distanceKm)} />
            <MetricCard label="Время" value={formatDuration(metrics.durationMs)} />
            <MetricCard label="Средняя скорость" value={`${metrics.averageSpeedKmh.toFixed(1)} км/ч`} />
            <MetricCard label="Текущая скорость" value={`${metrics.currentSpeedKmh.toFixed(1)} км/ч`} />
            <MetricCard label="Пик" value={`${metrics.maxSpeedKmh.toFixed(1)} км/ч`} />
            <MetricCard label="GPS-точки" value={String(session.samples.length)} />
          </View>

          <View style={styles.sectionBlock}>
            <Text style={styles.sectionTitle}>Управление записью</Text>

            {(session.status === "idle" || session.status === "stopped") && (
              <ActionButton
                title={isBusy ? "Запуск..." : primaryRecordButtonLabel}
                onPress={() => {
                  void handleStartSession();
                }}
                disabled={isBusy}
                fullWidth
              />
            )}

            {session.status === "recording" && (
              <View style={styles.buttonRow}>
                <ActionButton
                  title="Пауза"
                  variant="secondary"
                  onPress={() => {
                    void handlePauseSession();
                  }}
                />
                <ActionButton
                  title="Завершить"
                  variant="danger"
                  onPress={() => {
                    void handleStopSession();
                  }}
                />
              </View>
            )}

            {session.status === "paused" && (
              <View style={styles.buttonRow}>
                <ActionButton
                  title="Продолжить"
                  onPress={() => {
                    void handleResumeSession();
                  }}
                />
                <ActionButton
                  title="Завершить"
                  variant="danger"
                  onPress={() => {
                    void handleStopSession();
                  }}
                />
              </View>
            )}

            <ActionButton
              title="Сбросить черновик"
              variant="secondary"
              onPress={() => {
                void handleResetSession();
              }}
              disabled={session.status === "recording" || (session.samples.length === 0 && pendingUploads.length === 0)}
              fullWidth
            />
          </View>

          {showSaveSection ? (
            <View style={styles.sectionBlock}>
              <Text style={styles.sectionTitle}>Сохранение маршрута</Text>
              <Text style={styles.sectionHint}>{getSaveHint(hasAuthSession, pendingUploads.length)}</Text>

              {canSaveRoute ? (
                hasAuthSession ? (
                  <>
                    <ActionButton
                      title={isUploading ? "Сохранение..." : "Сохранить на сервер"}
                      onPress={() => {
                        void handleSaveRoute();
                      }}
                      disabled={isUploading || isSyncing}
                      fullWidth
                    />
                    <View style={styles.buttonRow}>
                      <ActionButton
                        title="Сохранить локально"
                        variant="secondary"
                        onPress={() => {
                          void handleQueueRoute();
                        }}
                        disabled={isUploading || isSyncing}
                      />
                      <ActionButton
                        title="Выйти"
                        variant="secondary"
                        onPress={() => {
                          void handleLogout();
                        }}
                        disabled={authBusy || isUploading || isSyncing}
                      />
                    </View>
                  </>
                ) : (
                  <>
                    <ActionButton
                      title="Сохранить локально"
                      onPress={() => {
                        void handleQueueRoute();
                      }}
                      disabled={isUploading || isSyncing}
                      fullWidth
                    />
                    <ActionButton
                      title="Войти для выгрузки на сервер"
                      variant="secondary"
                      onPress={() => {
                        setAuthExpanded((current) => !current);
                        setFeedback({
                          tone: "info",
                          title: "Серверная выгрузка требует входа",
                          text: "Локальное сохранение работает и без аккаунта.",
                        });
                      }}
                      disabled={authBusy}
                      fullWidth
                    />
                  </>
                )
              ) : null}

              {pendingUploads.length > 0 ? (
                <ActionButton
                  title={isSyncing ? "Синхронизация..." : `Синхронизировать ${pendingUploads.length}`}
                  variant="secondary"
                  onPress={() => {
                    void handleSyncPendingUploads();
                  }}
                  disabled={isSyncing}
                  fullWidth
                />
              ) : null}

              {authExpanded && !hasAuthSession ? (
                <View style={styles.authPanel}>
                  <Text style={styles.authPanelTitle}>Вход для серверной выгрузки</Text>
                  <Text style={styles.authPanelHint}>
                    Авторизация нужна только для выгрузки и синхронизации. Запись маршрута и локальное сохранение уже работают.
                  </Text>
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
                </View>
              ) : null}
            </View>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#0f1221",
  },
  content: {
    gap: 18,
    padding: 18,
    paddingBottom: 28,
    paddingTop:
      Platform.OS === "android"
        ? (StatusBar.currentHeight ?? 0) + 16
        : 20,
  },
  hero: {
    gap: 10,
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
    fontSize: 30,
    fontWeight: "800",
  },
  subtitle: {
    color: "#abb1cc",
    fontSize: 15,
    lineHeight: 22,
  },
  heroBadgeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 2,
  },
  heroBadge: {
    backgroundColor: "#11162b",
    borderColor: "#2f3560",
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  heroBadgeSuccess: {
    backgroundColor: "#10251d",
    borderColor: "#215842",
  },
  heroBadgeInfo: {
    backgroundColor: "#141f3f",
    borderColor: "#3652a4",
  },
  heroBadgeWarning: {
    backgroundColor: "#2b2411",
    borderColor: "#7b6720",
  },
  heroBadgeText: {
    color: "#c9d0ea",
    fontSize: 12,
    overflow: "hidden",
  },
  noticeBanner: {
    borderRadius: 18,
    borderWidth: 1,
    gap: 4,
    padding: 14,
  },
  noticeBannerSuccess: {
    backgroundColor: "#13281f",
    borderColor: "#27533a",
  },
  noticeBannerError: {
    backgroundColor: "#2a1620",
    borderColor: "#5d2639",
  },
  noticeBannerInfo: {
    backgroundColor: "#141b32",
    borderColor: "#34406f",
  },
  noticeTitle: {
    color: "#f7f8fd",
    fontSize: 14,
    fontWeight: "700",
  },
  noticeText: {
    color: "#b7c0de",
    fontSize: 13,
    lineHeight: 19,
  },
  card: {
    backgroundColor: "#171b31",
    borderColor: "#2a3158",
    borderRadius: 20,
    borderWidth: 1,
    gap: 14,
    padding: 16,
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
    borderRadius: 14,
    borderWidth: 1,
    color: "#f7f8fd",
    fontSize: 15,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  routeMeta: {
    color: "#7f88aa",
    fontSize: 12,
  },
  mapFrame: {
    borderColor: "#2c345b",
    borderRadius: 18,
    borderWidth: 1,
    overflow: "hidden",
  },
  map: {
    height: 300,
    width: "100%",
  },
  mapFallback: {
    backgroundColor: "#0f1324",
    gap: 10,
    justifyContent: "center",
    minHeight: 300,
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
  routeSummary: {
    color: "#c8d0ec",
    fontSize: 13,
    lineHeight: 20,
  },
  detailList: {
    backgroundColor: "#101426",
    borderColor: "#293053",
    borderRadius: 16,
    borderWidth: 1,
    gap: 10,
    padding: 14,
  },
  detailRow: {
    alignItems: "flex-start",
    gap: 4,
  },
  detailLabel: {
    color: "#7f88aa",
    fontSize: 12,
  },
  detailValue: {
    color: "#f7f8fd",
    fontSize: 14,
    fontWeight: "600",
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
  sectionBlock: {
    borderTopColor: "#27305a",
    borderTopWidth: 1,
    gap: 10,
    paddingTop: 14,
  },
  sectionTitle: {
    color: "#f7f8fd",
    fontSize: 16,
    fontWeight: "700",
  },
  sectionHint: {
    color: "#98a0be",
    fontSize: 13,
    lineHeight: 20,
  },
  buttonRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  button: {
    alignItems: "center",
    backgroundColor: "#4f7cff",
    borderRadius: 14,
    justifyContent: "center",
    minHeight: 50,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  buttonGrow: {
    flexBasis: 150,
    flexGrow: 1,
  },
  buttonFullWidth: {
    width: "100%",
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
    textAlign: "center",
  },
  authPanel: {
    backgroundColor: "#12172a",
    borderColor: "#2f3966",
    borderRadius: 18,
    borderWidth: 1,
    gap: 10,
    padding: 14,
  },
  authPanelTitle: {
    color: "#f7f8fd",
    fontSize: 15,
    fontWeight: "700",
  },
  authPanelHint: {
    color: "#9da6c6",
    fontSize: 13,
    lineHeight: 19,
  },
});

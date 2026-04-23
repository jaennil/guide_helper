import "../location/locationTask";

import { useEffect, useState } from "react";
import {
  Image,
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
import * as ImagePicker from "expo-image-picker";
import MapView, { Marker, Polyline } from "react-native-maps";
import { getCategories, type Category } from "../api/categories";
import { clearStoredTokens, getStoredTokens, login, register } from "../api/auth";
import { useTrackingSession } from "../hooks/useTrackingSession";
import {
  clampPhotoPreviewSize,
  clampPointMarkerSize,
  formatDistance,
  formatDuration,
} from "../utils/geo";

const FALLBACK_REGION = {
  latitude: 55.7558,
  longitude: 37.6173,
  latitudeDelta: 0.02,
  longitudeDelta: 0.02,
};
const HAS_ANDROID_MAPS_KEY = Boolean(process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY);
const ROUTE_LINE_COLOR_PRESETS = [
  "#3388ff",
  "#2563eb",
  "#14b8a6",
  "#22c55e",
  "#eab308",
  "#f97316",
  "#ef4444",
  "#ec4899",
  "#8b5cf6",
  "#111827",
];
const POINT_MARKER_SIZE_PRESETS = [24, 30, 38, 46];
const PHOTO_PREVIEW_SIZE_PRESETS = [32, 44, 56, 72, 84];
const SEASON_OPTIONS = [
  { value: "winter", label: "Зима" },
  { value: "spring", label: "Весна" },
  { value: "summer", label: "Лето" },
  { value: "autumn", label: "Осень" },
];

type FeedbackTone = "success" | "error" | "info";

type UiFeedback = {
  tone: FeedbackTone;
  title: string;
  text?: string;
};

type PointPhotoAction = "library" | "camera";

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
    return "Последний вариант маршрута уже выгружен на сервер.";
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

function formatRouteStartedAtInput(value?: string) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

function parseRouteStartedAtInput(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?$/);
  if (!match) {
    return null;
  }

  const [, year, month, day, hours = "00", minutes = "00"] = match;
  const date = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hours),
    Number(minutes),
  );

  if (
    Number.isNaN(date.getTime()) ||
    date.getFullYear() !== Number(year) ||
    date.getMonth() !== Number(month) - 1 ||
    date.getDate() !== Number(day)
  ) {
    return null;
  }

  return date.toISOString();
}

function formatRouteStartedAtPreview(value?: string) {
  if (!value) {
    return "Будет использовано время начала записи.";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Будет использовано время начала записи.";
  }

  return date.toLocaleString("ru-RU", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatCoordinates(latitude: number, longitude: number) {
  return `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
}

function getPointFallbackTitle(index: number, totalPoints: number, semanticHint?: "stop" | "turn") {
  if (index === 0) {
    return "Старт";
  }

  if (index === totalPoints - 1) {
    return "Финиш";
  }

  if (semanticHint === "stop") {
    return "Остановка";
  }

  if (semanticHint === "turn") {
    return "Поворот";
  }

  return `Точка ${index + 1}`;
}

function getSemanticBadgeLabel(semanticHint?: "stop" | "turn") {
  if (semanticHint === "stop") {
    return "Рекомендованная остановка";
  }

  if (semanticHint === "turn") {
    return "Рекомендованный ориентир";
  }

  return null;
}

function getSemanticHintText(semanticHint?: "stop" | "turn") {
  if (semanticHint === "stop") {
    return "Система заметила паузу в движении. Здесь обычно полезно описать место, впечатление или причину остановки.";
  }

  if (semanticHint === "turn") {
    return "Система выделила заметную смену направления. Здесь полезно добавить ориентир, чтобы маршрут было легче повторить.";
  }

  return null;
}

function getPointNotePlaceholder(semanticHint?: "stop" | "turn") {
  if (semanticHint === "stop") {
    return "Что это за место, почему здесь стоит остановиться, что посмотреть рядом.";
  }

  if (semanticHint === "turn") {
    return "Какой ориентир помогает не пропустить это место и куда нужно свернуть дальше.";
  }

  return "Что здесь важно: история места, личное впечатление, ориентир, совет туристу.";
}

interface TrackingScreenProps {
  pendingUploadToOpenId?: string | null;
  onPendingUploadHandled?: () => void;
}

export function TrackingScreen({
  pendingUploadToOpenId = null,
  onPendingUploadHandled,
}: TrackingScreenProps) {
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
    updateRoutePoint,
    resetRoutePointsFromSamples,
    setRouteStartedAt,
    toggleCategory,
    toggleSeason,
    setRouteLineColor,
    saveRoute,
    queueRouteForUpload,
    syncPendingUploads,
    loadPendingUploadDraft,
  } = useTrackingSession();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [hasAuthSession, setHasAuthSession] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [authExpanded, setAuthExpanded] = useState(false);
  const [feedback, setFeedback] = useState<UiFeedback | null>(null);
  const [availableCategories, setAvailableCategories] = useState<Category[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(false);
  const [startedAtInput, setStartedAtInput] = useState("");
  const [pointPhotoAction, setPointPhotoAction] = useState<{
    pointIndex: number;
    mode: PointPhotoAction;
  } | null>(null);
  const { height: windowHeight } = useWindowDimensions();

  useEffect(() => {
    async function bootstrapAuth() {
      const tokens = await getStoredTokens();
      setHasAuthSession(Boolean(tokens?.access_token));
    }

    void bootstrapAuth();
  }, []);

  useEffect(() => {
    let mounted = true;

    async function loadCategories() {
      setCategoriesLoading(true);

      try {
        const categories = await getCategories();
        if (mounted) {
          setAvailableCategories(categories);
        }
      } catch (loadError) {
        console.warn("Failed to load route categories", loadError);
      } finally {
        if (mounted) {
          setCategoriesLoading(false);
        }
      }
    }

    void loadCategories();

    return () => {
      mounted = false;
    };
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

  useEffect(() => {
    setStartedAtInput(formatRouteStartedAtInput(session.routeStartedAt ?? session.startedAt));
  }, [session.routeStartedAt, session.startedAt]);

  useEffect(() => {
    if (!pendingUploadToOpenId) {
      return;
    }

    const uploadId = pendingUploadToOpenId;
    let cancelled = false;

    async function openPendingUpload() {
      try {
        const loadedSession = await loadPendingUploadDraft(uploadId);
        if (cancelled) {
          return;
        }

        setFeedback({
          tone: "success",
          title: "Локальный черновик открыт",
          text: `Маршрут «${loadedSession.name}» загружен в редактор и готов к доработке или отправке.`,
        });
      } catch (loadError) {
        if (cancelled) {
          return;
        }

        setFeedback({
          tone: "error",
          title: "Черновик не открыт",
          text:
            loadError instanceof Error
              ? loadError.message
              : "Не удалось открыть локальный черновик.",
        });
      } finally {
        if (!cancelled) {
          onPendingUploadHandled?.();
        }
      }
    }

    void openPendingUpload();

    return () => {
      cancelled = true;
    };
  }, [onPendingUploadHandled, pendingUploadToOpenId]);

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
  const saveRouteButtonLabel =
    session.serverRouteId || session.lastSavedRouteId
      ? "Обновить на сервере"
      : "Сохранить на сервер";
  const editableRoutePoints = session.routePoints;

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
    const result = await stopSession();

    if (result.state === "cleared") {
      setFeedback({
        tone: "info",
        title: "Черновик очищен",
        text:
          result.sampleCount === 0
            ? "GPS-точки не были получены. Начни запись заново, когда геолокация станет доступна."
            : "Получено недостаточно GPS-точек для маршрута. Нужны минимум две точки, поэтому черновик очищен.",
      });
      return;
    }

    if (result.autoSavedLocally) {
      setFeedback({
        tone: "success",
        title: "Маршрут завершён и сохранён локально",
        text: "Черновик уже лежит на устройстве. Его можно синхронизировать позже или выгрузить на сервер после входа.",
      });
      return;
    }

    setFeedback({
      tone: "error",
      title: "Маршрут завершён, но автосохранение не сработало",
      text:
        result.autoSaveError ??
        "Трек остановлен, но локальный черновик не создался. Нажми «Сохранить локально», чтобы не потерять маршрут.",
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
      const wasUpdatingExistingRoute = Boolean(session.serverRouteId);
      setFeedback({
        tone: "success",
        title: wasUpdatingExistingRoute
          ? "Маршрут обновлён на сервере"
          : "Маршрут сохранён на сервере",
        text: wasUpdatingExistingRoute
          ? "Сервер получил обновлённый вариант маршрута."
          : "Маршрут выгружен на сервер и появится в списке синхронизированных маршрутов.",
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
        text: "Черновик останется на устройстве и сможет уйти на сервер позже, когда появятся вход и сеть.",
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
        title:
          result.failed > 0
            ? "Синхронизация завершена частично"
            : "Синхронизация завершена",
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

  async function handleRouteStartedAtSubmit() {
    const parsed = parseRouteStartedAtInput(startedAtInput);

    if (parsed === null) {
      setFeedback({
        tone: "error",
        title: "Неверный формат даты",
        text: "Используй формат ГГГГ-ММ-ДД ЧЧ:ММ, например 2025-08-14 09:30.",
      });
      return;
    }

    await setRouteStartedAt(parsed);
    setStartedAtInput(formatRouteStartedAtInput(parsed ?? session.startedAt));
  }

  async function handleResetRouteStartedAt() {
    const fallback = session.startedAt;
    await setRouteStartedAt(fallback);
    setStartedAtInput(formatRouteStartedAtInput(fallback));
  }

  async function attachImageAssetToPoint(
    pointIndex: number,
    asset: ImagePicker.ImagePickerAsset,
    source: PointPhotoAction,
  ) {
    if (!asset.base64) {
      setFeedback({
        tone: "error",
        title: source === "camera" ? "Снимок не подготовлен" : "Фото не подготовлено",
        text: "Не удалось получить данные изображения. Попробуй ещё раз.",
      });
      return;
    }

    const mimeType = asset.mimeType ?? "image/jpeg";
    await updateRoutePoint(pointIndex, {
      photo: {
        original: `data:${mimeType};base64,${asset.base64}`,
        status: "pending",
      },
    });
    setFeedback({
      tone: "success",
      title: source === "camera" ? "Снимок добавлен" : "Фото прикреплено",
      text: "Изображение сохранено в черновике маршрута и уйдёт на сервер вместе с точкой.",
    });
  }

  async function handlePickPointPhoto(pointIndex: number) {
    setPointPhotoAction({ pointIndex, mode: "library" });

    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (permission.status !== "granted") {
        setFeedback({
          tone: "error",
          title: "Нет доступа к фото",
          text: "Разреши доступ к медиатеке, чтобы прикреплять изображения к точкам маршрута.",
        });
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        quality: 0.7,
        base64: true,
      });

      if (result.canceled || !result.assets?.[0]) {
        return;
      }

      await attachImageAssetToPoint(pointIndex, result.assets[0], "library");
    } catch (pickerError) {
      setFeedback({
        tone: "error",
        title: "Не удалось выбрать фото",
        text: pickerError instanceof Error ? pickerError.message : "Попробуй ещё раз.",
      });
    } finally {
      setPointPhotoAction(null);
    }
  }

  async function handleCapturePointPhoto(pointIndex: number) {
    setPointPhotoAction({ pointIndex, mode: "camera" });

    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (permission.status !== "granted") {
        setFeedback({
          tone: "error",
          title: "Нет доступа к камере",
          text: "Разреши доступ к камере, чтобы фотографировать точки маршрута прямо из приложения.",
        });
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        quality: 0.7,
        base64: true,
        cameraType: ImagePicker.CameraType.back,
      });

      if (result.canceled || !result.assets?.[0]) {
        return;
      }

      await attachImageAssetToPoint(pointIndex, result.assets[0], "camera");
    } catch (cameraError) {
      setFeedback({
        tone: "error",
        title: "Не удалось сделать снимок",
        text: cameraError instanceof Error ? cameraError.message : "Попробуй ещё раз.",
      });
    } finally {
      setPointPhotoAction(null);
    }
  }

  async function handleRemovePointPhoto(pointIndex: number) {
    await updateRoutePoint(pointIndex, { photo: undefined });
    setFeedback({
      tone: "info",
      title: "Фото удалено",
      text: "Точка сохранена без прикреплённого изображения.",
    });
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
            Android companion app для записи маршрута в поле, локального черновика и последующей синхронизации с основным сервисом.
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
                  <Polyline coordinates={coordinates} strokeColor={session.lineColor} strokeWidth={5} />
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

          {canSaveRoute ? (
            <View style={styles.sectionBlock}>
              <Text style={styles.sectionTitle}>Параметры маршрута</Text>
              <Text style={styles.sectionHint}>
                Здесь настраивается итоговый маршрут перед локальным сохранением или отправкой на сервер.
              </Text>

              <View style={styles.formGroup}>
                <Text style={styles.fieldLabel}>Дата и время маршрута</Text>
                <TextInput
                  placeholder="2025-08-14 09:30"
                  placeholderTextColor="#6c7293"
                  style={styles.input}
                  value={startedAtInput}
                  onChangeText={setStartedAtInput}
                  onBlur={() => {
                    void handleRouteStartedAtSubmit();
                  }}
                  onEndEditing={() => {
                    void handleRouteStartedAtSubmit();
                  }}
                />
                <Text style={styles.fieldHint}>
                  Нужен формат ГГГГ-ММ-ДД ЧЧ:ММ. Это время будет использовано для исторического маршрута и связанных данных.
                </Text>
                <Text style={styles.fieldMeta}>
                  Текущее значение: {formatRouteStartedAtPreview(session.routeStartedAt ?? session.startedAt)}
                </Text>
                <ActionButton
                  title="Вернуть время начала записи"
                  variant="secondary"
                  onPress={() => {
                    void handleResetRouteStartedAt();
                  }}
                  fullWidth
                />
              </View>

              <View style={styles.formGroup}>
                <Text style={styles.fieldLabel}>Цвет линии маршрута</Text>
                <View style={styles.colorSwatchRow}>
                  {ROUTE_LINE_COLOR_PRESETS.map((color) => {
                    const isActive = session.lineColor.toLowerCase() === color.toLowerCase();
                    return (
                      <TouchableOpacity
                        key={color}
                        activeOpacity={0.9}
                        onPress={() => {
                          void setRouteLineColor(color);
                        }}
                        style={[
                          styles.colorSwatch,
                          isActive && styles.colorSwatchActive,
                        ]}
                      >
                        <View style={[styles.colorSwatchFill, { backgroundColor: color }]} />
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              <View style={styles.formGroup}>
                <Text style={styles.fieldLabel}>Сезоны</Text>
                <View style={styles.choiceRow}>
                  {SEASON_OPTIONS.map((season) => {
                    const isActive = session.seasons.includes(season.value);
                    return (
                      <TouchableOpacity
                        key={season.value}
                        activeOpacity={0.86}
                        onPress={() => {
                          void toggleSeason(season.value);
                        }}
                        style={[styles.choiceChip, isActive && styles.choiceChipActive]}
                      >
                        <Text
                          style={[styles.choiceChipText, isActive && styles.choiceChipTextActive]}
                        >
                          {season.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              <View style={styles.formGroup}>
                <Text style={styles.fieldLabel}>Категории</Text>
                {categoriesLoading ? (
                  <Text style={styles.fieldHint}>Загружаю категории сервера...</Text>
                ) : availableCategories.length > 0 ? (
                  <>
                    <View style={styles.choiceRow}>
                      {availableCategories.map((category) => {
                        const isActive = session.categoryIds.includes(category.id);
                        return (
                          <TouchableOpacity
                            key={category.id}
                            activeOpacity={0.86}
                            onPress={() => {
                              void toggleCategory(category.id);
                            }}
                            style={[styles.choiceChip, isActive && styles.choiceChipActive]}
                          >
                            <Text
                              style={[
                                styles.choiceChipText,
                                isActive && styles.choiceChipTextActive,
                              ]}
                            >
                              {category.name}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                    <Text style={styles.fieldHint}>Можно выбрать до пяти категорий.</Text>
                  </>
                ) : (
                  <Text style={styles.fieldHint}>
                    Категории недоступны. Маршрут всё равно можно сохранить.
                  </Text>
                )}
              </View>
            </View>
          ) : null}

          {session.status === "stopped" && editableRoutePoints.length > 0 ? (
            <View style={styles.sectionBlock}>
              <Text style={styles.sectionTitle}>Ключевые точки маршрута</Text>
              <Text style={styles.sectionHint}>
                Здесь можно уточнить названия, добавить заметки к местам и скорректировать время отдельных участков.
              </Text>

              <ActionButton
                title="Пересобрать точки из GPS"
                variant="secondary"
                onPress={() => {
                  void resetRoutePointsFromSamples();
                }}
                fullWidth
              />

              <View style={styles.pointList}>
                {editableRoutePoints.map((point, index) => {
                  const isFirstPoint = index === 0;
                  const isLastPoint = index === editableRoutePoints.length - 1;
                  const isPhotoBusy = pointPhotoAction !== null;
                  const isPickingFromLibrary =
                    pointPhotoAction?.pointIndex === index && pointPhotoAction.mode === "library";
                  const isCapturingFromCamera =
                    pointPhotoAction?.pointIndex === index && pointPhotoAction.mode === "camera";
                  const fallbackPointTitle = getPointFallbackTitle(
                    index,
                    editableRoutePoints.length,
                    point.semantic_hint,
                  );
                  const pointTitle = point.name?.trim() || fallbackPointTitle;
                  const semanticBadge = getSemanticBadgeLabel(point.semantic_hint);
                  const semanticHintText = getSemanticHintText(point.semantic_hint);

                  return (
                    <View
                      key={`${index}-${point.lat}-${point.lng}`}
                      style={[
                        styles.pointCard,
                        point.semantic_hint === "stop" && styles.pointCardSemanticStop,
                        point.semantic_hint === "turn" && styles.pointCardSemanticTurn,
                      ]}
                    >
                      <View style={styles.pointCardHeader}>
                        <Text style={styles.pointCardTitle}>{pointTitle}</Text>
                        <Text style={styles.pointCardMeta}>
                          {formatCoordinates(point.lat, point.lng)}
                        </Text>
                        {semanticBadge ? (
                          <View
                            style={[
                              styles.semanticBadge,
                              point.semantic_hint === "stop" && styles.semanticBadgeStop,
                              point.semantic_hint === "turn" && styles.semanticBadgeTurn,
                            ]}
                          >
                            <Text style={styles.semanticBadgeText}>{semanticBadge}</Text>
                          </View>
                        ) : null}
                        {semanticHintText ? (
                          <Text style={styles.semanticHint}>{semanticHintText}</Text>
                        ) : null}
                      </View>

                      <View style={styles.formGroup}>
                        <Text style={styles.fieldLabel}>Название точки</Text>
                        <TextInput
                          placeholder={pointTitle}
                          placeholderTextColor="#6c7293"
                          style={styles.input}
                          value={point.name ?? ""}
                          onChangeText={(value) => {
                            void updateRoutePoint(index, { name: value });
                          }}
                        />
                      </View>

                      <View style={styles.formGroup}>
                        <Text style={styles.fieldLabel}>Заметка</Text>
                        <TextInput
                          multiline
                          numberOfLines={4}
                          placeholder={getPointNotePlaceholder(point.semantic_hint)}
                          placeholderTextColor="#6c7293"
                          style={[styles.input, styles.noteInput]}
                          textAlignVertical="top"
                          value={point.note ?? ""}
                          onChangeText={(value) => {
                            void updateRoutePoint(index, { note: value });
                          }}
                        />
                      </View>

                      {!isFirstPoint ? (
                        <View style={styles.formGroup}>
                          <Text style={styles.fieldLabel}>Время участка до этой точки, минут</Text>
                          <TextInput
                            keyboardType="number-pad"
                            placeholder="Например 18"
                            placeholderTextColor="#6c7293"
                            style={styles.input}
                            value={point.segment_duration_minutes?.toString() ?? ""}
                            onChangeText={(value) => {
                              const digitsOnly = value.replace(/[^\d]/g, "");
                              void updateRoutePoint(index, {
                                segment_duration_minutes: digitsOnly
                                  ? Number(digitsOnly)
                                  : undefined,
                              });
                            }}
                          />
                        </View>
                      ) : null}

                      <View style={styles.formGroup}>
                        <Text style={styles.fieldLabel}>Маркер точки</Text>
                        <View style={styles.pointMarkerPreviewRow}>
                          <View
                            style={[
                              styles.pointMarkerPreview,
                              {
                                backgroundColor: point.marker_color ?? "#3388ff",
                                width: clampPointMarkerSize(point.marker_size),
                                height: clampPointMarkerSize(point.marker_size),
                                borderRadius: clampPointMarkerSize(point.marker_size),
                              },
                            ]}
                          />
                          <Text style={styles.fieldMeta}>
                            {point.marker_color ?? "#3388ff"} • {clampPointMarkerSize(point.marker_size)} px
                          </Text>
                        </View>
                        <View style={styles.colorSwatchRow}>
                          {ROUTE_LINE_COLOR_PRESETS.map((color) => {
                            const isActive =
                              (point.marker_color ?? "#3388ff").toLowerCase() === color.toLowerCase();
                            return (
                              <TouchableOpacity
                                key={`marker-${index}-${color}`}
                                activeOpacity={0.9}
                                onPress={() => {
                                  void updateRoutePoint(index, { marker_color: color });
                                }}
                                style={[
                                  styles.colorSwatch,
                                  isActive && styles.colorSwatchActive,
                                ]}
                              >
                                <View
                                  style={[
                                    styles.colorSwatchFill,
                                    { backgroundColor: color },
                                  ]}
                                />
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                        <View style={styles.choiceRow}>
                          {POINT_MARKER_SIZE_PRESETS.map((size) => {
                            const normalizedSize = clampPointMarkerSize(point.marker_size);
                            const isActive = normalizedSize === size;
                            return (
                              <TouchableOpacity
                                key={`marker-size-${index}-${size}`}
                                activeOpacity={0.86}
                                onPress={() => {
                                  void updateRoutePoint(index, { marker_size: size });
                                }}
                                style={[
                                  styles.choiceChip,
                                  isActive && styles.choiceChipActive,
                                ]}
                              >
                                <Text
                                  style={[
                                    styles.choiceChipText,
                                    isActive && styles.choiceChipTextActive,
                                  ]}
                                >
                                  {size}px
                                </Text>
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                      </View>

                      <View style={styles.formGroup}>
                        <Text style={styles.fieldLabel}>Фото точки</Text>
                        {point.photo?.original ? (
                          <View style={styles.pointPhotoCard}>
                            <Image
                              source={{ uri: point.photo.original }}
                              style={[
                                styles.pointPhotoPreview,
                                {
                                  width: clampPhotoPreviewSize(point.preview_size),
                                  height: clampPhotoPreviewSize(point.preview_size),
                                  borderRadius:
                                    point.preview_shape === "circle"
                                      ? clampPhotoPreviewSize(point.preview_size) / 2
                                      : 18,
                                },
                              ]}
                              resizeMode="cover"
                            />
                            <View style={styles.formGroup}>
                              <Text style={styles.fieldLabel}>Форма превью</Text>
                              <View style={styles.choiceRow}>
                                {["square", "circle"].map((shape) => {
                                  const isActive =
                                    (point.preview_shape ?? "square") === shape;
                                  return (
                                    <TouchableOpacity
                                      key={`preview-shape-${index}-${shape}`}
                                      activeOpacity={0.86}
                                      onPress={() => {
                                        void updateRoutePoint(index, {
                                          preview_shape: shape as "square" | "circle",
                                        });
                                      }}
                                      style={[
                                        styles.choiceChip,
                                        isActive && styles.choiceChipActive,
                                      ]}
                                    >
                                      <Text
                                        style={[
                                          styles.choiceChipText,
                                          isActive && styles.choiceChipTextActive,
                                        ]}
                                      >
                                        {shape === "circle" ? "Круг" : "Квадрат"}
                                      </Text>
                                    </TouchableOpacity>
                                  );
                                })}
                              </View>
                            </View>
                            <View style={styles.formGroup}>
                              <Text style={styles.fieldLabel}>Размер фото-превью</Text>
                              <View style={styles.choiceRow}>
                                {PHOTO_PREVIEW_SIZE_PRESETS.map((size) => {
                                  const normalizedSize = clampPhotoPreviewSize(point.preview_size);
                                  const isActive = normalizedSize === size;
                                  return (
                                    <TouchableOpacity
                                      key={`preview-size-${index}-${size}`}
                                      activeOpacity={0.86}
                                      onPress={() => {
                                        void updateRoutePoint(index, { preview_size: size });
                                      }}
                                      style={[
                                        styles.choiceChip,
                                        isActive && styles.choiceChipActive,
                                      ]}
                                    >
                                      <Text
                                        style={[
                                          styles.choiceChipText,
                                          isActive && styles.choiceChipTextActive,
                                        ]}
                                      >
                                        {size}px
                                      </Text>
                                    </TouchableOpacity>
                                  );
                                })}
                              </View>
                            </View>
                            <View style={styles.buttonRow}>
                              <ActionButton
                                title={
                                  isPickingFromLibrary ? "Загрузка..." : "Выбрать из галереи"
                                }
                                variant="secondary"
                                onPress={() => {
                                  void handlePickPointPhoto(index);
                                }}
                                disabled={isPhotoBusy}
                              />
                              <ActionButton
                                title={
                                  isCapturingFromCamera ? "Снимаю..." : "Сделать снимок"
                                }
                                variant="secondary"
                                onPress={() => {
                                  void handleCapturePointPhoto(index);
                                }}
                                disabled={isPhotoBusy}
                              />
                              <ActionButton
                                title="Удалить фото"
                                variant="danger"
                                onPress={() => {
                                  void handleRemovePointPhoto(index);
                                }}
                                disabled={isPhotoBusy}
                              />
                            </View>
                          </View>
                        ) : (
                          <>
                            <View style={styles.buttonRow}>
                              <ActionButton
                                title={
                                  isPickingFromLibrary ? "Загрузка..." : "Выбрать из галереи"
                                }
                                variant="secondary"
                                onPress={() => {
                                  void handlePickPointPhoto(index);
                                }}
                                disabled={isPhotoBusy}
                              />
                              <ActionButton
                                title={
                                  isCapturingFromCamera ? "Снимаю..." : "Сделать снимок"
                                }
                                variant="secondary"
                                onPress={() => {
                                  void handleCapturePointPhoto(index);
                                }}
                                disabled={isPhotoBusy}
                              />
                            </View>
                            <Text style={styles.fieldHint}>
                              Фото можно использовать как визуальную привязку места или иллюстрацию достопримечательности.
                            </Text>
                          </>
                        )}
                      </View>
                    </View>
                  );
                })}
              </View>
            </View>
          ) : null}

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
                      title={isUploading ? "Сохранение..." : saveRouteButtonLabel}
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
    paddingBottom: 116,
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
  formGroup: {
    gap: 10,
  },
  fieldLabel: {
    color: "#f7f8fd",
    fontSize: 14,
    fontWeight: "700",
  },
  fieldHint: {
    color: "#98a0be",
    fontSize: 12,
    lineHeight: 18,
  },
  fieldMeta: {
    color: "#c8d0ec",
    fontSize: 12,
  },
  pointList: {
    gap: 12,
  },
  pointCard: {
    backgroundColor: "#101426",
    borderColor: "#293053",
    borderRadius: 18,
    borderWidth: 1,
    gap: 12,
    padding: 14,
  },
  pointCardSemanticStop: {
    borderColor: "#2f6f56",
    backgroundColor: "#101a19",
  },
  pointCardSemanticTurn: {
    borderColor: "#66531d",
    backgroundColor: "#18160f",
  },
  pointCardHeader: {
    gap: 4,
  },
  pointCardTitle: {
    color: "#f7f8fd",
    fontSize: 15,
    fontWeight: "700",
  },
  pointCardMeta: {
    color: "#8d96b8",
    fontSize: 12,
  },
  semanticBadge: {
    alignSelf: "flex-start",
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  semanticBadgeStop: {
    backgroundColor: "#123027",
    borderColor: "#2f6f56",
  },
  semanticBadgeTurn: {
    backgroundColor: "#2a2210",
    borderColor: "#8c7427",
  },
  semanticBadgeText: {
    color: "#f7f8fd",
    fontSize: 12,
    fontWeight: "700",
  },
  semanticHint: {
    color: "#c8d0ec",
    fontSize: 12,
    lineHeight: 18,
  },
  noteInput: {
    minHeight: 108,
  },
  pointPhotoCard: {
    gap: 10,
  },
  pointMarkerPreviewRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
  },
  pointMarkerPreview: {
    borderColor: "#f7f8fd",
    borderWidth: 2,
  },
  pointPhotoPreview: {
    borderRadius: 16,
    maxWidth: "100%",
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
  syncCard: {
    backgroundColor: "#101426",
    borderColor: "#293053",
    borderRadius: 16,
    borderWidth: 1,
    gap: 8,
    padding: 14,
  },
  syncCardHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    justifyContent: "space-between",
  },
  syncCardTitle: {
    color: "#f7f8fd",
    flex: 1,
    fontSize: 14,
    fontWeight: "700",
  },
  syncCardHeadline: {
    color: "#f7f8fd",
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 20,
  },
  syncCardText: {
    color: "#b7c0de",
    fontSize: 13,
    lineHeight: 19,
  },
  syncCardMeta: {
    color: "#8690b3",
    fontSize: 12,
    lineHeight: 18,
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
  choiceRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  choiceChip: {
    backgroundColor: "#101426",
    borderColor: "#30385f",
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  choiceChipActive: {
    backgroundColor: "#1d2f66",
    borderColor: "#4f7cff",
  },
  choiceChipDisabled: {
    opacity: 0.45,
  },
  choiceChipText: {
    color: "#c1c9e7",
    fontSize: 13,
    fontWeight: "600",
  },
  choiceChipTextActive: {
    color: "#f7f8fd",
  },
  choiceChipTextDisabled: {
    color: "#7e87aa",
  },
  colorSwatchRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  colorSwatch: {
    alignItems: "center",
    backgroundColor: "#101426",
    borderColor: "#30385f",
    borderRadius: 999,
    borderWidth: 1,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  colorSwatchActive: {
    borderColor: "#f7f8fd",
    transform: [{ scale: 1.06 }],
  },
  colorSwatchFill: {
    borderRadius: 999,
    height: 24,
    width: 24,
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

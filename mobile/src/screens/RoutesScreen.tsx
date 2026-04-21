import { useEffect, useState } from "react";
import {
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { getStoredTokens } from "../api/auth";
import {
  deleteUserRoute,
  getUserRoutesWithFallback,
  type RouteResponse,
} from "../api/routes";
import { syncPendingRouteUploadsBatch } from "../services/pendingRouteSync";
import {
  readPendingRouteUploads,
  removePendingRouteUpload,
  writePendingRouteUploads,
  type PendingRouteUpload,
} from "../storage/pendingRouteUploads";

interface RoutesScreenProps {
  isActive: boolean;
  onOpenRoute: (routeId: string) => void;
  onNavigateTrack: () => void;
  onOpenPendingUpload: (uploadId: string) => void;
}

type NoticeTone = "success" | "info" | "error";

interface NoticeState {
  tone: NoticeTone;
  title: string;
  text?: string;
}

function formatRouteDate(value?: string) {
  if (!value) {
    return "Не указана";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Не указана";
  }

  return date.toLocaleString("ru-RU", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function sortRoutesByUpdatedAt(routes: RouteResponse[]) {
  return [...routes].sort(
    (left, right) =>
      new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime(),
  );
}

function sortPendingUploadsByCreatedAt(uploads: PendingRouteUpload[]) {
  return [...uploads].sort(
    (left, right) =>
      new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
  );
}

function Badge({
  label,
  tone = "neutral",
}: {
  label: string;
  tone?: "neutral" | "success" | "warning";
}) {
  return (
    <View
      style={[
        styles.badge,
        tone === "success" && styles.badgeSuccess,
        tone === "warning" && styles.badgeWarning,
      ]}
    >
      <Text style={styles.badgeText}>{label}</Text>
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
      activeOpacity={0.86}
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

function NoticeBanner({
  tone,
  title,
  text,
}: {
  tone: NoticeTone;
  title: string;
  text?: string;
}) {
  return (
    <View
      style={[
        styles.notice,
        tone === "success" && styles.noticeSuccess,
        tone === "info" && styles.noticeInfo,
        tone === "error" && styles.noticeError,
      ]}
    >
      <Text style={styles.noticeTitle}>{title}</Text>
      {text ? <Text style={styles.noticeText}>{text}</Text> : null}
    </View>
  );
}

function buildPendingUploadSummary(upload: PendingRouteUpload) {
  const routePointsCount = upload.payload.points.length;
  return `Точек маршрута: ${routePointsCount} • GPS-сэмплов: ${upload.sampleCount}`;
}

function getPendingUploadLifecycle(upload: PendingRouteUpload): {
  label: string;
  tone: "neutral" | "success" | "warning";
  description: string;
} {
  if (upload.lastError) {
    return {
      label: "Ошибка синка",
      tone: "warning",
      description: "Нужна повторная отправка. Локальный черновик сохранён и не потерян.",
    };
  }

  if (upload.lastTriedAt) {
    return {
      label: "Готов к повторной отправке",
      tone: "warning",
      description: "Локальный черновик сохранён и может быть отправлен на сервер ещё раз.",
    };
  }

  return {
    label: "Готов к синхронизации",
    tone: "success",
    description: "Маршрут сохранён на устройстве и ждёт отправки на сервер.",
  };
}

function buildPendingUploadSyncNotice({
  synced,
  failed,
  singleRouteName,
}: {
  synced: number;
  failed: number;
  singleRouteName?: string;
}): NoticeState {
  if (synced === 0 && failed > 0) {
    return {
      tone: "error",
      title: singleRouteName
        ? `Не удалось отправить «${singleRouteName}»`
        : "Синхронизация не удалась",
      text: "Маршрут остался в локальной очереди. Его можно попробовать отправить повторно позже.",
    };
  }

  if (failed > 0) {
    return {
      tone: "info",
      title:
        failed > 0
          ? "Синхронизация завершена частично"
          : "Синхронизация завершена",
      text:
        failed > 0
          ? `Успешно отправлено: ${synced}. С ошибкой осталось: ${failed}.`
          : `На сервер выгружено: ${synced}.`,
    };
  }

  return {
    tone: "success",
    title:
      synced === 1 && singleRouteName
        ? `Маршрут «${singleRouteName}» отправлен`
        : "Синхронизация завершена",
    text:
      `На сервер выгружено: ${synced}.`,
  };
}

export function RoutesScreen({
  isActive,
  onOpenRoute,
  onNavigateTrack,
  onOpenPendingUpload,
}: RoutesScreenProps) {
  const [hasAuthSession, setHasAuthSession] = useState(false);
  const [routes, setRoutes] = useState<RouteResponse[]>([]);
  const [pendingUploads, setPendingUploads] = useState<PendingRouteUpload[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSyncingPending, setIsSyncingPending] = useState(false);
  const [syncingUploadId, setSyncingUploadId] = useState<string | "all" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<NoticeState | null>(null);
  const [deletingRouteId, setDeletingRouteId] = useState<string | null>(null);
  const [deletingPendingId, setDeletingPendingId] = useState<string | null>(null);
  const [dataSource, setDataSource] = useState<"network" | "cache" | null>(null);
  const [cachedAt, setCachedAt] = useState<string | null>(null);

  async function loadRoutes() {
    setIsLoading(true);
    setError(null);

    try {
      const [tokens, storedPendingUploads] = await Promise.all([
        getStoredTokens(),
        readPendingRouteUploads(),
      ]);
      const isAuthorized = Boolean(tokens?.access_token);

      setHasAuthSession(isAuthorized);
      setPendingUploads(sortPendingUploadsByCreatedAt(storedPendingUploads));

      if (!isAuthorized) {
        setRoutes([]);
        setDataSource(null);
        setCachedAt(null);
        return;
      }

      const result = await getUserRoutesWithFallback();
      setRoutes(sortRoutesByUpdatedAt(result.data));
      setDataSource(result.source);
      setCachedAt(result.cachedAt ?? null);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Не удалось загрузить маршруты.",
      );
    } finally {
      setIsLoading(false);
    }
  }

  async function handleDeleteRoute(routeId: string) {
    setDeletingRouteId(routeId);
    setError(null);
    setFeedback(null);

    try {
      await deleteUserRoute(routeId);
      setRoutes((current) => current.filter((route) => route.id !== routeId));
      setFeedback({
        tone: "info",
        title: "Маршрут удалён",
        text: "Запись убрана из каталога и локального кэша.",
      });
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Не удалось удалить маршрут.",
      );
    } finally {
      setDeletingRouteId(null);
    }
  }

  async function handleDeletePendingUpload(uploadId: string) {
    setDeletingPendingId(uploadId);
    setError(null);
    setFeedback(null);

    try {
      const nextUploads = await removePendingRouteUpload(uploadId);
      setPendingUploads(sortPendingUploadsByCreatedAt(nextUploads));
      setFeedback({
        tone: "info",
        title: "Локальный черновик удалён",
        text: "Маршрут убран из очереди синхронизации.",
      });
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Не удалось удалить локальный черновик.",
      );
    } finally {
      setDeletingPendingId(null);
    }
  }

  async function handleSyncPendingUploads(targetUploadId?: string) {
    if (pendingUploads.length === 0) {
      return;
    }

    if (!hasAuthSession) {
      setFeedback({
        tone: "info",
        title: "Нужна авторизация",
        text: "Локальные черновики уже сохранены. Для выгрузки на сервер сначала войди в аккаунт на экране записи.",
      });
      return;
    }

    const uploadsToSync = targetUploadId
      ? pendingUploads.filter((upload) => upload.id === targetUploadId)
      : pendingUploads;

    if (uploadsToSync.length === 0) {
      return;
    }

    const untouchedUploads = targetUploadId
      ? pendingUploads.filter((upload) => upload.id !== targetUploadId)
      : [];
    const singleRouteName =
      uploadsToSync.length === 1 ? uploadsToSync[0]?.payload.name : undefined;

    setIsSyncingPending(true);
    setSyncingUploadId(targetUploadId ?? "all");
    setError(null);
    setFeedback(null);

    try {
      const result = await syncPendingRouteUploadsBatch(uploadsToSync);
      const nextUploads = sortPendingUploadsByCreatedAt([
        ...untouchedUploads,
        ...result.remainingUploads,
      ]);

      await writePendingRouteUploads(nextUploads);
      setPendingUploads(nextUploads);

      if (result.synced > 0) {
        await loadRoutes();
      }

      setFeedback(
        buildPendingUploadSyncNotice({
          synced: result.synced,
          failed: result.failed,
          singleRouteName,
        }),
      );
    } catch (syncError) {
      setError(
        syncError instanceof Error
          ? syncError.message
          : "Не удалось синхронизировать маршруты.",
      );
    } finally {
      setIsSyncingPending(false);
      setSyncingUploadId(null);
    }
  }

  useEffect(() => {
    if (isActive) {
      void loadRoutes();
    }
  }, [isActive]);

  return (
    <View style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.hero}>
          <Text style={styles.kicker}>Guide Helper Mobile</Text>
          <Text style={styles.title}>Мои маршруты</Text>
          <Text style={styles.subtitle}>
            Android-клиент работает как полевое дополнение: записывает маршрут,
            хранит локальные черновики и синхронизирует готовые записи с сервером.
          </Text>
        </View>

        {feedback ? (
          <NoticeBanner
            tone={feedback.tone}
            title={feedback.title}
            text={feedback.text}
          />
        ) : null}

        {error ? (
          <NoticeBanner
            tone="error"
            title="Операция не выполнена"
            text={error}
          />
        ) : null}

        {dataSource === "cache" ? (
          <NoticeBanner
            tone="info"
            title="Показаны локальные данные"
            text={`Сеть сейчас недоступна. Экран открыт из кэша${cachedAt ? ` от ${formatRouteDate(cachedAt)}.` : "."}`}
          />
        ) : null}

        <View style={styles.card}>
          <View style={styles.sectionHeader}>
            <Text style={styles.cardTitle}>Локальные черновики</Text>
            <Badge
              label={
                pendingUploads.length > 0
                  ? `${pendingUploads.length} в очереди`
                  : "Очередь пуста"
              }
              tone={pendingUploads.length > 0 ? "warning" : "neutral"}
            />
          </View>

          <Text style={styles.cardText}>
            Локальное сохранение работает даже без аккаунта. После входа эти маршруты
            можно отправить на сервер, когда появятся сеть и время на синхронизацию.
          </Text>

          <View style={styles.buttonRow}>
            <ActionButton title="Перейти к записи" onPress={onNavigateTrack} />
            {pendingUploads.length > 0 ? (
              <ActionButton
                title={isSyncingPending ? "Синхронизация..." : "Синхронизировать всё"}
                variant="secondary"
                onPress={() => {
                  void handleSyncPendingUploads();
                }}
                disabled={!hasAuthSession || isSyncingPending || deletingPendingId !== null}
              />
            ) : null}
          </View>

          {!hasAuthSession ? (
            <Text style={styles.helperText}>
              Серверная выгрузка станет доступна после входа на экране записи маршрута.
            </Text>
          ) : null}

          {pendingUploads.length === 0 ? (
            <Text style={styles.cardText}>
              Локальных черновиков пока нет. Запиши маршрут и сохрани его локально, если
              хочешь проверить офлайн-сценарий.
            </Text>
          ) : (
            <View style={styles.routeList}>
              {pendingUploads.map((upload) => {
                const lifecycle = getPendingUploadLifecycle(upload);

                return (
                  <View key={upload.id} style={styles.routeCard}>
                    <View style={styles.routeHeader}>
                      <Text style={styles.routeName}>{upload.payload.name}</Text>
                      <Badge label="Локально" tone="warning" />
                    </View>

                    <Text style={styles.routeMeta}>{buildPendingUploadSummary(upload)}</Text>
                    <Text style={styles.routeMeta}>
                      Сохранён локально: {formatRouteDate(upload.createdAt)}
                    </Text>
                    <Text style={styles.routeMeta}>
                      Дата маршрута: {formatRouteDate(upload.payload.started_at)}
                    </Text>
                    <View style={styles.badgeRow}>
                      <Badge label={lifecycle.label} tone={lifecycle.tone} />
                    </View>
                    <Text style={styles.routeMeta}>{lifecycle.description}</Text>
                    {upload.payload.seasons.length > 0 ? (
                      <View style={styles.badgeRow}>
                        {upload.payload.seasons.map((season) => (
                          <Badge key={`${upload.id}-${season}`} label={season} />
                        ))}
                      </View>
                    ) : null}

                    {upload.lastError ? (
                      <View style={styles.inlineWarning}>
                        <Text style={styles.inlineWarningTitle}>
                          Последняя попытка не удалась
                        </Text>
                        <Text style={styles.inlineWarningText}>{upload.lastError}</Text>
                        {upload.lastTriedAt ? (
                          <Text style={styles.inlineWarningText}>
                            Повтор: {formatRouteDate(upload.lastTriedAt)}
                          </Text>
                        ) : null}
                      </View>
                    ) : null}

                    <View style={styles.buttonRow}>
                      <ActionButton
                        title="Открыть в записи"
                        onPress={() => {
                          onOpenPendingUpload(upload.id);
                        }}
                        disabled={
                          deletingPendingId !== null ||
                          isSyncingPending ||
                          deletingRouteId !== null
                        }
                      />
                      {hasAuthSession ? (
                        <ActionButton
                          title={
                            syncingUploadId === upload.id
                              ? "Отправка..."
                              : "Отправить"
                          }
                          variant="secondary"
                          onPress={() => {
                            void handleSyncPendingUploads(upload.id);
                          }}
                          disabled={
                            isSyncingPending ||
                            deletingPendingId !== null ||
                            deletingRouteId !== null
                          }
                        />
                      ) : null}
                      <ActionButton
                        title={
                          deletingPendingId === upload.id ? "Удаление..." : "Удалить"
                        }
                        variant="danger"
                        onPress={() => {
                          void handleDeletePendingUpload(upload.id);
                        }}
                        disabled={
                          deletingPendingId !== null ||
                          isSyncingPending ||
                          deletingRouteId !== null
                        }
                      />
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </View>

        {!hasAuthSession ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Нужна авторизация</Text>
            <Text style={styles.cardText}>
              Каталог маршрутов на сервере доступен только после входа. Локальные черновики
              выше уже работают без авторизации.
            </Text>
            <ActionButton title="Перейти к записи маршрута" onPress={onNavigateTrack} />
          </View>
        ) : null}

        {hasAuthSession ? (
          <View style={styles.card}>
            <View style={styles.sectionHeader}>
              <Text style={styles.cardTitle}>Синхронизированные маршруты</Text>
              <ActionButton
                title={isLoading ? "Обновление..." : "Обновить"}
                variant="secondary"
                onPress={() => {
                  void loadRoutes();
                }}
                disabled={isLoading || isSyncingPending}
              />
            </View>

            {isLoading ? (
              <Text style={styles.cardText}>Загружаю маршруты...</Text>
            ) : routes.length === 0 ? (
              <Text style={styles.cardText}>
                Маршрутов пока нет. Сначала запиши и сохрани хотя бы один маршрут.
              </Text>
            ) : (
              <View style={styles.routeList}>
                {routes.map((route) => (
                  <View key={route.id} style={styles.routeCard}>
                    <View style={styles.routeHeader}>
                      <Text style={styles.routeName}>{route.name}</Text>
                      <Badge
                        label={route.share_token ? "Опубликован" : "На сервере"}
                        tone={route.share_token ? "success" : "neutral"}
                      />
                    </View>

                    <Text style={styles.routeMeta}>
                      Точек: {route.points.length} • Обновлён: {formatRouteDate(route.updated_at)}
                    </Text>
                    <Text style={styles.routeMeta}>
                      Дата маршрута: {formatRouteDate(route.started_at)}
                    </Text>
                    {route.start_location || route.end_location ? (
                      <Text style={styles.routeMeta}>
                        {route.start_location ?? "Старт не определён"} →{" "}
                        {route.end_location ?? "Финиш не определён"}
                      </Text>
                    ) : null}

                    {route.seasons.length > 0 ? (
                      <View style={styles.badgeRow}>
                        {route.seasons.map((season) => (
                          <Badge key={`${route.id}-${season}`} label={season} />
                        ))}
                      </View>
                    ) : null}

                    <View style={styles.buttonRow}>
                      <ActionButton
                        title="Открыть"
                        onPress={() => {
                          onOpenRoute(route.id);
                        }}
                      />
                      <ActionButton
                        title={
                          deletingRouteId === route.id ? "Удаление..." : "Удалить"
                        }
                        variant="danger"
                        onPress={() => {
                          void handleDeleteRoute(route.id);
                        }}
                        disabled={deletingRouteId !== null || dataSource === "cache"}
                      />
                    </View>
                  </View>
                ))}
              </View>
            )}
          </View>
        ) : null}
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
  cardText: {
    color: "#b7c0de",
    fontSize: 14,
    lineHeight: 21,
  },
  helperText: {
    color: "#8f98ba",
    fontSize: 12,
    lineHeight: 18,
  },
  notice: {
    borderRadius: 18,
    borderWidth: 1,
    gap: 4,
    padding: 14,
  },
  noticeSuccess: {
    backgroundColor: "#12251d",
    borderColor: "#2a6b53",
  },
  noticeInfo: {
    backgroundColor: "#141b32",
    borderColor: "#34406f",
  },
  noticeError: {
    backgroundColor: "#2a1620",
    borderColor: "#5d2639",
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
  sectionHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
  },
  routeList: {
    gap: 12,
  },
  routeCard: {
    backgroundColor: "#101426",
    borderColor: "#293053",
    borderRadius: 18,
    borderWidth: 1,
    gap: 10,
    padding: 14,
  },
  routeHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    justifyContent: "space-between",
  },
  routeName: {
    color: "#f7f8fd",
    flex: 1,
    fontSize: 16,
    fontWeight: "700",
  },
  routeMeta: {
    color: "#98a0be",
    fontSize: 12,
    lineHeight: 18,
  },
  badgeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  badge: {
    backgroundColor: "#11162b",
    borderColor: "#2f3560",
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  badgeSuccess: {
    backgroundColor: "#10251d",
    borderColor: "#215842",
  },
  badgeWarning: {
    backgroundColor: "#2b2411",
    borderColor: "#7b6720",
  },
  badgeText: {
    color: "#c9d0ea",
    fontSize: 12,
    overflow: "hidden",
  },
  inlineWarning: {
    backgroundColor: "#231d12",
    borderColor: "#6e5c23",
    borderRadius: 14,
    borderWidth: 1,
    gap: 4,
    padding: 12,
  },
  inlineWarningTitle: {
    color: "#f7f8fd",
    fontSize: 13,
    fontWeight: "700",
  },
  inlineWarningText: {
    color: "#c7cde4",
    fontSize: 12,
    lineHeight: 18,
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
    flexBasis: 150,
    flexGrow: 1,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: 16,
    paddingVertical: 12,
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
    fontSize: 14,
    fontWeight: "700",
    textAlign: "center",
  },
});

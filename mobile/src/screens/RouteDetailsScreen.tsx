import { useEffect, useState } from "react";
import {
  Image,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import {
  deleteUserRoute,
  getUserRouteWithFallback,
  type RoutePointResponse,
  type RouteResponse,
} from "../api/routes";

interface RouteDetailsScreenProps {
  routeId: string;
  isActive: boolean;
  onBack: () => void;
  onDeleted: () => void;
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

function getPointFallbackName(point: RoutePointResponse, index: number, totalPoints: number) {
  if (point.name?.trim()) {
    return point.name.trim();
  }

  if (index === 0) {
    return "Старт";
  }

  if (index === totalPoints - 1) {
    return "Финиш";
  }

  return `Точка ${index + 1}`;
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

export function RouteDetailsScreen({
  routeId,
  isActive,
  onBack,
  onDeleted,
}: RouteDetailsScreenProps) {
  const [route, setRoute] = useState<RouteResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dataSource, setDataSource] = useState<"network" | "cache" | null>(null);
  const [cachedAt, setCachedAt] = useState<string | null>(null);

  async function loadRoute() {
    setIsLoading(true);
    setError(null);

    try {
      const result = await getUserRouteWithFallback(routeId);
      setRoute(result.data);
      setDataSource(result.source);
      setCachedAt(result.cachedAt ?? null);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Не удалось загрузить детали маршрута.",
      );
    } finally {
      setIsLoading(false);
    }
  }

  async function handleDeleteRoute() {
    setIsDeleting(true);
    setError(null);

    try {
      await deleteUserRoute(routeId);
      onDeleted();
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Не удалось удалить маршрут.",
      );
      setIsDeleting(false);
    }
  }

  useEffect(() => {
    if (isActive) {
      void loadRoute();
    }
  }, [isActive, routeId]);

  return (
    <View style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.hero}>
          <Text style={styles.kicker}>Guide Helper Mobile</Text>
          <Text style={styles.title}>Карточка маршрута</Text>
          <Text style={styles.subtitle}>
            Просмотр маршрута, записанного и синхронизированного через мобильный companion app.
          </Text>
        </View>

        <View style={styles.buttonRow}>
          <ActionButton title="Назад к списку" variant="secondary" onPress={onBack} />
          <ActionButton
            title={isLoading ? "Обновление..." : "Обновить"}
            variant="secondary"
            onPress={() => {
              void loadRoute();
            }}
            disabled={isLoading}
          />
        </View>

        {error ? (
          <View style={styles.noticeError}>
            <Text style={styles.noticeTitle}>Ошибка</Text>
            <Text style={styles.noticeText}>{error}</Text>
          </View>
        ) : null}

        {dataSource === "cache" ? (
          <View style={styles.noticeInfo}>
            <Text style={styles.noticeTitle}>Показаны локальные данные</Text>
            <Text style={styles.noticeText}>
              Детали маршрута открыты из кэша
              {cachedAt ? ` от ${formatRouteDate(cachedAt)}.` : "."}
            </Text>
          </View>
        ) : null}

        {isLoading ? (
          <View style={styles.card}>
            <Text style={styles.cardText}>Загружаю маршрут...</Text>
          </View>
        ) : route ? (
          <>
            <View style={styles.card}>
              <View style={styles.headerRow}>
                <Text style={styles.cardTitle}>{route.name}</Text>
                <Badge
                  label={route.share_token ? "Опубликован" : route.is_draft ? "Черновик" : "Сохранён"}
                  tone={route.share_token ? "success" : "warning"}
                />
              </View>
              <Text style={styles.cardText}>
                Дата маршрута: {formatRouteDate(route.started_at)}
              </Text>
              <Text style={styles.cardText}>
                Создан: {formatRouteDate(route.created_at)}
              </Text>
              <Text style={styles.cardText}>
                Обновлён: {formatRouteDate(route.updated_at)}
              </Text>
              <Text style={styles.cardText}>
                Точек: {route.points.length}
              </Text>
              {route.start_location || route.end_location ? (
                <Text style={styles.cardText}>
                  {route.start_location ?? "Старт не определён"} → {route.end_location ?? "Финиш не определён"}
                </Text>
              ) : null}
              <View style={styles.badgeRow}>
                {route.seasons.map((season) => (
                  <Badge key={`${route.id}-${season}`} label={season} />
                ))}
              </View>
              {route.share_token ? (
                <View style={styles.shareBox}>
                  <Text style={styles.shareLabel}>Статус публикации</Text>
                  <Text style={styles.shareValue}>
                    Маршрут уже опубликован и доступен по публичной ссылке в веб-версии.
                  </Text>
                </View>
              ) : route.is_draft ? (
                <View style={styles.shareBox}>
                  <Text style={styles.shareLabel}>Статус хранения</Text>
                  <Text style={styles.shareValue}>
                    На сервере хранится черновой маршрут. Основная публикация и расширенное редактирование выполняются в веб-клиенте.
                  </Text>
                </View>
              ) : (
                <View style={styles.shareBox}>
                  <Text style={styles.shareLabel}>Статус хранения</Text>
                  <Text style={styles.shareValue}>
                    Маршрут сохранён на сервере. Публикация, версиями и расширенным редактированием управляет веб-клиент.
                  </Text>
                </View>
              )}
              <ActionButton
                title={isDeleting ? "Удаление..." : "Удалить маршрут"}
                variant="danger"
                onPress={() => {
                  void handleDeleteRoute();
                }}
                disabled={isDeleting || dataSource === "cache"}
                fullWidth
              />
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Точки маршрута</Text>
              <View style={styles.pointList}>
                {route.points.map((point, index) => (
                  <View key={`${route.id}-${index}`} style={styles.pointCard}>
                    <Text style={styles.pointTitle}>
                      {getPointFallbackName(point, index, route.points.length)}
                    </Text>
                    <Text style={styles.pointMeta}>
                      {point.lat.toFixed(5)}, {point.lng.toFixed(5)}
                    </Text>
                    {typeof point.segment_duration_minutes === "number" ? (
                      <Text style={styles.pointMeta}>
                        Участок до точки: {point.segment_duration_minutes} мин
                      </Text>
                    ) : null}
                    {point.note?.trim() ? (
                      <Text style={styles.pointNote}>{point.note.trim()}</Text>
                    ) : null}
                    {point.photo?.original ? (
                      <Image
                        source={{ uri: point.photo.original }}
                        style={styles.pointPhoto}
                        resizeMode="cover"
                      />
                    ) : null}
                  </View>
                ))}
              </View>
            </View>
          </>
        ) : (
          <View style={styles.card}>
            <Text style={styles.cardText}>Маршрут не найден.</Text>
          </View>
        )}
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
  headerRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    justifyContent: "space-between",
  },
  cardTitle: {
    color: "#f7f8fd",
    flex: 1,
    fontSize: 18,
    fontWeight: "700",
  },
  cardText: {
    color: "#b7c0de",
    fontSize: 14,
    lineHeight: 21,
  },
  noticeError: {
    backgroundColor: "#2a1620",
    borderColor: "#5d2639",
    borderRadius: 18,
    borderWidth: 1,
    gap: 4,
    padding: 14,
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
  noticeInfo: {
    backgroundColor: "#141b32",
    borderColor: "#34406f",
    borderRadius: 18,
    borderWidth: 1,
    gap: 4,
    padding: 14,
  },
  shareBox: {
    backgroundColor: "#101426",
    borderColor: "#293053",
    borderRadius: 16,
    borderWidth: 1,
    gap: 6,
    padding: 12,
  },
  shareLabel: {
    color: "#8d96b8",
    fontSize: 12,
  },
  shareValue: {
    color: "#f7f8fd",
    fontSize: 13,
    lineHeight: 20,
  },
  pointList: {
    gap: 12,
  },
  pointCard: {
    backgroundColor: "#101426",
    borderColor: "#293053",
    borderRadius: 18,
    borderWidth: 1,
    gap: 8,
    padding: 14,
  },
  pointTitle: {
    color: "#f7f8fd",
    fontSize: 15,
    fontWeight: "700",
  },
  pointMeta: {
    color: "#98a0be",
    fontSize: 12,
    lineHeight: 18,
  },
  pointNote: {
    color: "#c8d0ec",
    fontSize: 13,
    lineHeight: 20,
  },
  pointPhoto: {
    borderRadius: 16,
    height: 220,
    width: "100%",
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
  buttonFullWidth: {
    width: "100%",
    flexBasis: undefined,
    flexGrow: 0,
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

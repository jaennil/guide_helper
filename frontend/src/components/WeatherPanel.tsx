import { useState, useEffect, useRef } from "react";
import { useLanguage } from "../context/LanguageContext";
import type { GeoPoint } from "../utils/geo";
import {
  fetchWeather,
  getWeatherIcon,
  getWeatherDescription,
  type WeatherData,
} from "../utils/weather";
import { asTranslationKey } from "../i18n";

interface WeatherPanelProps {
  points: GeoPoint[];
  startedAt?: string;
}

export function WeatherPanel({ points, startedAt }: WeatherPanelProps) {
  const { t } = useLanguage();
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setWeather(null);
    setError(false);

    if (points.length < 2) return;

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const data = await fetchWeather(points, startedAt);
        setWeather(data);
      } catch (err) {
        console.error("[weather] failed to fetch weather:", err);
        setError(true);
      } finally {
        setLoading(false);
      }
    }, 500);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [points, startedAt]);

  if (points.length < 2) return null;

  return (
    <div className="weather-panel">
      <div className="weather-title">{t("weather.title")}</div>
      {weather && (
        <>
          <div className="weather-subtitle">
            {t(asTranslationKey(`weather.mode.${weather.mode}`))}
          </div>
          <div className="weather-reference">
            {startedAt
              ? new Date(startedAt).toLocaleString(undefined, {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : t("weather.now")}
          </div>
        </>
      )}

      {loading && <div className="weather-loading">{t("weather.loading")}</div>}

      {error && <div className="weather-error">{t("weather.failed")}</div>}

      {weather && (
        <>
          <div className="weather-current">
            <span className="weather-icon">
              {getWeatherIcon(weather.current.weathercode)}
            </span>
            <span className="weather-temp">
              {Math.round(weather.current.temperature)}°C
            </span>
            <span className="weather-desc">
              {t(asTranslationKey(`weather.${getWeatherDescription(weather.current.weathercode)}`))}
            </span>
          </div>
          <div className="weather-details">
            <span>
              {t("weather.wind")}: {Math.round(weather.current.windspeed)} km/h
            </span>
            <span>
              {t("weather.humidity")}: {weather.current.humidity}%
            </span>
          </div>
          <div className="weather-forecast">
            <div className="weather-forecast-title">
              {t(weather.mode === "historical" ? "weather.daySummary" : "weather.forecast")}
            </div>
            {weather.daily.map((day) => (
              <div key={day.date} className="weather-forecast-day">
                <span className="weather-forecast-date">
                  {new Date(day.date + "T00:00:00").toLocaleDateString(undefined, {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                  })}
                </span>
                <span className="weather-forecast-icon">
                  {getWeatherIcon(day.weathercode)}
                </span>
                <span className="weather-forecast-temps">
                  {Math.round(day.tempMin)}° / {Math.round(day.tempMax)}°
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

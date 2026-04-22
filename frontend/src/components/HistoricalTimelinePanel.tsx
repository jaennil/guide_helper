import React from "react";
import { CalendarDays, FastForward, Minus, Pause, Play } from "lucide-react";

import { useLanguage } from "../context/LanguageContext";

const MIN_HISTORICAL_YEAR = 1700;

interface HistoricalMilestone {
  year: number;
  label: string;
}

interface HistoricalContextViewModel {
  periodLabel: string;
  title: string;
  description: string;
  includesRouteYear: boolean;
}

interface HistoricalTimelinePanelProps {
  historicalPlaying: boolean;
  historicalProgress: number;
  historicalYear: number;
  currentHistoricalYear: number;
  routeHistoricalYear: number | null;
  historicalContext: HistoricalContextViewModel;
  historicalMilestones: HistoricalMilestone[];
  historicalSpeedLabel: string;
  historicalCompareMode: boolean;
  historicalComparePosition: number;
  historicalOpacity: number;
  onTogglePlay: () => void;
  onCycleSpeed: () => void;
  onToggleCompare: () => void;
  onHistoricalYearChange: (value: number) => void;
  onComparePositionChange: (value: number) => void;
  onHistoricalOpacityChange: (value: number) => void;
}

export function HistoricalTimelinePanel({
  historicalPlaying,
  historicalProgress,
  historicalYear,
  currentHistoricalYear,
  routeHistoricalYear,
  historicalContext,
  historicalMilestones,
  historicalSpeedLabel,
  historicalCompareMode,
  historicalComparePosition,
  historicalOpacity,
  onTogglePlay,
  onCycleSpeed,
  onToggleCompare,
  onHistoricalYearChange,
  onComparePositionChange,
  onHistoricalOpacityChange,
}: HistoricalTimelinePanelProps) {
  const { t } = useLanguage();

  return (
    <div
      className={`historical-controls${historicalPlaying ? " playing" : ""}`}
      style={{ "--historical-progress": `${historicalProgress}%` } as React.CSSProperties}
    >
      <div className="historical-controls-top">
        <div className="historical-heading">
          <span className="historical-overline">{t("historical.timelineTitle")}</span>
          <div className="historical-year-display">{historicalYear}</div>
        </div>
        <div className="historical-actions">
          <button
            type="button"
            className={`historical-action-btn${historicalPlaying ? " active" : ""}`}
            onClick={onTogglePlay}
            title={historicalPlaying ? t("playback.pause") : t("playback.play")}
          >
            {historicalPlaying ? <Pause size={15} /> : <Play size={15} />}
            <span>{historicalPlaying ? t("playback.pause") : t("playback.play")}</span>
          </button>
          <button
            type="button"
            className="historical-action-btn"
            onClick={onCycleSpeed}
            title={t("playback.speed")}
          >
            <FastForward size={15} />
            <span>{historicalSpeedLabel}</span>
          </button>
          <button
            type="button"
            className={`historical-action-btn${historicalCompareMode ? " active" : ""}`}
            onClick={onToggleCompare}
            title={t("historical.compare")}
          >
            <Minus size={15} />
            <span>{t("historical.compare")}</span>
          </button>
        </div>
      </div>

      <div className="historical-context">
        <div className="historical-context-copy">
          <div className="historical-context-meta">
            <span className="historical-context-period">{historicalContext.periodLabel}</span>
            {routeHistoricalYear === historicalYear && (
              <span className="historical-context-chip">{t("historical.routeYearChip")}</span>
            )}
            {routeHistoricalYear !== historicalYear &&
              routeHistoricalYear !== null &&
              historicalContext.includesRouteYear && (
                <span className="historical-context-chip muted">
                  {t("historical.routePeriodChip")}
                </span>
              )}
          </div>
          <div className="historical-context-title">{historicalContext.title}</div>
          <div className="historical-context-description">{historicalContext.description}</div>
        </div>
        {routeHistoricalYear && historicalYear !== routeHistoricalYear && (
          <button
            type="button"
            className="historical-context-action"
            onClick={() => onHistoricalYearChange(routeHistoricalYear)}
          >
            <CalendarDays size={14} />
            <span>{t("historical.routeYearAction", { year: routeHistoricalYear })}</span>
          </button>
        )}
      </div>

      <div className="historical-track-shell">
        <div className="historical-track">
          <div className="historical-track-fill" />
          {historicalMilestones.map((milestone, index) => {
            const offset =
              ((milestone.year - MIN_HISTORICAL_YEAR) /
                (currentHistoricalYear - MIN_HISTORICAL_YEAR)) *
              100;
            return (
              <button
                key={`${milestone.year}-${milestone.label}`}
                type="button"
                className={`historical-milestone${historicalYear === milestone.year ? " active" : ""}${index === 0 ? " edge-start" : ""}${index === historicalMilestones.length - 1 ? " edge-end" : ""}`}
                style={{ left: `${offset}%` }}
                onClick={() => onHistoricalYearChange(milestone.year)}
              >
                <span className="historical-milestone-dot" />
                <span className="historical-milestone-label">{milestone.label}</span>
              </button>
            );
          })}
        </div>
        <input
          type="range"
          min={MIN_HISTORICAL_YEAR}
          max={currentHistoricalYear}
          step={1}
          value={historicalYear}
          onChange={(e) => onHistoricalYearChange(Number(e.target.value))}
          className="historical-slider"
        />
      </div>

      <div className="historical-footer">
        <div className="historical-year-labels">
          {historicalMilestones.map((milestone) => (
            <span key={`historical-year-label-${milestone.year}`}>{milestone.label}</span>
          ))}
        </div>
        <div className="historical-footer-row">
          {historicalCompareMode && (
            <div className="historical-compare-row">
              <span>{t("historical.comparePosition")}</span>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={historicalComparePosition}
                onChange={(e) => onComparePositionChange(Number(e.target.value))}
                className="historical-compare-slider"
              />
              <span className="historical-compare-value">{historicalComparePosition}%</span>
            </div>
          )}
          <div className="historical-opacity-row">
            <span>{t("historical.opacity")}</span>
            <span className="historical-opacity-value">{Math.round(historicalOpacity * 100)}%</span>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={Math.round(historicalOpacity * 100)}
              onChange={(e) => onHistoricalOpacityChange(Number(e.target.value) / 100)}
              className="historical-opacity-slider"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

interface HistoricalCompareIndicatorProps {
  historicalComparePosition: number;
  onStartDrag: (clientX: number) => void;
  ariaLabel: string;
}

export function HistoricalCompareIndicator({
  historicalComparePosition,
  onStartDrag,
  ariaLabel,
}: HistoricalCompareIndicatorProps) {
  return (
    <div
      className="historical-split-indicator"
      style={{ "--historical-split": `${historicalComparePosition}%` } as React.CSSProperties}
    >
      <button
        type="button"
        className="historical-split-line"
        onMouseDown={(event) => onStartDrag(event.clientX)}
        onTouchStart={(event) => {
          if (event.touches[0]) {
            onStartDrag(event.touches[0].clientX);
          }
        }}
        aria-label={ariaLabel}
      />
      <button
        type="button"
        className="historical-split-handle"
        onMouseDown={(event) => onStartDrag(event.clientX)}
        onTouchStart={(event) => {
          if (event.touches[0]) {
            onStartDrag(event.touches[0].clientX);
          }
        }}
        aria-label={ariaLabel}
      >
        <span />
        <span />
        <span />
      </button>
    </div>
  );
}

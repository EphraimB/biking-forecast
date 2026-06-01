"use client";

import React from "react";
import { AlertTriangle, ShieldAlert, Sparkles } from "lucide-react";
import styles from "./ScoreMetric.module.css";
import RadialGauge from "./svgs/RadialGauge";

export default function ScoreMetric({ forecast, unitSystem = "metric" }) {
  if (!forecast) return null;

  const {
    score,
    duration,
    speed,
    distance,
    headwind,
    crosswind,
    windSpeed,
    windDir,
    gusts,
    temp,
    rainProb,
    wmoDesc,
    wmoEmoji,
    penalties,
    windImpact
  } = forecast;

  const isImperial = unitSystem === "imperial";

  // Dynamic unit conversions
  const dispTemp = isImperial ? `${(temp * 1.8 + 32).toFixed(1)}°F` : `${temp.toFixed(1)}°C`;
  const dispDistance = isImperial ? `${(distance * 0.621371).toFixed(1)}` : `${distance}`;
  const dispDistanceUnit = isImperial ? "mi" : "km";
  const dispSpeed = isImperial ? `${(speed * 0.621371).toFixed(1)}` : `${speed}`;
  const dispSpeedUnit = isImperial ? "mph" : "km/h";
  
  const headwindValScaled = isImperial ? Math.abs(headwind * 0.621371) : Math.abs(headwind);
  const headwindUnit = isImperial ? "mph" : "km/h";
  const dispHeadwindText = headwind > 0 
    ? `+${headwindValScaled.toFixed(1)} ${headwindUnit} headwind` 
    : `${headwind < 0 ? "-" : ""}${headwindValScaled.toFixed(1)} ${headwindUnit} tailwind`;

  const dispCrosswind = isImperial ? `${(crosswind * 0.621371).toFixed(1)}` : `${crosswind}`;
  const dispGusts = isImperial ? `${(gusts * 0.621371).toFixed(1)}` : `${gusts}`;

  // Determine score color theme
  let themeColor = "var(--rose)";
  let scoreText = "Poor Conditions";
  
  if (score >= 80) {
    themeColor = "var(--emerald)";
    scoreText = "Perfect for Biking!";
  } else if (score >= 50) {
    themeColor = "var(--amber)";
    scoreText = "Acceptable Biking";
  }

  return (
    <div className={`glass-panel animate-fade-in ${styles.scoreMetricContainer}`}>
      <h3 className={styles.scoreMetricTitle}>
        <Sparkles size={16} className={styles.sparklesIcon} /> Commute Suitability
      </h3>

      <div className={styles.statsOuterContainer}>
        {/* Stunning Radial Gauge extracted into its own component */}
        <RadialGauge 
          score={score} 
          themeColor={themeColor} 
          textScoreClassName={styles.radialScoreVal}
          textLabelClassName={styles.radialScoreLabel}
        />

        {/* Overview Stats */}
        <div className={styles.overviewStats}>
          <div>
            <h4 className={styles.conditionTitle}>
              <span style={{ display: "inline-block" }}>{wmoEmoji}</span> {wmoDesc}
            </h4>
            <p className={styles.conditionText} style={{ color: themeColor }}>
              {scoreText}
            </p>
          </div>

          <div className={styles.statsGrid}>
            <div className={`glass-card ${styles.statCard}`}>
              <div className={styles.statLabel}>EST. TIME</div>
              <div className={styles.statVal}>
                {duration} <span style={{ fontSize: "0.7rem", color: "var(--slate-500)", fontWeight: "normal" }}>min</span>
              </div>
            </div>
            <div className={`glass-card ${styles.statCard}`}>
              <div className={styles.statLabel}>DISTANCE</div>
              <div className={styles.statVal}>
                {dispDistance} <span style={{ fontSize: "0.7rem", color: "var(--slate-500)", fontWeight: "normal" }}>{dispDistanceUnit}</span>
              </div>
            </div>
            <div className={`glass-card ${styles.statCard}`}>
              <div className={styles.statLabel}>AVG SPEED</div>
              <div className={styles.statVal}>
                {dispSpeed} <span style={{ fontSize: "0.7rem", color: "var(--slate-500)", fontWeight: "normal" }}>{dispSpeedUnit}</span>
              </div>
            </div>
            <div className={`glass-card ${styles.statCard}`}>
              <div className={styles.statLabel}>WIND FLOW</div>
              <div className={styles.windFlowVal}>
                {windImpact}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Wind breakdown panel */}
      <div className={`glass-card ${styles.windBreakdownCard}`}>
        <h4 className={styles.windBreakdownTitle}>
          Wind Breakdown along Route
        </h4>
        <div className={styles.windGrid}>
          <div>
            <div className={styles.windSubLabel}>Head/Tail</div>
            <div className={styles.windSubVal} style={{
              color: headwind > 0 ? "var(--rose)" : headwind < -2 ? "var(--emerald)" : "var(--slate-800)",
              whiteSpace: "nowrap"
            }}>
              {dispHeadwindText.split(" ")[0]} <span style={{ fontSize: "0.58rem", fontWeight: "normal", color: "var(--slate-400)" }}>{headwindUnit} {dispHeadwindText.split(" ").slice(2).join(" ")}</span>
            </div>
          </div>
          <div>
            <div className={styles.windSubLabel}>Crosswind</div>
            <div className={styles.windSubVal} style={{ color: crosswind > 15 ? "var(--amber)" : "var(--slate-800)" }}>
              {dispCrosswind} <span style={{ fontSize: "0.58rem", color: "var(--slate-400)", fontWeight: "normal" }}>{headwindUnit}</span>
            </div>
          </div>
          <div>
            <div className={styles.windSubLabel}>Max Gusts</div>
            <div className={styles.windSubVal} style={{ color: gusts > 25 ? "var(--rose)" : "var(--slate-800)" }}>
              {dispGusts} <span style={{ fontSize: "0.58rem", color: "var(--slate-400)", fontWeight: "normal" }}>{headwindUnit}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Penalties breakdown panel */}
      {(penalties.temp > 0 || penalties.rain > 0 || penalties.wind > 0 || penalties.wmo > 0) && (
        <div className={styles.penaltiesContainer}>
          <h4 className={styles.penaltiesTitle}>
            <AlertTriangle size={12} style={{ color: "var(--amber)" }} /> Score Reductions
          </h4>
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            {penalties.temp > 0 && (
              <div className={styles.penaltyRow}>
                <span className={styles.penaltyLabel}>🌡️ Sub-optimal Temperature ({dispTemp})</span>
                <span className={styles.penaltyVal} style={{ color: "var(--amber)" }}>-{penalties.temp} pts</span>
              </div>
            )}
            {penalties.rain > 0 && (
              <div className={styles.penaltyRow}>
                <span className={styles.penaltyLabel}>🌧️ Precipitation risk / Probability ({rainProb}%)</span>
                <span className={styles.penaltyVal} style={{ color: "var(--rose)" }}>-{penalties.rain} pts</span>
              </div>
            )}
            {penalties.wind > 0 && (
              <div className={styles.penaltyRow}>
                <span className={styles.penaltyLabel}>💨 Excessive winds or gusty crosswinds</span>
                <span className={styles.penaltyVal} style={{ color: "var(--rose)" }}>-{penalties.wind} pts</span>
              </div>
            )}
            {penalties.wmo > 0 && penalties.wmo < 100 && (
              <div className={styles.penaltyRow}>
                <span className={styles.penaltyLabel}>☁️ General weather penalty ({wmoDesc})</span>
                <span className={styles.penaltyVal} style={{ color: "var(--amber)" }}>-{penalties.wmo} pts</span>
              </div>
            )}
            {penalties.wmo >= 100 && (
              <div className={styles.safetyWarning}>
                <ShieldAlert size={14} style={{ flexShrink: "0" }} />
                <strong>SAFETY WARNING: Thunderstorms detected. Biking is strongly discouraged.</strong>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

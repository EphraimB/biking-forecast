"use client";

import { AlertTriangle, ShieldAlert, Sparkles } from "lucide-react";

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

  // Calculate SVG circle dashoffset
  const radius = 60;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (score / 100) * circumference;

  return (
    <div className="glass-panel animate-fade-in" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <h3 style={{ fontSize: "0.88rem", fontWeight: "800", color: "var(--slate-700)", textTransform: "uppercase", letterSpacing: "0.04em", display: "flex", alignItems: "center", gap: "6px" }}>
        <Sparkles size={16} style={{ color: "var(--primary)" }} /> Commute Suitability
      </h3>

      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", alignItems: "center", gap: "18px" }}>
        {/* Stunning Radial Gauge */}
        <div style={{ position: "relative", width: "120px", height: "120px", display: "flex", justifyContent: "center", alignItems: "center" }}>
          <svg style={{ transform: "rotate(-90deg)", width: "100%", height: "100%" }}>
            {/* Background ring */}
            <circle
              cx="60"
              cy="60"
              r="50"
              fill="transparent"
              stroke="rgba(148, 163, 184, 0.1)"
              strokeWidth="8"
            />
            {/* Animated foreground ring */}
            <circle
              cx="60"
              cy="60"
              r="50"
              fill="transparent"
              stroke={themeColor}
              strokeWidth="8"
              strokeDasharray={2 * Math.PI * 50}
              strokeDashoffset={2 * Math.PI * 50 - (score / 100) * 2 * Math.PI * 50}
              strokeLinecap="round"
              style={{
                transition: "stroke-dashoffset 0.6s cubic-bezier(0.4, 0, 0.2, 1), stroke 0.4s",
                filter: `drop-shadow(0 0 4px ${themeColor})`
              }}
            />
          </svg>
          <div style={{
            position: "absolute",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center"
          }}>
            <span style={{ fontSize: "1.8rem", fontWeight: "800", color: "var(--slate-800)", lineHeight: "1" }}>{score}</span>
            <span style={{ fontSize: "0.6rem", color: "var(--slate-400)", fontWeight: "700", marginTop: "2px" }}>SCORE</span>
          </div>
        </div>

        {/* Overview Stats */}
        <div style={{ flexGrow: "1", display: "flex", flexDirection: "column", gap: "8px", minWidth: "160px" }}>
          <div>
            <h4 style={{ fontSize: "1.05rem", fontWeight: "800", color: "var(--slate-900)", display: "flex", alignItems: "center", gap: "6px" }}>
              <span style={{ display: "inline-block" }}>{wmoEmoji}</span> {wmoDesc}
            </h4>
            <p style={{ fontSize: "0.78rem", color: themeColor, fontWeight: "800", marginTop: "2px" }}>
              {scoreText}
            </p>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginTop: "2px" }}>
            <div className="glass-card" style={{ padding: "6px 10px" }}>
              <div style={{ fontSize: "0.62rem", color: "var(--slate-400)", fontWeight: "600" }}>EST. TIME</div>
              <div style={{ fontSize: "0.92rem", fontWeight: "800", color: "var(--slate-800)" }}>
                {duration} <span style={{ fontSize: "0.7rem", color: "var(--slate-500)", fontWeight: "normal" }}>min</span>
              </div>
            </div>
            <div className="glass-card" style={{ padding: "6px 10px" }}>
              <div style={{ fontSize: "0.62rem", color: "var(--slate-400)", fontWeight: "600" }}>DISTANCE</div>
              <div style={{ fontSize: "0.92rem", fontWeight: "800", color: "var(--slate-800)" }}>
                {dispDistance} <span style={{ fontSize: "0.7rem", color: "var(--slate-500)", fontWeight: "normal" }}>{dispDistanceUnit}</span>
              </div>
            </div>
            <div className="glass-card" style={{ padding: "6px 10px" }}>
              <div style={{ fontSize: "0.62rem", color: "var(--slate-400)", fontWeight: "600" }}>AVG SPEED</div>
              <div style={{ fontSize: "0.92rem", fontWeight: "800", color: "var(--slate-800)" }}>
                {dispSpeed} <span style={{ fontSize: "0.7rem", color: "var(--slate-500)", fontWeight: "normal" }}>{dispSpeedUnit}</span>
              </div>
            </div>
            <div className="glass-card" style={{ padding: "6px 10px" }}>
              <div style={{ fontSize: "0.62rem", color: "var(--slate-400)", fontWeight: "600" }}>WIND FLOW</div>
              <div style={{ fontSize: "0.7rem", fontWeight: "800", color: "var(--slate-800)", marginTop: "2px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {windImpact}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Wind breakdown panel */}
      <div className="glass-card" style={{ display: "flex", flexDirection: "column", gap: "8px", padding: "10px 12px" }}>
        <h4 style={{ fontSize: "0.68rem", fontWeight: "800", textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--slate-400)" }}>
          Wind Breakdown along Route
        </h4>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "6px" }}>
          <div>
            <div style={{ fontSize: "0.62rem", color: "var(--slate-400)" }}>Head/Tail</div>
            <div style={{
              fontSize: "0.82rem",
              fontWeight: "800",
              color: headwind > 0 ? "var(--rose)" : headwind < -2 ? "var(--emerald)" : "var(--slate-800)",
              marginTop: "2px",
              whiteSpace: "nowrap"
            }}>
              {dispHeadwindText.split(" ")[0]} <span style={{ fontSize: "0.58rem", fontWeight: "normal", color: "var(--slate-400)" }}>{headwindUnit} {dispHeadwindText.split(" ").slice(2).join(" ")}</span>
            </div>
          </div>
          <div>
            <div style={{ fontSize: "0.62rem", color: "var(--slate-400)" }}>Crosswind</div>
            <div style={{ fontSize: "0.82rem", fontWeight: "800", color: crosswind > 15 ? "var(--amber)" : "var(--slate-800)", marginTop: "2px" }}>
              {dispCrosswind} <span style={{ fontSize: "0.58rem", color: "var(--slate-400)", fontWeight: "normal" }}>{headwindUnit}</span>
            </div>
          </div>
          <div>
            <div style={{ fontSize: "0.62rem", color: "var(--slate-400)" }}>Max Gusts</div>
            <div style={{ fontSize: "0.82rem", fontWeight: "800", color: gusts > 25 ? "var(--rose)" : "var(--slate-800)", marginTop: "2px" }}>
              {dispGusts} <span style={{ fontSize: "0.58rem", color: "var(--slate-400)", fontWeight: "normal" }}>{headwindUnit}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Penalties breakdown panel */}
      {(penalties.temp > 0 || penalties.rain > 0 || penalties.wind > 0 || penalties.wmo > 0) && (
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <h4 style={{ fontSize: "0.68rem", fontWeight: "800", textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--slate-400)", display: "flex", alignItems: "center", gap: "4px" }}>
            <AlertTriangle size={12} style={{ color: "var(--amber)" }} /> Score Reductions
          </h4>
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            {penalties.temp > 0 && (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.72rem" }}>
                <span style={{ color: "var(--slate-500)" }}>🌡️ Sub-optimal Temperature ({dispTemp})</span>
                <span style={{ color: "var(--amber)", fontWeight: "700" }}>-{penalties.temp} pts</span>
              </div>
            )}
            {penalties.rain > 0 && (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.72rem" }}>
                <span style={{ color: "var(--slate-500)" }}>🌧️ Precipitation risk / Probability ({rainProb}%)</span>
                <span style={{ color: "var(--rose)", fontWeight: "700" }}>-{penalties.rain} pts</span>
              </div>
            )}
            {penalties.wind > 0 && (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.72rem" }}>
                <span style={{ color: "var(--slate-500)" }}>💨 Excessive winds or gusty crosswinds</span>
                <span style={{ color: "var(--rose)", fontWeight: "700" }}>-{penalties.wind} pts</span>
              </div>
            )}
            {penalties.wmo > 0 && penalties.wmo < 100 && (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.72rem" }}>
                <span style={{ color: "var(--slate-500)" }}>☁️ General weather penalty ({wmoDesc})</span>
                <span style={{ color: "var(--amber)", fontWeight: "700" }}>-{penalties.wmo} pts</span>
              </div>
            )}
            {penalties.wmo >= 100 && (
              <div style={{ display: "flex", alignItems: "center", gap: "8px", background: "rgba(225,29,72,0.06)", border: "1px solid rgba(225,29,72,0.15)", borderRadius: "8px", padding: "8px", color: "var(--rose)", fontSize: "0.72rem" }}>
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

"use client";

import { AlertTriangle, Clock, ArrowRight, ShieldAlert, Sparkles, Navigation } from "lucide-react";

export default function ScoreMetric({ forecast }) {
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

  // Determine score color theme
  let themeColor = "var(--rose)";
  let glowColor = "var(--rose-glow)";
  let scoreText = "Poor Conditions";
  
  if (score >= 80) {
    themeColor = "var(--emerald)";
    glowColor = "var(--emerald-glow)";
    scoreText = "Perfect for Biking!";
  } else if (score >= 50) {
    themeColor = "var(--amber)";
    glowColor = "var(--amber-glow)";
    scoreText = "Acceptable Biking";
  }

  // Calculate SVG circle dashoffset
  const radius = 60;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (score / 100) * circumference;

  return (
    <div className="glass-panel animate-fade-in" style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <h3 style={{ fontSize: "1.1rem", fontWeight: "700", display: "flex", alignItems: "center", gap: "8px" }}>
        <Sparkles size={18} style={{ color: "var(--primary)" }} /> Commute Suitability
      </h3>

      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", alignItems: "center", gap: "24px" }}>
        {/* Stunning Radial Gauge */}
        <div style={{ position: "relative", width: "150px", height: "150px", display: "flex", justifyContent: "center", alignItems: "center" }}>
          <svg style={{ transform: "rotate(-90deg)", width: "100%", height: "100%" }}>
            {/* Background ring */}
            <circle
              cx="75"
              cy="75"
              r={radius}
              fill="transparent"
              stroke="rgba(255,255,255,0.05)"
              strokeWidth="10"
            />
            {/* Animated foreground ring */}
            <circle
              cx="75"
              cy="75"
              r={radius}
              fill="transparent"
              stroke={themeColor}
              strokeWidth="10"
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              strokeLinecap="round"
              style={{
                transition: "stroke-dashoffset 0.6s cubic-bezier(0.4, 0, 0.2, 1), stroke 0.4s",
                filter: `drop-shadow(0 0 6px ${themeColor})`
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
            <span style={{ fontSize: "2.2rem", fontWeight: "800", color: "white", lineHeight: "1" }}>{score}</span>
            <span style={{ fontSize: "0.75rem", color: "var(--slate-400)", fontWeight: "600", marginTop: "4px" }}>SCORE</span>
          </div>
        </div>

        {/* Overview Stats */}
        <div style={{ flexGrow: "1", display: "flex", flexDirection: "column", gap: "12px", minWidth: "180px" }}>
          <div>
            <h4 style={{ fontSize: "1.2rem", fontWeight: "800", color: "white", display: "flex", alignItems: "center", gap: "6px" }}>
              <span style={{ display: "inline-block" }}>{wmoEmoji}</span> {wmoDesc}
            </h4>
            <p style={{ fontSize: "0.85rem", color: themeColor, fontWeight: "700", marginTop: "2px" }}>
              {scoreText}
            </p>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginTop: "4px" }}>
            <div className="glass-card" style={{ padding: "8px 12px" }}>
              <div style={{ fontSize: "0.7rem", color: "var(--slate-500)" }}>EST. DURATION</div>
              <div style={{ fontSize: "1.1rem", fontWeight: "700", color: "white" }}>
                {duration} <span style={{ fontSize: "0.8rem", color: "var(--slate-400)" }}>min</span>
              </div>
            </div>
            <div className="glass-card" style={{ padding: "8px 12px" }}>
              <div style={{ fontSize: "0.7rem", color: "var(--slate-500)" }}>DISTANCE</div>
              <div style={{ fontSize: "1.1rem", fontWeight: "700", color: "white" }}>
                {distance} <span style={{ fontSize: "0.8rem", color: "var(--slate-400)" }}>km</span>
              </div>
            </div>
            <div className="glass-card" style={{ padding: "8px 12px" }}>
              <div style={{ fontSize: "0.7rem", color: "var(--slate-500)" }}>AVG SPEED</div>
              <div style={{ fontSize: "1.1rem", fontWeight: "700", color: "white" }}>
                {speed} <span style={{ fontSize: "0.8rem", color: "var(--slate-400)" }}>km/h</span>
              </div>
            </div>
            <div className="glass-card" style={{ padding: "8px 12px" }}>
              <div style={{ fontSize: "0.7rem", color: "var(--slate-500)" }}>WIND IMPACT</div>
              <div style={{ fontSize: "0.8rem", fontWeight: "700", color: "white", marginTop: "4px" }}>
                {windImpact}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Wind breakdown panel */}
      <div className="glass-card" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        <h4 style={{ fontSize: "0.8rem", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--slate-400)" }}>
          Wind Breakdown along Route
        </h4>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "8px" }}>
          <div>
            <div style={{ fontSize: "0.7rem", color: "var(--slate-500)" }}>Headwind/Tailwind</div>
            <div style={{
              fontSize: "0.95rem",
              fontWeight: "700",
              color: headwind > 0 ? "var(--rose)" : headwind < -2 ? "var(--emerald)" : "white",
              display: "flex",
              alignItems: "center",
              gap: "4px",
              marginTop: "2px"
            }}>
              {headwind > 0 ? `+${headwind} km/h` : `${headwind} km/h`}
              <span style={{ fontSize: "0.65rem", fontWeight: "normal", color: "var(--slate-500)" }}>
                {headwind > 0 ? "headwind" : "tailwind"}
              </span>
            </div>
          </div>
          <div>
            <div style={{ fontSize: "0.7rem", color: "var(--slate-500)" }}>Crosswind</div>
            <div style={{ fontSize: "0.95rem", fontWeight: "700", color: crosswind > 15 ? "var(--amber)" : "white", marginTop: "2px" }}>
              {crosswind} <span style={{ fontSize: "0.7rem", color: "var(--slate-400)", fontWeight: "normal" }}>km/h</span>
            </div>
          </div>
          <div>
            <div style={{ fontSize: "0.7rem", color: "var(--slate-500)" }}>Max Gusts</div>
            <div style={{ fontSize: "0.95rem", fontWeight: "700", color: gusts > 25 ? "var(--rose)" : "white", marginTop: "2px" }}>
              {gusts} <span style={{ fontSize: "0.7rem", color: "var(--slate-400)", fontWeight: "normal" }}>km/h</span>
            </div>
          </div>
        </div>
      </div>

      {/* Penalties breakdown panel */}
      {(penalties.temp > 0 || penalties.rain > 0 || penalties.wind > 0 || penalties.wmo > 0) && (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <h4 style={{ fontSize: "0.8rem", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--slate-400)", display: "flex", alignItems: "center", gap: "4px" }}>
            <AlertTriangle size={12} style={{ color: "var(--amber)" }} /> Score Reductions
          </h4>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            {penalties.temp > 0 && (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.8rem" }}>
                <span style={{ color: "var(--slate-300)" }}>🌡️ Temperature (Sub-optimal, {temp}°C)</span>
                <span style={{ color: "var(--amber)", fontWeight: "600" }}>-{penalties.temp} pts</span>
              </div>
            )}
            {penalties.rain > 0 && (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.8rem" }}>
                <span style={{ color: "var(--slate-300)" }}>🌧️ Rain risk / Probability ({rainProb}%)</span>
                <span style={{ color: "var(--rose)", fontWeight: "600" }}>-{penalties.rain} pts</span>
              </div>
            )}
            {penalties.wind > 0 && (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.8rem" }}>
                <span style={{ color: "var(--slate-300)" }}>💨 Headwind, crosswinds, or strong gusts</span>
                <span style={{ color: "var(--rose)", fontWeight: "600" }}>-{penalties.wind} pts</span>
              </div>
            )}
            {penalties.wmo > 0 && penalties.wmo < 100 && (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.8rem" }}>
                <span style={{ color: "var(--slate-300)" }}>☁️ General weather conditions ({wmoDesc})</span>
                <span style={{ color: "var(--amber)", fontWeight: "600" }}>-{penalties.wmo} pts</span>
              </div>
            )}
            {penalties.wmo >= 100 && (
              <div style={{ display: "flex", alignItems: "center", gap: "8px", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: "6px", padding: "8px", color: "var(--rose)", fontSize: "0.75rem" }}>
                <ShieldAlert size={14} />
                <strong>SAFETY WARNING: Thunderstorms or extreme conditions detected. Biking is strongly discouraged.</strong>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

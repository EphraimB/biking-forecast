"use client";

import React from "react";

export default function RadialGauge({ score, themeColor, containerClassName, textScoreClassName, textLabelClassName }) {
  const radius = 50;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (score / 100) * circumference;

  return (
    <div className={containerClassName} style={{ position: "relative", width: "120px", height: "120px", display: "flex", justifyContent: "center", alignItems: "center" }}>
      <svg style={{ transform: "rotate(-90deg)", width: "100%", height: "100%" }}>
        {/* Background ring */}
        <circle
          cx="60"
          cy="60"
          r={radius}
          fill="transparent"
          stroke="rgba(148, 163, 184, 0.1)"
          strokeWidth="8"
        />
        {/* Animated foreground ring */}
        <circle
          cx="60"
          cy="60"
          r={radius}
          fill="transparent"
          stroke={themeColor}
          strokeWidth="8"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
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
        <span className={textScoreClassName} style={{ fontSize: "1.8rem", fontWeight: "800", color: "var(--slate-800)", lineHeight: "1" }}>{score}</span>
        <span className={textLabelClassName} style={{ fontSize: "0.6rem", color: "var(--slate-400)", fontWeight: "700", marginTop: "2px" }}>SCORE</span>
      </div>
    </div>
  );
}

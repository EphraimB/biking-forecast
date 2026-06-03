"use client";

import React from "react";
import Speedometer from "./svgs/Speedometer";
import WindDial from "./svgs/WindDial";

export default function RouteMapTooltip({
  difficulty,
  color,
  displaySpeed,
  speedPercent,
  bearing,
  windDir,
  displayWind,
  windCompass,
  displayHeadwind
}) {
  return (
    <div style={{ minWidth: "220px", color: "var(--hud-text-primary)", padding: "4px" }}>
      <div style={{ borderBottom: "1px solid var(--hud-border)", paddingBottom: "6px", marginBottom: "8px" }}>
        <span style={{ fontFamily: "var(--font-heading)", fontSize: "13px", fontWeight: "800", color: color }}>
          {difficulty}
        </span>
      </div>
      
      {/* 2-Column Telemetry Grid */}
      <div className="tooltip-grid-container">
        
        {/* Left Column: Speedometer Stats */}
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <div className="tooltip-cell">
            <span className="tooltip-label">BIKER SPEED</span>
            <strong className="tooltip-val" style={{ color: color }}>{displaySpeed}</strong>
            
            {/* Speedometer Bar Component */}
            <Speedometer speedPercent={speedPercent} color={color} />
          </div>
        </div>
        
        {/* Right Column: Dual Wind Dial Component */}
        <WindDial
          bearing={bearing}
          windDir={windDir}
          color={color}
          displayWind={displayWind}
          windCompass={windCompass}
          labelClassName="tooltip-label"
        />
      </div>
      
      <div className="tooltip-divider">
        🚴 Resistance: <strong style={{ color: color }}>{displayHeadwind}</strong>
      </div>
    </div>
  );
}

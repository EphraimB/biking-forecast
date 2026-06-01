"use client";

import React from "react";

export default function WindDial({ bearing, windDir, color, displayWind, windCompass, containerClassName, labelClassName, valueClassName }) {
  return (
    <div 
      className={containerClassName} 
      style={{ 
        display: "flex", 
        flexDirection: "column", 
        alignItems: "center", 
        justifyContent: "center", 
        background: "rgba(255, 255, 255, 0.03)", 
        padding: "6px", 
        borderRadius: "8px", 
        border: "1px solid rgba(255, 255, 255, 0.06)" 
      }}
    >
      <span className={labelClassName} style={{ fontSize: "8px", color: "var(--hud-text-secondary)", letterSpacing: "0.05em", display: "block", textTransform: "uppercase", marginBottom: "4px", textAlign: "center" }}>
        WIND ALIGN
      </span>
      
      <svg width="44" height="44" viewBox="0 0 44 44" style={{ overflow: "visible" }}>
        {/* Compass Ring */}
        <circle cx="22" cy="22" r="19" fill="none" stroke="rgba(255, 255, 255, 0.15)" strokeWidth="1" />
        <text x="22" y="7" fontSize="6" textAnchor="middle" fill="rgba(255, 255, 255, 0.4)" fontWeight="700">N</text>
        
        {/* Rider Bearing Vector (Silver dashed line arrow) */}
        <g transform={`rotate(${bearing}, 22, 22)`}>
          <line x1="22" y1="22" x2="22" y2="5" stroke="rgba(255, 255, 255, 0.5)" strokeWidth="1.5" strokeDasharray="2,2" />
          <polygon points="22,3 25,7 19,7" fill="rgba(255, 255, 255, 0.6)" />
        </g>
        
        {/* Wind Vector (Solid arrow pointing in wind direction) */}
        <g transform={`rotate(${windDir}, 22, 22)`}>
          {/* Line showing wind source direction */}
          <line x1="22" y1="38" x2="22" y2="22" stroke={color} strokeWidth="2" />
          {/* arrowhead pointing towards center to show direction it is blowing */}
          <polygon points="22,20 18,25 26,25" fill={color} style={{ filter: `drop-shadow(0 0 2px ${color})` }} />
        </g>
      </svg>
      <span className={valueClassName} style={{ fontSize: "8px", fontWeight: "700", color: "var(--hud-text-primary)", marginTop: "4px", textAlign: "center" }}>
        {displayWind} {windCompass}
      </span>
    </div>
  );
}

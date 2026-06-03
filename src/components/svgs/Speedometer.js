"use client";

import React from "react";

export default function Speedometer({ speedPercent, color, className }) {
  return (
    <svg width="100%" height="8" className={className} style={{ marginTop: "4px", overflow: "visible" }}>
      <rect x="0" y="2" width="100%" height="4" rx="2" fill="var(--hud-border)" />
      <rect x="0" y="2" width={`${speedPercent}%`} height="4" rx="2" fill={color} />
    </svg>
  );
}

"use client";

import React from "react";

export default function WindStreams({ 
  ambientWindDir, 
  ambientWindSpeed, 
  weatherResultsLength, 
  isHighGust, 
  windAnimDuration, 
  svgClassName, 
  lineClassName 
}) {
  const dynamicTransform = `rotate(${(ambientWindDir + 90) % 360}deg)`;
  const dynamicOpacity = weatherResultsLength > 0 ? Math.min(0.40, 0.08 + (ambientWindSpeed / 45)) : 0.08;

  return (
    <svg 
      className={svgClassName} 
      style={{ 
        position: "absolute",
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        transform: dynamicTransform,
        opacity: dynamicOpacity,
        transition: "opacity 1.2s ease, transform 1.2s ease"
      }}
    >
      <g>
        <path className={`${lineClassName} ${isHighGust ? "gusting" : ""}`} style={{ animationDuration: windAnimDuration }} d="M -100,100 L 2000,100" />
        <path className={`${lineClassName} ${isHighGust ? "gusting" : ""}`} style={{ animationDuration: windAnimDuration, animationDelay: "1.5s" }} d="M -100,250 L 2000,250" />
        <path className={`${lineClassName} ${isHighGust ? "gusting" : ""}`} style={{ animationDuration: windAnimDuration, animationDelay: "3.2s" }} d="M -100,450 L 2000,450" />
        <path className={`${lineClassName} ${isHighGust ? "gusting" : ""}`} style={{ animationDuration: windAnimDuration, animationDelay: "0.5s" }} d="M -100,600 L 2000,600" />
        <path className={`${lineClassName} ${isHighGust ? "gusting" : ""}`} style={{ animationDuration: windAnimDuration, animationDelay: "2.1s" }} d="M -100,750 L 2000,750" />
        <path className={`${lineClassName} ${isHighGust ? "gusting" : ""}`} style={{ animationDuration: windAnimDuration, animationDelay: "4s" }} d="M -100,900 L 2000,900" />
      </g>
    </svg>
  );
}

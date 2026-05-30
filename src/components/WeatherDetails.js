"use client";

import { MapPin, Navigation, Compass, Wind } from "lucide-react";
import { WMO_MAP } from "@/utils/weatherScoring";

export default function WeatherDetails({ weatherResults, hourIndex, startLocation, endLocation }) {
  if (!weatherResults || weatherResults.length === 0) return null;

  const numPoints = weatherResults.length;
  
  // Format specific sample points to display (Start, Mid, End)
  const displayPoints = [];
  
  // Start Point
  displayPoints.push({
    title: "Start Point",
    name: startLocation?.label ? startLocation.label.split(",")[0] : "Origin",
    icon: "🟢",
    data: weatherResults[0]
  });
  
  // Mid Point (if we have more than 2 sample points)
  if (numPoints > 2) {
    const midIdx = Math.floor(numPoints / 2);
    displayPoints.push({
      title: numPoints === 3 ? "Midpoint" : `Mid Route (Station #${midIdx + 1})`,
      name: "En-route weather interpolation",
      icon: "🟡",
      data: weatherResults[midIdx]
    });
  }
  
  // End Point
  displayPoints.push({
    title: "Destination",
    name: endLocation?.label ? endLocation.label.split(",")[0] : "Destination",
    icon: "🔴",
    data: weatherResults[numPoints - 1]
  });

  return (
    <div className="glass-panel animate-fade-in" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <h3 style={{ fontSize: "1.1rem", fontWeight: "700", display: "flex", alignItems: "center", gap: "8px" }}>
        <MapPin size={18} style={{ color: "var(--primary)" }} /> Route-Specific Weather
      </h3>

      <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "12px" }}>
        {displayPoints.map((point, index) => {
          const hourly = point.data?.hourly;
          if (!hourly) return null;

          const temp = hourly.temperature_2m?.[hourIndex] ?? 20;
          const wmo = hourly.weather_code?.[hourIndex] ?? 0;
          const rain = hourly.precipitation_probability?.[hourIndex] ?? 0;
          const windSp = hourly.wind_speed_10m?.[hourIndex] ?? 0;
          const windDi = hourly.wind_direction_10m?.[hourIndex] ?? 0;
          
          const wmoInfo = WMO_MAP[wmo] || { desc: "Clear", emoji: "☀️" };

          return (
            <div key={index} className="glass-card" style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: "16px",
              flexWrap: "wrap",
              borderLeft: `4px solid ${index === 0 ? "var(--emerald)" : index === displayPoints.length - 1 ? "var(--rose)" : "var(--amber)"}`
            }}>
              {/* Location Column */}
              <div style={{ flexGrow: "1", minWidth: "150px", display: "flex", flexDirection: "column", gap: "4px" }}>
                <span style={{ fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--slate-400)", fontWeight: "700" }}>
                  {point.title}
                </span>
                <span style={{ fontSize: "0.95rem", fontWeight: "700", color: "white", textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap", maxWidth: "250px" }}>
                  {point.name}
                </span>
              </div>

              {/* Temperature & Conditions Column */}
              <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: "100px" }}>
                <span style={{ fontSize: "1.8rem" }}>{wmoInfo.emoji}</span>
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <span style={{ fontSize: "1.1rem", fontWeight: "700", color: "white" }}>
                    {temp.toFixed(1)}°C
                  </span>
                  <span style={{ fontSize: "0.75rem", color: "var(--slate-400)" }}>
                    {wmoInfo.desc}
                  </span>
                </div>
              </div>

              {/* Rain Probability Column */}
              <div style={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: "80px" }}>
                <span style={{ fontSize: "0.7rem", color: "var(--slate-500)", fontWeight: "600" }}>RAIN PROB</span>
                <span style={{ fontSize: "0.95rem", fontWeight: "700", color: rain > 30 ? "var(--rose)" : "white" }}>
                  {rain}%
                </span>
              </div>

              {/* Wind Column */}
              <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: "100px" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                  <span style={{ fontSize: "0.7rem", color: "var(--slate-500)", fontWeight: "600" }}>WIND</span>
                  <span style={{ fontSize: "0.95rem", fontWeight: "700", color: "white" }}>
                    {windSp.toFixed(1)} <span style={{ fontSize: "0.7rem", color: "var(--slate-400)", fontWeight: "normal" }}>km/h</span>
                  </span>
                </div>
                {/* Wind direction compass arrow */}
                <div style={{
                  width: "28px",
                  height: "28px",
                  borderRadius: "50%",
                  background: "rgba(255,255,255,0.05)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  border: "1px solid var(--card-border)",
                  transform: `rotate(${windDi}deg)`,
                  transition: "transform 0.5s ease"
                }}
                title={`Wind direction: ${windDi}°`}
                >
                  <Navigation size={12} style={{ color: "var(--primary)", fill: "var(--primary)" }} />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

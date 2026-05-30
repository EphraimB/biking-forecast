"use client";

import { MapPin, Navigation } from "lucide-react";
import { WMO_MAP } from "@/utils/weatherScoring";

export default function WeatherDetails({ weatherResults, hourIndex, startLocation, endLocation, unitSystem = "metric" }) {
  if (!weatherResults || weatherResults.length === 0) return null;

  const numPoints = weatherResults.length;
  const isImperial = unitSystem === "imperial";
  
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
    <div className="glass-panel animate-fade-in" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      <h3 style={{ fontSize: "0.88rem", fontWeight: "800", color: "var(--slate-700)", textTransform: "uppercase", letterSpacing: "0.04em", display: "flex", alignItems: "center", gap: "6px" }}>
        <MapPin size={16} style={{ color: "var(--primary)" }} /> Route-Specific Weather
      </h3>

      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {displayPoints.map((point, index) => {
          const hourly = point.data?.hourly;
          if (!hourly) return null;

          const temp = hourly.temperature_2m?.[hourIndex] ?? 20;
          const wmo = hourly.weather_code?.[hourIndex] ?? 0;
          const rain = hourly.precipitation_probability?.[hourIndex] ?? 0;
          const windSp = hourly.wind_speed_10m?.[hourIndex] ?? 0;
          const windDi = hourly.wind_direction_10m?.[hourIndex] ?? 0;
          
          const wmoInfo = WMO_MAP[wmo] || { desc: "Clear", emoji: "☀️" };

          const dispTemp = isImperial ? `${(temp * 1.8 + 32).toFixed(1)}°F` : `${temp.toFixed(1)}°C`;
          const dispWind = isImperial 
            ? `${(windSp * 0.621371).toFixed(1)} mph` 
            : `${windSp.toFixed(1)} km/h`;

          return (
            <div key={index} className="glass-card" style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: "12px",
              flexWrap: "wrap",
              padding: "10px 14px",
              borderLeft: `4px solid ${index === 0 ? "var(--emerald)" : index === displayPoints.length - 1 ? "var(--rose)" : "var(--amber)"}`
            }}>
              {/* Location Column */}
              <div style={{ flexGrow: "1", minWidth: "120px", display: "flex", flexDirection: "column", gap: "2px" }}>
                <span style={{ fontSize: "0.65rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--slate-400)", fontWeight: "700" }}>
                  {point.title}
                </span>
                <span style={{ fontSize: "0.85rem", fontWeight: "800", color: "var(--slate-800)", textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap", maxWidth: "160px" }}>
                  {point.name}
                </span>
              </div>

              {/* Temperature & Conditions Column */}
              <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: "90px" }}>
                <span style={{ fontSize: "1.4rem" }}>{wmoInfo.emoji}</span>
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <span style={{ fontSize: "0.92rem", fontWeight: "800", color: "var(--slate-800)" }}>
                    {dispTemp}
                  </span>
                  <span style={{ fontSize: "0.68rem", color: "var(--slate-400)" }}>
                    {wmoInfo.desc}
                  </span>
                </div>
              </div>

              {/* Rain Probability Column */}
              <div style={{ display: "flex", flexDirection: "column", gap: "1px", minWidth: "60px" }}>
                <span style={{ fontSize: "0.62rem", color: "var(--slate-400)", fontWeight: "600" }}>RAIN</span>
                <span style={{ fontSize: "0.85rem", fontWeight: "800", color: rain > 30 ? "var(--rose)" : "var(--slate-800)" }}>
                  {rain}%
                </span>
              </div>

              {/* Wind Column */}
              <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: "90px" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "1px" }}>
                  <span style={{ fontSize: "0.62rem", color: "var(--slate-400)", fontWeight: "600" }}>WIND</span>
                  <span style={{ fontSize: "0.85rem", fontWeight: "800", color: "var(--slate-800)", whiteSpace: "nowrap" }}>
                    {dispWind.split(" ")[0]} <span style={{ fontSize: "0.68rem", color: "var(--slate-500)", fontWeight: "normal" }}>{dispWind.split(" ")[1]}</span>
                  </span>
                </div>
                {/* Wind direction compass arrow */}
                <div style={{
                  width: "24px",
                  height: "24px",
                  borderRadius: "50%",
                  background: "#f1f5f9",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  border: "1px solid rgba(226, 232, 240, 0.8)",
                  transform: `rotate(${windDi}deg)`,
                  transition: "transform 0.5s ease"
                }}
                title={`Wind direction: ${windDi}°`}
                >
                  <Navigation size={10} style={{ color: "var(--primary)", fill: "var(--primary)" }} />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

"use client";

import React from "react";
import { MapPin, Navigation } from "lucide-react";
import { WMO_MAP } from "@/utils/weatherScoring";
import styles from "./WeatherDetails.module.css";

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
    <div className={`glass-panel animate-fade-in ${styles.weatherDetailsContainer}`}>
      <h3 className={styles.weatherDetailsTitle}>
        <MapPin size={16} style={{ color: "var(--primary)" }} /> Route-Specific Weather
      </h3>

      <div className={styles.weatherPointsList}>
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

          // Define dynamic border left colors
          const borderLeftColor = index === 0 
            ? "var(--emerald)" 
            : index === displayPoints.length - 1 
              ? "var(--rose)" 
              : "var(--amber)";

          return (
            <div key={index} className={`glass-card ${styles.pointCard}`} style={{ borderLeft: `4px solid ${borderLeftColor}` }}>
              {/* Location Column */}
              <div className={styles.locationCol}>
                <span className={styles.locationLabel}>
                  {point.title}
                </span>
                <span className={styles.locationName}>
                  {point.name}
                </span>
              </div>

              {/* Temperature & Conditions Column */}
              <div className={styles.tempCol}>
                <span className={styles.weatherEmoji}>{wmoInfo.emoji}</span>
                <div className={styles.tempVals}>
                  <span className={styles.tempDisp}>
                    {dispTemp}
                  </span>
                  <span className={styles.conditionDesc}>
                    {wmoInfo.desc}
                  </span>
                </div>
              </div>

              {/* Rain Probability Column */}
              <div className={styles.rainCol}>
                <span className={styles.rainLabel}>RAIN</span>
                <span className={styles.rainVal} style={{ color: rain > 30 ? "var(--rose)" : "var(--slate-800)" }}>
                  {rain}%
                </span>
              </div>

              {/* Wind Column */}
              <div className={styles.windCol}>
                <div className={styles.windTextGroup}>
                  <span className={styles.windLabel}>WIND</span>
                  <span className={styles.windVal}>
                    {dispWind.split(" ")[0]} <span className={styles.windUnit}>{dispWind.split(" ")[1]}</span>
                  </span>
                </div>
                {/* Wind direction compass arrow */}
                <div 
                  className={styles.compassBadge}
                  style={{ transform: `rotate(${windDi}deg)` }}
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

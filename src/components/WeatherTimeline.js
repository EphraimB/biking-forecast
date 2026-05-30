"use client";

import { useEffect, useState } from "react";
import { Clock, ArrowRight, Sun, Calendar, ThumbsUp, CloudRain, AlertTriangle } from "lucide-react";
import { calculateCommuteScore, WMO_MAP } from "@/utils/weatherScoring";

const DAYS_OF_WEEK = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const SHORT_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function WeatherTimeline({
  weatherResults,
  routeSegments,
  baseSpeed,
  selectedDay,
  setSelectedDay,
  selectedHour,
  setSelectedHour,
  preferences = {}
}) {
  const [dailyAverages, setDailyAverages] = useState([]);
  const [hourlyForecastsForDay, setHourlyForecastsForDay] = useState([]);

  // Calculate scores for all 168 hours and summarize them by day
  useEffect(() => {
    if (!weatherResults || weatherResults.length === 0 || !routeSegments || routeSegments.length === 0) {
      return;
    }

    const calculatedHourly = [];
    const dailySums = Array(7).fill(0).map(() => ({ sum: 0, count: 0, maxScore: -1, bestHour: -1, emoji: "☀️" }));

    // Calculate score for every single hour
    for (let h = 0; h < 168; h++) {
      const dayIdx = Math.floor(h / 24);
      const hourInDay = h % 24;
      
      const metrics = calculateCommuteScore(h, routeSegments, baseSpeed, weatherResults, preferences);
      calculatedHourly.push(metrics);

      // Only average standard daytime hours (7 AM to 7 PM) for the daily summary score
      if (hourInDay >= 7 && hourInDay <= 19) {
        dailySums[dayIdx].sum += metrics.score;
        dailySums[dayIdx].count++;
      }
      
      // Track best overall hour of the day
      if (metrics.score > dailySums[dayIdx].maxScore) {
        dailySums[dayIdx].maxScore = metrics.score;
        dailySums[dayIdx].bestHour = hourInDay;
        // Use weather emoji from the best hour as the day's emoji representation
        dailySums[dayIdx].emoji = metrics.wmoEmoji;
      }
    }

    const averages = dailySums.map((d, idx) => {
      const date = new Date(weatherResults[0].hourly.time[idx * 24]);
      return {
        dayName: SHORT_DAYS[date.getDay()],
        fullName: DAYS_OF_WEEK[date.getDay()],
        dateStr: date.toLocaleDateString([], { month: "short", day: "numeric" }),
        avgScore: d.count > 0 ? Math.round(d.sum / d.count) : 50,
        bestHour: d.bestHour,
        emoji: d.emoji
      };
    });

    setDailyAverages(averages);
  }, [weatherResults, routeSegments, baseSpeed, preferences]);

  // Extract hourly forecasts for currently selected day
  useEffect(() => {
    if (!weatherResults || weatherResults.length === 0 || !routeSegments || routeSegments.length === 0) {
      return;
    }

    const startHourIdx = selectedDay * 24;
    const dayForecasts = [];

    for (let i = 0; i < 24; i++) {
      const hourIdx = startHourIdx + i;
      const metrics = calculateCommuteScore(hourIdx, routeSegments, baseSpeed, weatherResults, preferences);
      
      const date = new Date(weatherResults[0].hourly.time[hourIdx]);
      const hourStr = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

      dayForecasts.push({
        hourStr,
        hourIndexInDay: i,
        hourIndexOverall: hourIdx,
        ...metrics
      });
    }

    setHourlyForecastsForDay(dayForecasts);
  }, [weatherResults, routeSegments, baseSpeed, selectedDay, preferences]);

  if (!weatherResults || weatherResults.length === 0 || dailyAverages.length === 0) {
    return null;
  }

  // 1. Calculate best morning and evening departures for the selected day
  const morningCommutes = hourlyForecastsForDay.filter(h => h.hourIndexInDay >= 7 && h.hourIndexInDay <= 10);
  const eveningCommutes = hourlyForecastsForDay.filter(h => h.hourIndexInDay >= 16 && h.hourIndexInDay <= 19);

  let bestMorning = null;
  if (morningCommutes.length > 0) {
    bestMorning = morningCommutes.reduce((prev, current) => (prev.score > current.score) ? prev : current);
  }

  let bestEvening = null;
  if (eveningCommutes.length > 0) {
    bestEvening = eveningCommutes.reduce((prev, current) => (prev.score > current.score) ? prev : current);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      {/* 7-DAY HORIZONTAL SELECTOR BAR */}
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        <h3 style={{ fontSize: "1.1rem", fontWeight: "700", display: "flex", alignItems: "center", gap: "8px" }}>
          <Calendar size={18} style={{ color: "var(--primary)" }} /> 7-Day Calendar
        </h3>
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, 1fr)",
          gap: "8px",
          overflowX: "auto",
          paddingBottom: "4px"
        }}>
          {dailyAverages.map((day, idx) => {
            const isActive = selectedDay === idx;
            let scoreColor = "var(--rose)";
            if (day.avgScore >= 80) scoreColor = "var(--emerald)";
            else if (day.avgScore >= 50) scoreColor = "var(--amber)";

            return (
              <div
                key={idx}
                onClick={() => setSelectedDay(idx)}
                style={{
                  background: isActive ? "rgba(99, 102, 241, 0.15)" : "rgba(17, 24, 39, 0.4)",
                  border: isActive ? "1px solid var(--primary)" : "1px solid var(--card-border)",
                  borderRadius: "12px",
                  padding: "12px 6px",
                  textAlign: "center",
                  cursor: "pointer",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: "6px",
                  transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
                  boxShadow: isActive ? "0 4px 15px rgba(99, 102, 241, 0.2)" : "none"
                }}
                onMouseEnter={(e) => !isActive && (e.currentTarget.style.borderColor = "rgba(255,255,255,0.15)")}
                onMouseLeave={(e) => !isActive && (e.currentTarget.style.borderColor = "var(--card-border)")}
              >
                <span style={{ fontSize: "0.75rem", color: isActive ? "white" : "var(--slate-400)", fontWeight: "600" }}>
                  {day.dayName}
                </span>
                <span style={{ fontSize: "0.7rem", color: "var(--slate-500)", marginTop: "-2px" }}>
                  {day.dateStr}
                </span>
                <span style={{ fontSize: "1.5rem", margin: "2px 0" }}>{day.emoji}</span>
                <span style={{
                  fontSize: "0.8rem",
                  fontWeight: "700",
                  color: scoreColor,
                  background: "rgba(0,0,0,0.2)",
                  padding: "2px 6px",
                  borderRadius: "4px",
                  minWidth: "40px"
                }}>
                  {day.avgScore}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* BEST DEPARTURE WINDOWS PANEL */}
      {(bestMorning || bestEvening) && (
        <div className="glass-panel" style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: "16px",
          padding: "16px"
        }}>
          {bestMorning && (
            <div className="glass-card" style={{ display: "flex", alignItems: "flex-start", gap: "12px", borderLeft: "4px solid var(--emerald)" }}>
              <div style={{ fontSize: "1.8rem" }}>🌤️</div>
              <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                <span style={{ fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--slate-400)", fontWeight: "700" }}>
                  Best Morning Commute (7-10 AM)
                </span>
                <span style={{ fontSize: "1rem", fontWeight: "800", color: "white" }}>
                  {bestMorning.hourStr}
                </span>
                <span style={{ fontSize: "0.75rem", color: "var(--slate-300)", marginTop: "2px" }}>
                  Score: <strong style={{ color: bestMorning.score >= 80 ? "var(--emerald)" : "var(--amber)" }}>{bestMorning.score}/100</strong> • Duration: {bestMorning.duration} min
                </span>
              </div>
            </div>
          )}

          {bestEvening && (
            <div className="glass-card" style={{ display: "flex", alignItems: "flex-start", gap: "12px", borderLeft: "4px solid var(--primary)" }}>
              <div style={{ fontSize: "1.8rem" }}>🌇</div>
              <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                <span style={{ fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--slate-400)", fontWeight: "700" }}>
                  Best Evening Commute (4-7 PM)
                </span>
                <span style={{ fontSize: "1rem", fontWeight: "800", color: "white" }}>
                  {bestEvening.hourStr}
                </span>
                <span style={{ fontSize: "0.75rem", color: "var(--slate-300)", marginTop: "2px" }}>
                  Score: <strong style={{ color: bestEvening.score >= 80 ? "var(--emerald)" : "var(--amber)" }}>{bestEvening.score}/100</strong> • Duration: {bestEvening.duration} min
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 24-HOUR HOURLY TIMELINE */}
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ fontSize: "1.1rem", fontWeight: "700", display: "flex", alignItems: "center", gap: "8px" }}>
            <Clock size={18} style={{ color: "var(--primary)" }} /> Hourly Forecast ({dailyAverages[selectedDay]?.fullName})
          </h3>
          <span style={{ fontSize: "0.75rem", color: "var(--slate-500)" }}>Select an hour to see route weather details</span>
        </div>

        <div style={{
          display: "flex",
          flexDirection: "column",
          gap: "8px",
          maxHeight: "350px",
          overflowY: "auto",
          paddingRight: "6px",
          border: "1px solid var(--card-border)",
          borderRadius: "12px",
          background: "rgba(10,15,30,0.4)",
          padding: "10px"
        }}>
          {hourlyForecastsForDay.map((hour) => {
            const isHourActive = selectedHour === hour.hourIndexInDay;
            let barColor = "var(--rose)";
            if (hour.score >= 80) barColor = "var(--emerald)";
            else if (hour.score >= 50) barColor = "var(--amber)";

            return (
              <div
                key={hour.hourIndexInDay}
                onClick={() => setSelectedHour(hour.hourIndexInDay)}
                style={{
                  display: "grid",
                  gridTemplateColumns: "60px 40px 60px 80px 100px 1fr",
                  alignItems: "center",
                  padding: "10px 12px",
                  borderRadius: "8px",
                  cursor: "pointer",
                  background: isHourActive ? "rgba(99,102,241,0.12)" : "rgba(15,23,42,0.2)",
                  border: isHourActive ? "1px solid rgba(99,102,241,0.4)" : "1px solid transparent",
                  transition: "all 0.15s ease-in-out",
                  fontSize: "0.85rem",
                  gap: "10px",
                  textAlign: "left"
                }}
                onMouseEnter={(e) => !isHourActive && (e.currentTarget.style.background = "rgba(255,255,255,0.03)")}
                onMouseLeave={(e) => !isHourActive && (e.currentTarget.style.background = "rgba(15,23,42,0.2)")}
              >
                {/* 1. Hour Column */}
                <span style={{ fontWeight: "700", color: isHourActive ? "white" : "var(--slate-300)" }}>
                  {hour.hourStr}
                </span>

                {/* 2. Emoji Column */}
                <span style={{ fontSize: "1.2rem", textAlign: "center" }}>{hour.wmoEmoji}</span>

                {/* 3. Temp Column */}
                <span style={{ fontWeight: "600", color: "white" }}>{hour.temp.toFixed(1)}°C</span>

                {/* 4. Score Column (Badge) */}
                <div style={{ display: "flex", alignItems: "center" }}>
                  <span style={{
                    color: barColor,
                    fontWeight: "800",
                    background: "rgba(0,0,0,0.3)",
                    padding: "3px 8px",
                    borderRadius: "4px",
                    width: "55px",
                    textAlign: "center"
                  }}>
                    {hour.score}
                  </span>
                </div>

                {/* 5. Wind Column */}
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <span style={{ color: "var(--slate-400)", fontSize: "0.8rem" }}>💨 {hour.windSpeed} km/h</span>
                  <div style={{
                    width: "16px",
                    height: "16px",
                    borderRadius: "50%",
                    border: "1px solid var(--slate-500)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    transform: `rotate(${hour.windDir}deg)`,
                    transition: "transform 0.4s"
                  }}
                  title={`Wind: ${hour.windDir}°`}
                  >
                    <span style={{ fontSize: "8px", color: "var(--primary)", lineHeight: "1" }}>↑</span>
                  </div>
                </div>

                {/* 6. Travel Impact Description */}
                <div style={{
                  display: "flex",
                  justifyContent: "space-between",
                  color: "var(--slate-400)",
                  fontSize: "0.8rem",
                  width: "100%",
                  textOverflow: "ellipsis",
                  overflow: "hidden",
                  whiteSpace: "nowrap"
                }}>
                  <span>🚴 {hour.duration} min ({hour.speed} km/h)</span>
                  <span style={{
                    color: hour.headwind > 5 ? "var(--rose)" : hour.headwind < -5 ? "var(--emerald)" : "var(--slate-400)",
                    fontWeight: "600"
                  }}>
                    {hour.windImpact}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

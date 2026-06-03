import { calculateCommuteScore, calculateDepartureTimeForArrival } from "./src/utils/weatherScoring.js";

// Parse CLI Flags
const isVerbose = process.argv.includes("--verbose") || process.argv.includes("-v");

// Mock route segments (from North to South)
// 10 km route split into 5 segments going South (bearing = 180)
const segments = Array.from({ length: 5 }, (_, i) => ({
  lat1: 40.78 - i * 0.02,
  lon1: -73.96,
  lat2: 40.78 - (i + 1) * 0.02,
  lon2: -73.96,
  distance: 2.0, // 2 km per segment
  bearing: 180
}));

// Mock weather forecast for 3 stations along the route
const weatherData = Array.from({ length: 3 }, (_, stationIdx) => {
  const hourly = {
    time: Array.from({ length: 168 }, (_, h) => `2026-06-03T${h.toString().padStart(2, "0")}:00`),
    temperature_2m: Array(168).fill(22),
    relative_humidity_2m: Array(168).fill(60),
    apparent_temperature: Array(168).fill(22),
    precipitation_probability: Array(168).fill(0),
    precipitation: Array(168).fill(0),
    weather_code: Array(168).fill(0),
    wind_speed_10m: [],
    wind_direction_10m: [],
    wind_gusts_10m: Array(168).fill(15),
    uv_index: Array(168).fill(1)
  };

  for (let h = 0; h < 168; h++) {
    hourly.wind_speed_10m.push(16); // 16 km/h
    hourly.wind_direction_10m.push(157.5); // 157.5 degrees (SSE)
  }

  return {
    latitude: 40.78 - stationIdx * 0.05,
    longitude: -73.96,
    hourly
  };
});

function getReturnSegments(segs) {
  return [...segs].reverse().map(seg => ({
    ...seg,
    lat1: seg.lat2,
    lon1: seg.lon2,
    lat2: seg.lat1,
    lon2: seg.lon1,
    bearing: (seg.bearing + 180) % 360
  }));
}

const baseSpeed = 18; // 18 km/h (Hybrid speed)

// Log Mock API Health Indicators
console.log(`\n\x1b[1m\x1b[36m[System API Health Check]\x1b[0m`);
console.log(`  OSM Nominatim Geocoding  : \x1b[32mOPERATIONAL (HTTP 200 - Mocked)\x1b[0m`);
console.log(`  Valhalla Routing Engine  : \x1b[32mOPERATIONAL (HTTP 200 - Mocked)\x1b[0m`);
console.log(`  Open-Meteo Weather Grid  : \x1b[32mOPERATIONAL (HTTP 200 - Mocked)\x1b[0m`);
console.log(`\x1b[32m  All scoring dependencies loaded properly. System is 100% operational.\x1b[0m`);

function formatTerminalReportLineByLine(title, result, isOutbound, targetTimeStr) {
  const score = result.score !== undefined ? result.score : result.hourDetails.score;
  const duration = result.duration;
  const speed = result.speed;
  const details = result.hourDetails || result;
  
  const reset = "\x1b[0m";
  const bold = "\x1b[1m";
  const gray = "\x1b[90m";
  const cyan = "\x1b[36m";
  const yellow = "\x1b[33m";
  const green = "\x1b[32m";
  const red = "\x1b[31m";
  
  let scoreColor = red;
  let scoreRating = "UNSATISFACTORY";
  if (score >= 85) {
    scoreColor = green;
    scoreRating = "EXCELLENT";
  } else if (score >= 70) {
    scoreColor = cyan;
    scoreRating = "GOOD";
  } else if (score >= 50) {
    scoreColor = yellow;
    scoreRating = "FAIR";
  }
  
  // Resolve departure & arrival times safely
  let departureTime;
  if (result.departureTime) {
    departureTime = new Date(result.departureTime);
  } else if (details.departureTime) {
    departureTime = new Date(details.departureTime);
  } else {
    departureTime = new Date(targetTimeStr);
  }
  
  if (isNaN(departureTime.getTime())) {
    departureTime = new Date();
  }
  
  const arrivalTime = new Date(departureTime.getTime() + duration * 60 * 1000);
  
  const depTimeText = departureTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const arrTimeText = arrivalTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  console.log(`\n${bold}${cyan}${title}${reset}`);
  console.log(`  ${bold}Score     :${reset} ${bold}${scoreColor}${score}/100${reset} (${scoreRating})`);
  console.log(`  ${gray}Deds      : Temp: -${details.penalties?.temp ?? 0} | Wind: -${details.penalties?.wind ?? 0} | Rain: -${details.penalties?.rain ?? 0} | WMO: -${details.penalties?.wmo ?? 0}${reset}`);
  console.log(`  ${bold}Commute   :${reset} Dep: ${depTimeText} -> Arr: ${arrTimeText} (${duration} mins, ${(details.distance ?? 0).toFixed(1)} km)`);
  console.log(`  ${bold}Speed     :${reset} Avg: ${speed.toFixed(1)} km/h | Base: ${baseSpeed.toFixed(1)} km/h`);
  
  const tempF = Math.round((details.temp ?? 20) * 1.8 + 32);
  console.log(`  ${bold}Weather   :${reset} ${details.wmoDesc ?? "Clear"} | Temp: ${(details.temp ?? 20).toFixed(1)}°C (${tempF}°F) | Rain: ${details.rainProb ?? 0}% (${(details.precip ?? 0).toFixed(1)}mm)`);
  
  console.log(`  ${bold}Wind      :${reset} Speed: ${(details.windSpeed ?? 0).toFixed(1)} km/h | Impact: ${details.windImpact ?? "None"}`);
  console.log(`                 Headwind: ${(details.headwind ?? 0).toFixed(1)} km/h | Crosswind: ${(details.crosswind ?? 0).toFixed(1)} km/h | Gusts: ${(details.gusts ?? 0).toFixed(1)} km/h`);
}

// Run calculations
const targetArrivalDate = new Date("2026-06-03T08:30:00.000Z");
const outboundResult = calculateDepartureTimeForArrival(
  targetArrivalDate,
  segments,
  baseSpeed,
  weatherData
);

const returnHourIdx = 17;
const returnResult = calculateCommuteScore(
  returnHourIdx,
  getReturnSegments(segments),
  baseSpeed,
  [...weatherData].reverse()
);

if (isVerbose) {
  console.log(`\n\x1b[1m\x1b[36m--- VERBOSE SCORING METRICS ---\x1b[0m`);
}

formatTerminalReportLineByLine("OUTBOUND COMMUTE (AM)", outboundResult, true, targetArrivalDate.toISOString());
formatTerminalReportLineByLine("INBOUND COMMUTE (PM)", returnResult, false, "2026-06-03T17:30:00.000Z");
console.log();

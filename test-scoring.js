import { calculateCommuteScore, calculateDepartureTimeForArrival } from "./src/utils/weatherScoring.js";

// Parse CLI Flags
const isVerbose = process.argv.includes("--verbose") || process.argv.includes("-v") || process.env.VERBOSE === "true";
const isImperial = process.argv.includes("--imperial") || process.argv.includes("-i") || process.env.IMPERIAL_LOGS === "true";

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
  
  const depTimeText = departureTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: isImperial });
  const arrTimeText = arrivalTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: isImperial });

  const displayDist = isImperial ? `${((details.distance ?? 0) * 0.621371).toFixed(1)} miles` : `${(details.distance ?? 0).toFixed(1)} km`;
  const displaySpeedAvg = isImperial ? `${(speed * 0.621371).toFixed(1)} mph` : `${speed.toFixed(1)} km/h`;
  const displaySpeedBase = isImperial ? `${(baseSpeed * 0.621371).toFixed(1)} mph` : `${baseSpeed.toFixed(1)} km/h`;
  
  const tempVal = details.temp ?? 20;
  const displayTemp = isImperial ? `${(tempVal * 1.8 + 32).toFixed(1)}°F` : `${tempVal.toFixed(1)}°C`;
  
  const precipVal = details.precip ?? 0;
  const displayPrecip = isImperial ? `${(precipVal * 0.0393701).toFixed(3)} in` : `${precipVal.toFixed(1)} mm`;
  
  const windSpeedVal = details.windSpeed ?? 0;
  const displayWindSpeed = isImperial ? `${(windSpeedVal * 0.621371).toFixed(1)} mph` : `${windSpeedVal.toFixed(1)} km/h`;
  
  const headwindVal = details.headwind ?? 0;
  const crosswindVal = details.crosswind ?? 0;
  const gustsVal = details.gusts ?? 0;
  const displayHeadwind = isImperial ? `${(headwindVal * 0.621371).toFixed(1)} mph` : `${headwindVal.toFixed(1)} km/h`;
  const displayCrosswind = isImperial ? `${(crosswindVal * 0.621371).toFixed(1)} mph` : `${crosswindVal.toFixed(1)} km/h`;
  const displayGusts = isImperial ? `${(gustsVal * 0.621371).toFixed(1)} mph` : `${gustsVal.toFixed(1)} km/h`;

  console.log(`\n${bold}${cyan}${title}${reset}`);
  console.log(`  ${bold}Score     :${reset} ${bold}${scoreColor}${score}/100${reset} (${scoreRating})`);
  if (isVerbose) {
    console.log(`  ${gray}Deds      : Temp: -${details.penalties?.temp ?? 0} | Wind: -${details.penalties?.wind ?? 0} | Rain: -${details.penalties?.rain ?? 0} | WMO: -${details.penalties?.wmo ?? 0}${reset}`);
  }
  console.log(`  ${bold}Commute   :${reset} Dep: ${depTimeText} -> Arr: ${arrTimeText} (${duration} mins, ${displayDist})`);
  console.log(`  ${bold}Speed     :${reset} Avg: ${displaySpeedAvg} | Base: ${displaySpeedBase}`);
  console.log(`  ${bold}Weather   :${reset} ${details.wmoDesc ?? "Clear"} | Temp: ${displayTemp} | Rain: ${details.rainProb ?? 0}% (${displayPrecip})`);
  if (isVerbose) {
    console.log(`  ${bold}Wind      :${reset} Speed: ${displayWindSpeed} | Impact: ${details.windImpact ?? "None"}`);
    console.log(`                 Headwind: ${displayHeadwind} | Crosswind: ${displayCrosswind} | Gusts: ${displayGusts}`);
  }
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

// Hill calculations verification check
const hillSegments = segments.map((seg, idx) => ({
  ...seg,
  ele1: idx * 50, // climb 50m per segment (total 250m climb)
  ele2: (idx + 1) * 50,
  grade: 50 / 2000 // 2.5% grade (rise of 50m / run of 2000m)
}));

const hillOutboundResult = calculateDepartureTimeForArrival(
  targetArrivalDate,
  hillSegments,
  baseSpeed,
  weatherData
);

console.log("\n\x1b[1m\x1b[36m--- HILL/ELEVATION VERIFICATION CHECK ---\x1b[0m");
console.log(`  Flat route duration : ${outboundResult.duration} mins (Avg speed: ${outboundResult.speed} km/h)`);
console.log(`  Hilly route duration: ${hillOutboundResult.duration} mins (Avg speed: ${hillOutboundResult.speed} km/h)`);
console.log(`  Flat route score    : ${outboundResult.score}/100`);
console.log(`  Hilly route score   : ${hillOutboundResult.score}/100 (Hills Penalty: -${hillOutboundResult.hourDetails?.penalties?.hills || 0} pts)`);

if (hillOutboundResult.duration > outboundResult.duration && hillOutboundResult.score < outboundResult.score) {
  console.log("  \x1b[32m✔ Success: Hilly route correctly slows down speed and reduces commute score suitability!\x1b[0m");
} else {
  console.log("  \x1b[31m✘ Failure: Hilly route duration did not increase or score penalty did not apply!\x1b[0m");
}
console.log();

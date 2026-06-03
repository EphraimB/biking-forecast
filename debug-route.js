import { calculateCommuteScore, calculateDepartureTimeForArrival } from "./src/utils/weatherScoring.js";
import { decodePolyline6, calculateRouteSegments } from "./src/utils/routeUtils.js";

// Parse CLI Flags
const isVerbose = process.argv.includes("--verbose") || process.argv.includes("-v") || process.env.VERBOSE === "true";
const isImperial = process.argv.includes("--imperial") || process.argv.includes("-i") || process.env.IMPERIAL_LOGS === "true";
const isMock = process.argv.includes("--mock") || process.argv.includes("-m") || process.env.MOCK === "true";

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

async function fetchBicycleRoute(startLat, startLon, endLat, endLon) {
  const valhallaRequest = {
    locations: [
      { lat: startLat, lon: startLon, type: "break" },
      { lat: endLat, lon: endLon, type: "break" }
    ],
    costing: "bicycle",
    costing_options: {
      bicycle: {
        bicycle_type: "Hybrid",
        cycling_speed: 18,
        use_roads: 0.15,
        use_hills: 0.4
      }
    },
    units: "km"
  };

  const url = `https://valhalla1.openstreetmap.de/route?json=${encodeURIComponent(
    JSON.stringify(valhallaRequest)
  )}`;

  const response = await fetch(url, { headers: { "X-Client-Id": "BikingForecastApp" } });
  if (!response.ok) {
    throw new Error(`HTTP error ${response.status}`);
  }
  const data = await response.json();
  return {
    shape: data.trip.legs[0].shape,
    distance: data.trip.summary.length,
    time: data.trip.summary.time
  };
}

async function fetchRouteWeather(routeCoordinates, totalDistance) {
  // Let's sample 3 points (Start, Mid, End) since distance is ~5km
  const sampledPoints = [
    routeCoordinates[0],
    routeCoordinates[Math.floor(routeCoordinates.length / 2)],
    routeCoordinates[routeCoordinates.length - 1]
  ];
  const lats = sampledPoints.map(p => p[0]).join(",");
  const lons = sampledPoints.map(p => p[1]).join(",");
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}&hourly=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation_probability,precipitation,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m,uv_index&timezone=auto`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP error ${response.status}`);
  }
  const data = await response.json();
  return Array.isArray(data) ? data : [data];
}

const baseSpeed = 18;

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

async function run() {
  const start = { lat: 40.7064, lon: -73.6187, label: "Hempstead, NY" };
  const end = { lat: 40.7208, lon: -73.6425, label: "Adelphi University, Garden City, NY" };

  console.log(`\n\x1b[1m\x1b[36m[System API Health Check]\x1b[0m`);
  
  let route, coords, segments, weather;
  if (isMock) {
    console.log(`  Valhalla Routing Engine  : \x1b[32mOPERATIONAL (HTTP 200 - Mocked)\x1b[0m`);
    console.log(`  Open-Meteo Weather Grid  : \x1b[32mOPERATIONAL (HTTP 200 - Mocked)\x1b[0m`);
    console.log(`\x1b[32m  All scoring dependencies loaded properly. System is 100% operational. (Mocked Mode)\x1b[0m\n`);
    
    route = { distance: 10.0, time: 2000 };
    coords = [ [40.78, -73.96], [40.68, -73.96] ];
    segments = Array.from({ length: 5 }, (_, i) => ({
      lat1: 40.78 - i * 0.02,
      lon1: -73.96,
      lat2: 40.78 - (i + 1) * 0.02,
      lon2: -73.96,
      distance: 2.0,
      bearing: 180
    }));
    
    const tomorrowStr = new Date(Date.now() + 86400000).toISOString().split("T")[0];
    weather = Array.from({ length: 3 }, (_, stationIdx) => {
      const hourly = {
        time: Array.from({ length: 168 }, (_, h) => `${tomorrowStr}T${h.toString().padStart(2, "0")}:00`),
        temperature_2m: Array(168).fill(22),
        relative_humidity_2m: Array(168).fill(60),
        apparent_temperature: Array(168).fill(22),
        precipitation_probability: Array(168).fill(0),
        precipitation: Array(168).fill(0),
        weather_code: Array(168).fill(0),
        wind_speed_10m: Array(168).fill(16),
        wind_direction_10m: Array(168).fill(157.5),
        wind_gusts_10m: Array(168).fill(15),
        uv_index: Array(168).fill(1)
      };
      return {
        latitude: 40.78 - stationIdx * 0.05,
        longitude: -73.96,
        hourly
      };
    });
  } else {
    try {
      route = await fetchBicycleRoute(start.lat, start.lon, end.lat, end.lon);
      coords = decodePolyline6(route.shape);
      segments = calculateRouteSegments(coords);
      console.log(`  Valhalla Routing Engine  : \x1b[32mOPERATIONAL (HTTP 200)\x1b[0m`);
    } catch (err) {
      console.log(`  Valhalla Routing Engine  : \x1b[31mFAILED (${err.message})\x1b[0m`);
      throw err;
    }

    try {
      weather = await fetchRouteWeather(coords, route.distance);
      console.log(`  Open-Meteo Weather Grid  : \x1b[32mOPERATIONAL (HTTP 200)\x1b[0m`);
    } catch (err) {
      console.log(`  Open-Meteo Weather Grid  : \x1b[31mFAILED (${err.message})\x1b[0m`);
      throw err;
    }

    console.log(`\x1b[32m  All scoring dependencies loaded properly. System is 100% operational.\x1b[0m\n`);
  }

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);

  // Outbound: Wednesday 8:30 AM (Wednesday target arrival)
  const outboundTarget = new Date(tomorrow);
  outboundTarget.setHours(8, 30, 0, 0);

  // Inbound: Wednesday 4:15 PM (Wednesday leave at)
  const inboundTarget = new Date(tomorrow);
  inboundTarget.setHours(16, 15, 0, 0);

  // OUTBOUND
  const outboundResult = calculateDepartureTimeForArrival(
    outboundTarget,
    segments,
    baseSpeed,
    weather
  );

  // INBOUND
  const firstHourlyTimeStr = weather[0]?.hourly?.time?.[0];
  const forecastStart = new Date(firstHourlyTimeStr);
  const diffMs = inboundTarget - forecastStart;
  const returnHourIdx = Math.max(0, Math.min(167, Math.floor(diffMs / (1000 * 60 * 60))));

  const returnResult = calculateCommuteScore(
    returnHourIdx,
    getReturnSegments(segments),
    baseSpeed,
    [...weather].reverse()
  );

  if (isVerbose) {
    console.log(`Route distance: ${route.distance.toFixed(2)} km. Segments count: ${segments.length}`);
    formatTerminalReportLineByLine(`OUTBOUND LIVE COMMUTE (AM) - ${start.label} -> ${end.label}`, outboundResult, true, outboundTarget.toISOString());
    formatTerminalReportLineByLine(`INBOUND LIVE COMMUTE (PM) - ${end.label} -> ${start.label}`, returnResult, false, inboundTarget.toISOString());
  } else {
    formatTerminalReportLineByLine(`${start.label.split(",")[0]} -> ${end.label.split(",")[0]} (AM Outbound)`, outboundResult, true, outboundTarget.toISOString());
    formatTerminalReportLineByLine(`${end.label.split(",")[0]} -> ${start.label.split(",")[0]} (PM Inbound)`, returnResult, false, inboundTarget.toISOString());
  }
  console.log();
}

run().catch(console.error);

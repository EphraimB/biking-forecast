const { calculateCommuteScore, calculateDepartureTimeForArrival } = require("./src/utils/weatherScoring.js");

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

  // Generate wind speed and direction:
  // Strong SSE wind (coming from 157.5 degrees, i.e. blowing North-North-West)
  // Let's make wind speed 16 km/h (10 mph) at both AM (8 AM, index 8) and PM (5 PM, index 17)
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

console.log("=== OUTBOUND (AM) ===");
// Desired arrival at 8:30 AM (hour index 8 of Wednesday)
const targetArrivalDate = new Date("2026-06-03T08:30:00");
const outboundResult = calculateDepartureTimeForArrival(
  targetArrivalDate,
  segments,
  baseSpeed,
  weatherData
);
console.log("Outbound Duration:", outboundResult.duration, "minutes");
console.log("Outbound Departure Time:", outboundResult.departureTime.toISOString());
console.log("Outbound Avg Speed:", outboundResult.speed, "km/h");
console.log("Outbound Avg Headwind:", outboundResult.hourDetails.headwind, "km/h");

console.log("\n=== INBOUND (PM) ===");
// Departure at 5:30 PM (hour index 17)
const returnHourIdx = 17;
const returnResult = calculateCommuteScore(
  returnHourIdx,
  getReturnSegments(segments),
  baseSpeed,
  [...weatherData].reverse()
);
console.log("Inbound Duration:", returnResult.duration, "minutes");
console.log("Inbound Avg Speed:", returnResult.speed, "km/h");
console.log("Inbound Avg Headwind:", returnResult.headwind, "km/h (Tailwind if negative)");

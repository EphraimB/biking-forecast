import { calculateCommuteScore, calculateDepartureTimeForArrival } from "./src/utils/weatherScoring.js";
import { decodePolyline6, calculateRouteSegments } from "./src/utils/routeUtils.js";

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
  const data = await response.json();
  return Array.isArray(data) ? data : [data];
}

async function run() {
  const start = { lat: 40.7064, lon: -73.6187, label: "Hempstead, NY" };
  const end = { lat: 40.7208, lon: -73.6425, label: "Adelphi University, Garden City, NY" };

  console.log("Fetching route...");
  const route = await fetchBicycleRoute(start.lat, start.lon, end.lat, end.lon);
  const coords = decodePolyline6(route.shape);
  const segments = calculateRouteSegments(coords);

  console.log(`Route distance: ${route.distance.toFixed(2)} km. Segments count: ${segments.length}`);

  console.log("Fetching weather...");
  const weather = await fetchRouteWeather(coords, route.distance);

  const baseSpeed = 18;
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);

  // Outbound: Wednesday 8:30 AM (Wednesday target arrival)
  const outboundTarget = new Date(tomorrow);
  outboundTarget.setHours(8, 30, 0, 0);

  // Inbound: Wednesday 4:15 PM (Wednesday leave at)
  const inboundTarget = new Date(tomorrow);
  inboundTarget.setHours(16, 15, 0, 0);

  console.log("\n--- OUTBOUND (AM) ---");
  const outboundResult = calculateDepartureTimeForArrival(
    outboundTarget,
    segments,
    baseSpeed,
    weather
  );
  console.log(`Outbound target arrival: ${outboundTarget.toLocaleTimeString()}`);
  console.log(`Outbound departure: ${outboundResult.departureTime.toLocaleTimeString()}`);
  console.log(`Outbound Duration: ${outboundResult.duration} mins`);
  console.log(`Outbound Avg Speed: ${outboundResult.speed} km/h`);
  console.log(`Outbound Avg Headwind: ${outboundResult.hourDetails.headwind} km/h`);
  console.log(`Outbound Wind speed: ${outboundResult.hourDetails.windSpeed} km/h, Wind Dir: ${outboundResult.hourDetails.windDir}°`);

  console.log("\n--- INBOUND (PM) ---");
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
  console.log(`Inbound departure: ${inboundTarget.toLocaleTimeString()}`);
  console.log(`Inbound Duration: ${returnResult.duration} mins`);
  console.log(`Inbound Avg Speed: ${returnResult.speed} km/h`);
  console.log(`Inbound Avg Headwind: ${returnResult.headwind} km/h (negative is tailwind)`);
  console.log(`Inbound Wind speed: ${returnResult.windSpeed} km/h, Wind Dir: ${returnResult.windDir}°`);
}

run().catch(console.error);

import { decodePolyline6, calculateRouteSegments } from "./src/utils/routeUtils.js";

async function fetchBicycleRoute(startLat, startLon, endLat, endLon) {
  const valhallaRequest = {
    locations: [
      { lat: startLat, lon: startLon, type: "break" },
      { lat: endLat, lon: endLon, type: "break" }
    ],
    costing: "bicycle",
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
  };
}

async function run() {
  const start = { lat: 40.7064, lon: -73.6187, label: "Hempstead, NY" };
  const end = { lat: 40.7208, lon: -73.6425, label: "Adelphi University, Garden City, NY" };

  const route = await fetchBicycleRoute(start.lat, start.lon, end.lat, end.lon);
  const coords = decodePolyline6(route.shape);
  const segments = calculateRouteSegments(coords);

  let totalDist = 0;
  let weightedBearingSum = 0;
  segments.forEach(seg => {
    totalDist += seg.distance;
    weightedBearingSum += seg.bearing * seg.distance;
  });
  console.log(`Average bearing of route: ${(weightedBearingSum / totalDist).toFixed(1)}°`);
  console.log(`Start to End bearing: ${segments[0].bearing.toFixed(1)}° to ${segments[segments.length-1].bearing.toFixed(1)}°`);
}

run().catch(console.error);

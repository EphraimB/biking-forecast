import { sampleCoordinates, getDistance } from "./routeUtils";

async function sendServerApiLog(apiName, action, params, durationMs = null, extra = null) {
  if (process.env.NODE_ENV !== "development") return;
  try {
    await fetch("/api/log-api-activity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiName, action, params, durationMs, extra })
    });
  } catch (e) {
    // Ignore logging errors silently in the UI
  }
}

export async function sendServerCommuteLog(payload) {
  if (process.env.NODE_ENV !== "development") return;
  try {
    await fetch("/api/log-commute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  } catch (e) {
    // Ignore logging errors silently in the UI
  }
}

/**
 * Searches for coordinates matching an address query using OpenStreetMap's Nominatim geocoder.
 * @param {string} query - The location query (e.g. "Brooklyn Bridge, NY")
 * @returns {Promise<Array<{lat: number, lon: number, label: string}>>} Found locations
 */
const FALLBACK_LOCATIONS = [
  { label: "Central Park, New York, NY", lat: 40.7851, lon: -73.9682 },
  { label: "Brooklyn Bridge, New York, NY", lat: 40.7061, lon: -73.9969 },
  { label: "Times Square, New York, NY", lat: 40.7580, lon: -73.9855 },
  { label: "Empire State Building, New York, NY", lat: 40.7484, lon: -73.9857 },
  { label: "Grand Central Terminal, New York, NY", lat: 40.7527, lon: -73.9772 },
  { label: "Prospect Park, Brooklyn, NY", lat: 40.6602, lon: -73.9690 },
  { label: "DUMBO, Brooklyn, NY", lat: 40.7033, lon: -73.9879 },
  { label: "Williamsburg, Brooklyn, NY", lat: 40.7081, lon: -73.9571 },
  { label: "JFK Airport, Queens, NY", lat: 40.6413, lon: -73.7781 },
  { label: "LaGuardia Airport, Queens, NY", lat: 40.7769, lon: -73.8740 },
  { label: "Wall Street, New York, NY", lat: 40.7064, lon: -74.0094 },
  { label: "Manhattan, New York, NY", lat: 40.7831, lon: -73.9712 },
  { label: "Brooklyn, New York, NY", lat: 40.6782, lon: -73.9442 },
  { label: "Queens, New York, NY", lat: 40.7282, lon: -73.7949 },
  { label: "Bronx, New York, NY", lat: 40.8448, lon: -73.8648 },
  { label: "Staten Island, New York, NY", lat: 40.5795, lon: -74.1502 },
  { label: "Golden Gate Park, San Francisco, CA", lat: 37.7694, lon: -122.4862 },
  { label: "Union Square, San Francisco, CA", lat: 37.7876, lon: -122.4074 },
  { label: "Ferry Building, San Francisco, CA", lat: 37.7954, lon: -122.3937 }
];

const ROUTE_CACHE_PREFIX = "biking_route_cache_";
const GEOCODE_CACHE_PREFIX = "biking_geocode_cache_";
const REV_GEOCODE_CACHE_PREFIX = "biking_revgeocode_cache_";

function getCachedData(prefix, key, maxAgeMs = 60 * 60 * 1000) {
  if (typeof window === "undefined") return null;
  try {
    const cached = localStorage.getItem(prefix + key);
    if (!cached) return null;
    const { timestamp, data } = JSON.parse(cached);
    if (Date.now() - timestamp < maxAgeMs) {
      return data;
    }
    localStorage.removeItem(prefix + key);
  } catch (e) {
    console.warn(`Failed to read cache for ${prefix}`, e);
  }
  return null;
}

function setCachedData(prefix, key, data) {
  if (typeof window === "undefined") return;
  try {
    const payload = {
      timestamp: Date.now(),
      data
    };
    localStorage.setItem(prefix + key, JSON.stringify(payload));
  } catch (e) {
    console.warn(`Failed to write cache for ${prefix}`, e);
  }
}

export async function geocodeAddress(query) {
  if (!query || query.trim().length < 3) return [];
  
  const normQuery = query.toLowerCase().trim();
  
  // Check cache
  const cached = getCachedData(GEOCODE_CACHE_PREFIX, normQuery);
  if (cached) {
    console.log(`📦 [Geocoding Cache] Cache hit for query: "${normQuery}"`);
    sendServerApiLog("Geocoding", "cache_hit", { query: normQuery }, null, { key: `query "${normQuery}"` });
    return cached;
  }
  
  sendServerApiLog("Geocoding", "cache_miss", { query: normQuery }, null, { key: `query "${normQuery}"` });

  // Gather matching local fallbacks
  const localMatches = FALLBACK_LOCATIONS.filter(item => 
    item.label.toLowerCase().includes(normQuery)
  );

  if (process.env.MOCK === "true") {
    console.log("Mock data mode enabled via env var. Serving offline geocoding results.");
    sendServerApiLog("Geocoding", "simulated_mode", { query: normQuery }, null, { reason: "MOCK=true" });
    return localMatches.length > 0 ? localMatches : [
      { lat: 40.7064, lon: -73.6187, label: `${query} (Mocked Start)` },
      { lat: 40.7208, lon: -73.6425, label: `${query} (Mocked Destination)` }
    ];
  }

  // Helper to merge and deduplicate
  const mergeResults = (primary, secondary) => {
    const combined = [...primary];
    secondary.forEach(item => {
      if (!combined.some(c => c.label.toLowerCase().split(",")[0] === item.label.toLowerCase().split(",")[0])) {
        combined.push(item);
      }
    });
    return combined;
  };

  // 1. Try Nominatim (Primary)
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(
      query
    )}&format=json&limit=5&addressdetails=1`;
    
    // Throttling live geocode calls to Nominatim
    await throttleFetch();
    
    sendServerApiLog("Geocoding", "network_request", { query: normQuery }, null, { target: "Nominatim", url });
    
    const startTime = Date.now();
    const response = await fetch(url);
    const duration = Date.now() - startTime;
    if (response.ok) {
      const data = await response.json();
      const nominatimResults = data.map(item => ({
        lat: parseFloat(item.lat),
        lon: parseFloat(item.lon),
        label: item.display_name
      }));
      const merged = mergeResults(nominatimResults, localMatches);
      setCachedData(GEOCODE_CACHE_PREFIX, normQuery, merged);
      
      sendServerApiLog("Geocoding", "network_success", { query: normQuery }, duration, { target: "Nominatim", status: response.status, info: `found ${nominatimResults.length} live results` });
      return merged;
    }
    sendServerApiLog("Geocoding", "network_failure", { query: normQuery }, duration, { target: "Nominatim", status: response.status, message: "Response status not OK" });
    console.warn(`Nominatim throttled: ${response.status}. Failover to Photon Komoot...`);
  } catch (error) {
    sendServerApiLog("Geocoding", "network_failure", { query: normQuery }, null, { target: "Nominatim", status: "Error", message: error.message });
    console.warn("Nominatim rate-limit ban detected. Seamless failover to Photon Komoot...");
  }

  // 2. Try Photon Komoot (Secondary Live Network Fallback)
  try {
    const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=5`;
    
    sendServerApiLog("Geocoding", "network_request", { query: normQuery }, null, { target: "Photon", url });
    
    const startTime = Date.now();
    const response = await fetch(url);
    const duration = Date.now() - startTime;
    if (response.ok) {
      const data = await response.json();
      const photonResults = (data.features || []).map(feat => {
        const coords = feat.geometry?.coordinates || [0, 0];
        const prop = feat.properties || {};
        const labelParts = [
          prop.name,
          prop.street,
          prop.city,
          prop.state,
          prop.postcode,
          prop.country
        ].filter(Boolean);
        // Deduplicate adjacent parts
        const uniqueParts = labelParts.filter((item, pos, arr) => !pos || item !== arr[pos - 1]);
        return {
          lat: coords[1], // Photon returns [lon, lat]
          lon: coords[0],
          label: uniqueParts.join(", ")
        };
      });
      const merged = mergeResults(photonResults, localMatches);
      setCachedData(GEOCODE_CACHE_PREFIX, normQuery, merged);
      
      sendServerApiLog("Geocoding", "network_success", { query: normQuery }, duration, { target: "Photon", status: response.status, info: `found ${photonResults.length} live results` });
      return merged;
    }
    sendServerApiLog("Geocoding", "network_failure", { query: normQuery }, duration, { target: "Photon", status: response.status, message: "Response status not OK" });
  } catch (error) {
    sendServerApiLog("Geocoding", "network_failure", { query: normQuery }, null, { target: "Photon", status: "Error", message: error.message });
    console.warn("Photon geocoder failed, falling back to offline landmark POIs: ", error.message);
  }

  // 3. Fallback to Local Offline POIs
  sendServerApiLog("Geocoding", "simulated_fallback", { query: normQuery }, null, { reason: "Offline POI Fallback" });
  setCachedData(GEOCODE_CACHE_PREFIX, normQuery, localMatches);
  return localMatches;
}

/**
 * Fetches a bicycle route from the public Valhalla OpenStreetMap demo instance.
 * @param {number} startLat - Start Latitude
 * @param {number} startLon - Start Longitude
 * @param {number} endLat - End Latitude
 * @param {number} endLon - End Longitude
 * @param {string} bikeType - Bike type: "Road", "Hybrid", "Cross", "Mountain"
 * @param {number} cyclingSpeed - Speed override in km/h
 * @returns {Promise<{shape: string, distance: number, time: number, legs: Array<object>}>} Valhalla trip data
 */
export async function fetchBicycleRoute(startLat, startLon, endLat, endLon, bikeType = "Hybrid", cyclingSpeed = 20) {
  const cacheKey = `${Number(startLat).toFixed(3)},${Number(startLon).toFixed(3)}_${Number(endLat).toFixed(3)},${Number(endLon).toFixed(3)}_${bikeType}_${cyclingSpeed}`;
  
  // Check cache first
  const cached = getCachedData(ROUTE_CACHE_PREFIX, cacheKey);
  if (cached) {
    console.log(`📦 [Routing Cache] Cache hit for route: ${cacheKey}`);
    sendServerApiLog("Routing", "cache_hit", { startLat, startLon, endLat, endLon, bikeType }, null, { key: `route "${cacheKey}"` });
    return cached;
  }

  sendServerApiLog("Routing", "cache_miss", { startLat, startLon, endLat, endLon, bikeType }, null, { key: `route "${cacheKey}"` });

  if (process.env.MOCK === "true") {
    console.log("Mock data mode enabled via env var. Serving offline bicycle route.");
    sendServerApiLog("Routing", "simulated_mode", { startLat, startLon, endLat, endLon, bikeType }, null, { reason: "MOCK=true" });
    const result = {
      shape: "m_r_~Ah~o]z@aCdBiF", 
      distance: 10.0,
      time: 2000,
      legs: [{ shape: "m_r_~Ah~o]z@aCdBiF" }]
    };
    return result;
  }

  try {
    const valhallaRequest = {
      locations: [
        { lat: startLat, lon: startLon, type: "break" },
        { lat: endLat, lon: endLon, type: "break" }
      ],
      costing: "bicycle",
      costing_options: {
        bicycle: {
          bicycle_type: bikeType, // "Road", "Hybrid", "Cross", "Mountain"
          cycling_speed: cyclingSpeed,
          use_roads: bikeType === "Road" ? 0.35 : 0.15, // prefer cycleways more for hybrid/mountain
          use_hills: bikeType === "Mountain" ? 0.8 : 0.4
        }
      },
      units: "km"
    };

    const url = `https://valhalla1.openstreetmap.de/route?json=${encodeURIComponent(
      JSON.stringify(valhallaRequest)
    )}`;

    // Throttling route network calls to Valhalla
    await throttleFetch();

    sendServerApiLog("Routing", "network_request", { startLat, startLon, endLat, endLon, bikeType }, null, { target: "Valhalla", url });

    const startTime = Date.now();
    const response = await fetch(url, {
      headers: {
        // Proactively set a customer identifier for fair-use tracking
        "X-Client-Id": "BikingForecastApp"
      }
    });
    const duration = Date.now() - startTime;

    if (!response.ok) {
      const errText = await response.text();
      sendServerApiLog("Routing", "network_failure", { startLat, startLon, endLat, endLon, bikeType }, duration, { target: "Valhalla", status: response.status, message: errText });
      throw new Error(`Valhalla Routing Error: ${response.status} - ${errText}`);
    }

    const data = await response.json();
    
    if (!data.trip || !data.trip.legs || data.trip.legs.length === 0) {
      sendServerApiLog("Routing", "network_failure", { startLat, startLon, endLat, endLon, bikeType }, duration, { target: "Valhalla", status: response.status, message: "No route legs found in response" });
      throw new Error("No route found between selected points.");
    }

    const result = {
      shape: data.trip.legs[0].shape, // Encoded polyline6
      distance: data.trip.summary.length, // in km
      time: data.trip.summary.time, // in seconds
      legs: data.trip.legs
    };

    sendServerApiLog("Routing", "network_success", { startLat, startLon, endLat, endLon, bikeType }, duration, { target: "Valhalla", status: response.status, info: `distance ${result.distance.toFixed(1)} km, duration ${Math.round(result.time / 60)} mins` });
    setCachedData(ROUTE_CACHE_PREFIX, cacheKey, result);
    return result;
  } catch (error) {
    console.error("Valhalla route fetch failed:", error);
    sendServerApiLog("Routing", "network_failure", { startLat, startLon, endLat, endLon, bikeType }, null, { target: "Valhalla", status: "Error", message: error.message });
    throw error;
  }
}

/**
 * Generates a realistic mock hourly weather forecast for offline or rate-limited execution.
 */
function generateMockWeather(lat, lon) {
  const hourly = {
    time: [],
    temperature_2m: [],
    relative_humidity_2m: [],
    apparent_temperature: [],
    precipitation_probability: [],
    precipitation: [],
    weather_code: [],
    wind_speed_10m: [],
    wind_direction_10m: [],
    wind_gusts_10m: [],
    uv_index: []
  };

  const now = new Date();
  now.setHours(0, 0, 0, 0); // Start of today

  for (let h = 0; h < 168; h++) {
    const timeStr = new Date(now.getTime() + h * 60 * 60 * 1000).toISOString().slice(0, 16);
    hourly.time.push(timeStr);

    const hourOfDay = h % 24;
    // Temperature cycle: low of 16 at 4 AM, high of 26 at 4 PM
    const angle = ((hourOfDay - 4) * Math.PI) / 12;
    const temp = 21 + 5 * Math.sin(angle) + (Math.random() - 0.5) * 1.5;
    hourly.temperature_2m.push(temp);
    hourly.apparent_temperature.push(temp + (Math.random() - 0.5) * 1);

    // Relative humidity
    const humidity = 60 - 20 * Math.sin(angle) + Math.random() * 10;
    hourly.relative_humidity_2m.push(Math.max(10, Math.min(100, humidity)));

    // Rain probability
    const isDay3 = h >= 48 && h < 72;
    const rainProb = isDay3 ? 45 + Math.random() * 20 : 5 + Math.random() * 10;
    hourly.precipitation_probability.push(Math.round(rainProb));
    hourly.precipitation.push(rainProb > 50 ? (Math.random() * 1.2) : 0);

    // Weather code (WMO)
    let code = 0;
    if (rainProb > 50) code = 61;
    else if (rainProb > 30) code = 3;
    else if (rainProb > 15) code = 1;
    hourly.weather_code.push(code);

    // Wind speed
    const windSpeed = 12 + 6 * Math.sin(((hourOfDay - 8) * Math.PI) / 12) + Math.random() * 4;
    hourly.wind_speed_10m.push(windSpeed);
    hourly.wind_gusts_10m.push(windSpeed * 1.3);

    // Wind direction
    hourly.wind_direction_10m.push(180 + (Math.random() - 0.5) * 45);

    // UV Index
    let uv = 0;
    if (hourOfDay >= 6 && hourOfDay <= 18) {
      const uvAngle = ((hourOfDay - 6) * Math.PI) / 12;
      uv = 7 * Math.sin(uvAngle);
      if (code >= 3) uv *= 0.4;
    }
    hourly.uv_index.push(Math.round(uv * 10) / 10);
  }

  return {
    latitude: lat,
    longitude: lon,
    timezone: "GMT",
    hourly
  };
}
const CACHE_PREFIX = "biking_weather_cache_";
let lastFetchTime = 0;
const MIN_FETCH_INTERVAL_MS = 1000;

function getCacheKey(coords) {
  return coords.map(c => `${Number(c[0]).toFixed(3)},${Number(c[1]).toFixed(3)}`).join("|");
}

function getCachedWeatherData(key) {
  if (typeof window === "undefined") return null;
  try {
    const cached = localStorage.getItem(CACHE_PREFIX + key);
    if (!cached) return null;
    const { timestamp, data } = JSON.parse(cached);
    
    // Check if cache is older than 60 minutes
    const ageMs = Date.now() - timestamp;
    if (ageMs < 60 * 60 * 1000) {
      console.log(`📦 [Weather Cache] Cache hit for key: ${key.substring(0, 45)}...`);
      return data;
    } else {
      localStorage.removeItem(CACHE_PREFIX + key);
    }
  } catch (e) {
    console.warn("Failed to read from weather localStorage cache", e);
  }
  return null;
}

function setCachedWeatherData(key, data) {
  if (typeof window === "undefined") return;
  try {
    if (data.isOfflineForecast) return; // Skip caching offline fallbacks

    const payload = {
      timestamp: Date.now(),
      data
    };
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(payload));
    console.log(`📦 [Weather Cache] Cached weather for key: ${key.substring(0, 45)}...`);
  } catch (e) {
    console.warn("Failed to write to weather localStorage cache", e);
  }
}

async function throttleFetch() {
  const now = Date.now();
  const timeSinceLastFetch = now - lastFetchTime;
  if (timeSinceLastFetch < MIN_FETCH_INTERVAL_MS) {
    const delay = MIN_FETCH_INTERVAL_MS - timeSinceLastFetch;
    console.log(`⏳ [Weather Rate Limiting] Throttling request by ${delay}ms...`);
    await new Promise(resolve => setTimeout(resolve, delay));
  }
  lastFetchTime = Date.now();
}

const inflightWeatherRequests = new Map();

/**
 * Fetches hourly weather forecasts from Open-Meteo for coordinates along a route.
 * Selects 2 to 5 points depending on the route's total distance.
 * @param {Array<[number, number]>} routeCoordinates - Array of [lat, lon] route coordinates
 * @param {number} totalDistance - Total distance in km
 * @param {boolean} forceRefresh - If true, bypasses the cache
 * @returns {Promise<Array<object>>} Array of Open-Meteo weather response objects
 */
export async function fetchRouteWeather(routeCoordinates, totalDistance, forceRefresh = false) {
  if (!routeCoordinates || routeCoordinates.length === 0) return [];
  
  // Step 1: Decide sample density based on distance
  let numSamples = 3;
  if (totalDistance < 10) {
    numSamples = 2; // Start, End
  } else if (totalDistance < 30) {
    numSamples = 3; // Start, Mid, End
  } else if (totalDistance < 75) {
    numSamples = 4; // Start, 1/3, 2/3, End
  } else {
    numSamples = 5; // Start, 1/4, 1/2, 3/4, End
  }
  
  const sampledPoints = sampleCoordinates(routeCoordinates, numSamples);
  const cacheKey = getCacheKey(sampledPoints);

  if (process.env.MOCK === "true") {
    console.log("Mock data mode enabled via env var. Serving offline weather forecast.");
    sendServerApiLog("Weather", "simulated_mode", { totalDistance, numSamples }, null, { reason: "MOCK=true" });
    const mockData = sampledPoints.map(p => generateMockWeather(p[0], p[1]));
    mockData.isOfflineForecast = true;
    return mockData;
  }

  // Check cache first (if not forcing refresh)
  if (!forceRefresh) {
    const cached = getCachedWeatherData(cacheKey);
    if (cached) {
      sendServerApiLog("Weather", "cache_hit", { totalDistance, numSamples }, null, { key: `sampled key: ${cacheKey.substring(0, 30)}...` });
      return cached;
    }
  }

  // Check if there is an active in-flight request for these exact coordinates
  if (!forceRefresh && inflightWeatherRequests.has(cacheKey)) {
    console.log(`♻️ [Weather Request Deduplication] Reusing in-flight request for key: ${cacheKey.substring(0, 30)}...`);
    return inflightWeatherRequests.get(cacheKey);
  }

  const promise = (async () => {
    sendServerApiLog("Weather", "cache_miss", { totalDistance, numSamples }, null, { key: `sampled key: ${cacheKey.substring(0, 30)}...` });

    // Check if a 429 rate limit cooldown is active in localStorage
    if (typeof window !== "undefined") {
      const cooldownUntil = localStorage.getItem("weather_429_cooldown_until");
      if (cooldownUntil && Number(cooldownUntil) > Date.now()) {
        const remainingSec = Math.ceil((Number(cooldownUntil) - Date.now()) / 1000);
        console.log("🛑 [Weather API] Cooldown active. Skipping network fetch and serving offline forecast.");
        sendServerApiLog("Weather", "cooldown_active", { totalDistance }, null, { remaining: `${remainingSec}s` });
        const mockData = sampledPoints.map(p => generateMockWeather(p[0], p[1]));
        mockData.isOfflineForecast = true;
        mockData.errorType = "429";
        mockData.cooldownUntil = Number(cooldownUntil);
        mockData.errorMessage = "API Rate Limit Cooldown Active";
        return mockData;
      }
    }
    
    try {
      // Throttling actual network calls to limit requests to Open-Meteo
      await throttleFetch();

      const lats = sampledPoints.map(p => p[0]).join(",");
      const lons = sampledPoints.map(p => p[1]).join(",");
      
      // Request WMO weather codes, temp, humidity, precipitation probability, wind speed, wind direction, wind gusts
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}&hourly=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation_probability,precipitation,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m,uv_index&timezone=auto`;
      
      console.log(`🌐 [Open-Meteo API] Fetching weather forecast for ${numSamples} coordinates:`, sampledPoints);
      console.log(`🔗 [Open-Meteo API] Request URL: ${url}`);

      sendServerApiLog("Weather", "network_request", { totalDistance, numSamples }, null, { target: "Open-Meteo", url });

      const startTime = Date.now();
      const response = await fetch(url);
      const duration = Date.now() - startTime;
      
      if (!response.ok) {
        if (response.status === 429) {
          sendServerApiLog("Weather", "rate_limited", { totalDistance, numSamples }, duration, { target: "Open-Meteo", status: 429 });
        } else {
          sendServerApiLog("Weather", "network_failure", { totalDistance, numSamples }, duration, { target: "Open-Meteo", status: response.status, message: "Response status not OK" });
        }
        throw new Error(`Open-Meteo error: ${response.status} - ${response.statusText}`);
      }
      
      const data = await response.json();
      
      // Ensure it's returned as an array, as Open-Meteo returns a single object if there's only 1 coordinate requested
      // but an array of objects if multiple points are requested.
      const weatherArray = Array.isArray(data) ? data : [data];
      
      // Cache the response
      setCachedWeatherData(cacheKey, weatherArray);

      // Dynamically match the current hour to print relevant console log metrics
      const now = new Date();
      const year = now.getFullYear();
      const month = (now.getMonth() + 1).toString().padStart(2, "0");
      const date = now.getDate().toString().padStart(2, "0");
      const hour = now.getHours().toString().padStart(2, "0");
      const currentHourStr = `${year}-${month}-${date}T${hour}:00`;
      
      let currentHourIdx = weatherArray[0]?.hourly?.time?.indexOf(currentHourStr);
      if (currentHourIdx === -1 || currentHourIdx === undefined) {
        currentHourIdx = now.getHours(); // Fallback to current local hour index
      }
      
      const tempDisp = `${weatherArray[0]?.hourly?.temperature_2m?.[currentHourIdx]}°C`;
      console.log(`✅ [Open-Meteo API] Successfully retrieved weather data for ${weatherArray.length} point(s). Sampled current hour (${currentHourStr}) metrics:`, {
        temp: tempDisp,
        humidity: `${weatherArray[0]?.hourly?.relative_humidity_2m?.[currentHourIdx]}%`,
        windSpeed: `${weatherArray[0]?.hourly?.wind_speed_10m?.[currentHourIdx]} km/h`,
        windDir: `${weatherArray[0]?.hourly?.wind_direction_10m?.[currentHourIdx]}°`
      });

      sendServerApiLog("Weather", "network_success", { totalDistance, numSamples }, duration, { target: "Open-Meteo", status: response.status, info: `${weatherArray.length} point(s), current temp: ${tempDisp}` });

      return weatherArray;
    } catch (error) {
      const isRateLimit = error.message?.includes("429") || error.message?.includes("Too Many Requests");
      console.warn(`Open-Meteo weather fetch failed: ${error.message || error}. Serving dynamic offline mathematical forecast.`);
      // Return high-fidelity mock forecast fallback
      const mockData = sampledPoints.map(p => generateMockWeather(p[0], p[1]));
      
      // Attach error states to array object
      mockData.isOfflineForecast = true;
      mockData.errorType = isRateLimit ? "429" : "general";
      mockData.errorMessage = error.message || "Network request failed";

      let cooldownUntilText = "";
      if (mockData.errorType === "429") {
        const now = new Date();
        const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
        mockData.cooldownUntil = midnight.getTime(); // Lock until local midnight
        cooldownUntilText = `Cooldown locked until midnight.`;
      }

      sendServerApiLog("Weather", "simulated_fallback", { totalDistance, numSamples }, null, { reason: `${error.message || "Fetch failed"}. ${cooldownUntilText}` });

      const now = new Date();
      const year = now.getFullYear();
      const month = (now.getMonth() + 1).toString().padStart(2, "0");
      const date = now.getDate().toString().padStart(2, "0");
      const hour = now.getHours().toString().padStart(2, "0");
      const currentHourStr = `${year}-${month}-${date}T${hour}:00`;
      
      let currentHourIdx = mockData[0]?.hourly?.time?.indexOf(currentHourStr);
      if (currentHourIdx === -1 || currentHourIdx === undefined) {
        currentHourIdx = now.getHours(); // Fallback
      }

      console.log(`⚠️ [Open-Meteo API] Fetch failed. Serving dynamic mock data for ${mockData.length} point(s). Sampled current hour (${currentHourStr}) metrics:`, {
        temp: `${mockData[0]?.hourly?.temperature_2m?.[currentHourIdx]}°C`,
        windSpeed: `${mockData[0]?.hourly?.wind_speed_10m?.[currentHourIdx]} km/h`,
        windDir: `${mockData[0]?.hourly?.wind_direction_10m?.[currentHourIdx]}°`
      });

      return mockData;
    } finally {
      // Clean up the active in-flight request tracking
      inflightWeatherRequests.delete(cacheKey);
    }
  })();

  if (!forceRefresh) {
    inflightWeatherRequests.set(cacheKey, promise);
  }

  return promise;
}

export async function reverseGeocode(lat, lon) {
  const BOROUGHS = ["Manhattan", "Brooklyn", "Queens", "Bronx", "Staten Island"];
  const cacheKey = `${Number(lat).toFixed(4)},${Number(lon).toFixed(4)}`;

  const getCleanArea = (area) => {
    if (!area) return "";
    return area.replace(/^(Village of|Town of|City of) /i, "").trim();
  };

  // Check cache first
  const cached = getCachedData(REV_GEOCODE_CACHE_PREFIX, cacheKey);
  if (cached) {
    console.log(`📦 [Reverse Geocoding Cache] Cache hit for coordinates: ${cacheKey}`);
    sendServerApiLog("Reverse Geocoding", "cache_hit", { lat, lon }, null, { key: `coords ${cacheKey}` });
    return cached;
  }

  sendServerApiLog("Reverse Geocoding", "cache_miss", { lat, lon }, null, { key: `coords ${cacheKey}` });

  if (process.env.MOCK === "true") {
    console.log("Mock data mode enabled via env var. Serving offline reverse geocoding.");
    sendServerApiLog("Reverse Geocoding", "simulated_mode", { lat, lon }, null, { reason: "MOCK=true" });
    return `Mock Location (${Number(lat).toFixed(3)}, ${Number(lon).toFixed(3)})`;
  }

  // 1. Try Nominatim reverse (Primary)
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&addressdetails=1`;
    
    // Throttle requests to Nominatim
    await throttleFetch();
    
    sendServerApiLog("Reverse Geocoding", "network_request", { lat, lon }, null, { target: "Nominatim", url });

    const startTime = Date.now();
    const response = await fetch(url, {
      headers: {
        "User-Agent": "BikingForecastApp"
      }
    });
    const duration = Date.now() - startTime;
    if (response.ok) {
      const data = await response.json();
      const addr = data.address || {};
      
      let placeName = null;
      if (addr.road) {
        const houseNum = addr.house_number ? `${addr.house_number} ` : "";
        const rawArea = addr.village || addr.town || addr.suburb || addr.city_district || addr.city;
        const area = getCleanArea(rawArea);
        placeName = `${houseNum}${addr.road}${area ? `, ${area}` : ""}`;
      } else {
        // Select the most specific location label
        const specificFields = [
          addr.neighbourhood,
          addr.quarter,
          addr.park,
          addr.leisure,
          addr.tourism,
          addr.village,
          addr.town
        ];
        
        let specificName = specificFields.find(val => val && !BOROUGHS.includes(val));
        
        if (!specificName && addr.suburb && !BOROUGHS.includes(addr.suburb)) {
          specificName = addr.suburb;
        }
        if (!specificName && addr.city_district && !BOROUGHS.includes(addr.city_district)) {
          specificName = addr.city_district;
        }
        
        if (specificName) {
          placeName = getCleanArea(specificName);
        } else {
          placeName = addr.road || addr.suburb || addr.city_district || addr.city;
        }
      }
      
      if (placeName) {
        setCachedData(REV_GEOCODE_CACHE_PREFIX, cacheKey, placeName);
        sendServerApiLog("Reverse Geocoding", "network_success", { lat, lon }, duration, { target: "Nominatim", status: response.status, info: `Resolved to: "${placeName}"` });
        return placeName;
      }
      const fallbackName = data.display_name?.split(",")[0] || null;
      if (fallbackName) {
        const cleanedFallback = getCleanArea(fallbackName);
        setCachedData(REV_GEOCODE_CACHE_PREFIX, cacheKey, cleanedFallback);
        sendServerApiLog("Reverse Geocoding", "network_success", { lat, lon }, duration, { target: "Nominatim", status: response.status, info: `Resolved fallback to: "${cleanedFallback}"` });
        return cleanedFallback;
      }
      sendServerApiLog("Reverse Geocoding", "network_failure", { lat, lon }, duration, { target: "Nominatim", status: response.status, message: "Could not parse descriptive place fields" });
      return null;
    }
    sendServerApiLog("Reverse Geocoding", "network_failure", { lat, lon }, duration, { target: "Nominatim", status: response.status, message: "Response status not OK" });
  } catch (error) {
    sendServerApiLog("Reverse Geocoding", "network_failure", { lat, lon }, null, { target: "Nominatim", status: "Error", message: error.message });
    console.warn("Nominatim reverse geocode failed: ", error.message);
  }

  // 2. Try Photon Komoot reverse (Fallback)
  try {
    const url = `https://photon.komoot.io/reverse?lon=${lon}&lat=${lat}`;
    
    sendServerApiLog("Reverse Geocoding", "network_request", { lat, lon }, null, { target: "Photon", url });

    const startTime = Date.now();
    const response = await fetch(url);
    const duration = Date.now() - startTime;
    if (response.ok) {
      const data = await response.json();
      if (data.features && data.features.length > 0) {
        const feat = data.features[0];
        const prop = feat.properties || {};
        
        let placeName = null;
        if (prop.street) {
          const houseNum = prop.housenumber ? `${prop.housenumber} ` : "";
          const rawArea = prop.city || prop.locality || prop.district;
          const area = getCleanArea(rawArea);
          placeName = `${houseNum}${prop.street}${area ? `, ${area}` : ""}`;
        } else {
          if (prop.locality && !BOROUGHS.includes(prop.locality)) {
            placeName = getCleanArea(prop.locality);
          }
          if (!placeName && prop.district && !BOROUGHS.includes(prop.district)) {
            placeName = getCleanArea(prop.district);
          }
          if (!placeName) {
            const rawFallback = prop.name || prop.street || prop.locality || prop.district;
            placeName = getCleanArea(rawFallback);
          }
        }
        
        if (placeName) {
          setCachedData(REV_GEOCODE_CACHE_PREFIX, cacheKey, placeName);
          sendServerApiLog("Reverse Geocoding", "network_success", { lat, lon }, duration, { target: "Photon", status: response.status, info: `Resolved to: "${placeName}"` });
          return placeName;
        }
      }
      sendServerApiLog("Reverse Geocoding", "network_failure", { lat, lon }, duration, { target: "Photon", status: response.status, message: "No features returned" });
    } else {
      sendServerApiLog("Reverse Geocoding", "network_failure", { lat, lon }, duration, { target: "Photon", status: response.status, message: "Response status not OK" });
    }
  } catch (error) {
    sendServerApiLog("Reverse Geocoding", "network_failure", { lat, lon }, null, { target: "Photon", status: "Error", message: error.message });
    console.warn("Photon reverse geocode failed: ", error.message);
  }

  sendServerApiLog("Reverse Geocoding", "simulated_fallback", { lat, lon }, null, { reason: "Reverse geocoding failed both services." });
  return null;
}

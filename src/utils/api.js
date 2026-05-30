import { sampleCoordinates, getDistance } from "./routeUtils";

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

export async function geocodeAddress(query) {
  if (!query || query.trim().length < 3) return [];
  
  const normQuery = query.toLowerCase().trim();
  
  // Gather matching local fallbacks
  const localMatches = FALLBACK_LOCATIONS.filter(item => 
    item.label.toLowerCase().includes(normQuery)
  );

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
    
    const response = await fetch(url);
    if (response.ok) {
      const data = await response.json();
      const nominatimResults = data.map(item => ({
        lat: parseFloat(item.lat),
        lon: parseFloat(item.lon),
        label: item.display_name
      }));
      return mergeResults(nominatimResults, localMatches);
    }
    console.warn(`Nominatim throttled: ${response.status}. Failover to Photon Komoot...`);
  } catch (error) {
    console.warn("Nominatim rate-limit ban detected. Seamless failover to Photon Komoot...");
  }

  // 2. Try Photon Komoot (Secondary Live Network Fallback)
  try {
    const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=5`;
    const response = await fetch(url);
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
      return mergeResults(photonResults, localMatches);
    }
  } catch (error) {
    console.warn("Photon geocoder failed, falling back to offline landmark POIs: ", error.message);
  }

  // 3. Fallback to Local Offline POIs
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

    const response = await fetch(url, {
      headers: {
        // Proactively set a customer identifier for fair-use tracking
        "X-Client-Id": "BikingForecastApp"
      }
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Valhalla Routing Error: ${response.status} - ${errText}`);
    }

    const data = await response.json();
    
    if (!data.trip || !data.trip.legs || data.trip.legs.length === 0) {
      throw new Error("No route found between selected points.");
    }

    return {
      shape: data.trip.legs[0].shape, // Encoded polyline6
      distance: data.trip.summary.length, // in km
      time: data.trip.summary.time, // in seconds
      legs: data.trip.legs
    };
  } catch (error) {
    console.error("Valhalla route fetch failed:", error);
    throw error;
  }
}

/**
 * Fetches hourly weather forecasts from Open-Meteo for coordinates along a route.
 * Selects 2 to 5 points depending on the route's total distance.
 * @param {Array<[number, number]>} routeCoordinates - Array of [lat, lon] route coordinates
 * @param {number} totalDistance - Total distance in km
 * @returns {Promise<Array<object>>} Array of Open-Meteo weather response objects
 */
export async function fetchRouteWeather(routeCoordinates, totalDistance) {
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
  
  try {
    const lats = sampledPoints.map(p => p[0]).join(",");
    const lons = sampledPoints.map(p => p[1]).join(",");
    
    // Request WMO weather codes, temp, humidity, precipitation probability, wind speed, wind direction, wind gusts
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}&hourly=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation_probability,precipitation,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m&timezone=auto`;
    
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`Open-Meteo error: ${response.status} - ${response.statusText}`);
    }
    
    const data = await response.json();
    
    // Ensure it's returned as an array, as Open-Meteo returns a single object if there's only 1 coordinate requested
    // but an array of objects if multiple points are requested.
    const weatherArray = Array.isArray(data) ? data : [data];
    return weatherArray;
  } catch (error) {
    console.error("Open-Meteo weather fetch failed:", error);
    throw error;
  }
}

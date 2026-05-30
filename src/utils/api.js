import { sampleCoordinates, getDistance } from "./routeUtils";

/**
 * Searches for coordinates matching an address query using OpenStreetMap's Nominatim geocoder.
 * @param {string} query - The location query (e.g. "Brooklyn Bridge, NY")
 * @returns {Promise<Array<{lat: number, lon: number, label: string}>>} Found locations
 */
export async function geocodeAddress(query) {
  if (!query || query.trim().length < 3) return [];
  
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(
      query
    )}&format=json&limit=5&addressdetails=1`;
    
    const response = await fetch(url, {
      headers: {
        // Respect Nominatim Usage Policy by providing a descriptive user-agent
        Accept: "application/json"
      }
    });
    
    if (!response.ok) {
      throw new Error(`Nominatim error: ${response.status} - ${response.statusText}`);
    }
    
    const data = await response.json();
    
    return data.map(item => ({
      lat: parseFloat(item.lat),
      lon: parseFloat(item.lon),
      label: item.display_name
    }));
  } catch (error) {
    console.error("Geocoding failed:", error);
    return [];
  }
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

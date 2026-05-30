/**
 * Decodes Valhalla's polyline6 string into an array of [latitude, longitude] pairs.
 * Valhalla uses 6 digits of decimal precision (10^6).
 * @param {string} str - Encoded polyline6 string
 * @returns {Array<[number, number]>} Decoded coordinates
 */
export function decodePolyline6(str) {
  if (!str) return [];
  let index = 0, lat = 0, lng = 0, coordinates = [], shift = 0, result = 0, byte = null;
  let latitude_change, longitude_change, factor = 1000000; // 10^6 precision

  while (index < str.length) {
    byte = null; shift = 0; result = 0;
    do {
      byte = str.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    latitude_change = ((result & 1) ? ~(result >> 1) : (result >> 1));
    
    shift = result = 0;
    do {
      byte = str.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    longitude_change = ((result & 1) ? ~(result >> 1) : (result >> 1));

    lat += latitude_change;
    lng += longitude_change;
    coordinates.push([lat / factor, lng / factor]);
  }
  return coordinates;
}

/**
 * Calculates the great-circle distance between two points on the Earth in kilometers.
 * Uses the Haversine formula.
 */
export function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // Distance in km
}

/**
 * Calculates the geodetic bearing between two coordinates in degrees (0 - 360).
 * 0 = North, 90 = East, 180 = South, 270 = West.
 */
export function getBearing(lat1, lon1, lat2, lon2) {
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const lat1Rad = lat1 * Math.PI / 180;
  const lat2Rad = lat2 * Math.PI / 180;
  
  const y = Math.sin(dLon) * Math.cos(lat2Rad);
  const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) -
            Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon);
            
  const brngRad = Math.atan2(y, x);
  const brngDeg = (brngRad * 180 / Math.PI + 360) % 360;
  return brngDeg;
}

/**
 * Breaks down route coordinates into individual segments with distance and bearing.
 * Useful for high-fidelity segment-by-segment wind calculations.
 * @param {Array<[number, number]>} coordinates - Array of coordinates
 * @returns {Array<{lat1: number, lon1: number, lat2: number, lon2: number, distance: number, bearing: number}>} Route segments
 */
export function calculateRouteSegments(coordinates) {
  if (!coordinates || coordinates.length < 2) return [];
  const segments = [];
  
  for (let i = 0; i < coordinates.length - 1; i++) {
    const [lat1, lon1] = coordinates[i];
    const [lat2, lon2] = coordinates[i + 1];
    const dist = getDistance(lat1, lon1, lat2, lon2);
    
    // Ignore extremely tiny segments (under 5 meters) to avoid bearing noise
    if (dist < 0.005) continue;
    
    const bearing = getBearing(lat1, lon1, lat2, lon2);
    segments.push({
      lat1,
      lon1,
      lat2,
      lon2,
      distance: dist,
      bearing
    });
  }
  
  // Fallback if all segments are too short
  if (segments.length === 0 && coordinates.length >= 2) {
    const [lat1, lon1] = coordinates[0];
    const [lat2, lon2] = coordinates[coordinates.length - 1];
    segments.push({
      lat1,
      lon1,
      lat2,
      lon2,
      distance: getDistance(lat1, lon1, lat2, lon2),
      bearing: getBearing(lat1, lon1, lat2, lon2)
    });
  }
  
  return segments;
}

/**
 * Samples specific coordinate indices along the route for weather fetching.
 * Selects points distributed evenly across the route's coordinates list.
 * @param {Array<[number, number]>} coordinates - Route path
 * @param {number} numSamples - Number of points to sample (e.g. 2 to 5)
 * @returns {Array<[number, number]>} Sampled coordinates
 */
export function sampleCoordinates(coordinates, numSamples) {
  if (!coordinates || coordinates.length === 0) return [];
  if (coordinates.length <= numSamples) return [...coordinates];
  if (numSamples <= 1) return [coordinates[0]];
  
  const sampled = [];
  for (let i = 0; i < numSamples; i++) {
    const index = Math.min(
      Math.round((i * (coordinates.length - 1)) / (numSamples - 1)),
      coordinates.length - 1
    );
    sampled.push(coordinates[index]);
  }
  return sampled;
}

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

/**
 * Maps sampled elevations back to route coordinates by linear interpolation,
 * calculates slope/grade for segments, and sums up total ascent/descent.
 * @param {Array<[number, number]>} routeCoordinates - Full list of [lat, lon] route coordinates
 * @param {Array<object>} segments - Pre-calculated segments
 * @param {object} elevationsData - Result from fetchRouteElevation: { elevations, sampledPoints }
 * @returns {{
 *   elevationProfile: Array<{distance: number, elevation: number}>,
 *   elevationGain: number,
 *   elevationLoss: number,
 *   minElevation: number,
 *   maxElevation: number,
 *   segments: Array<object>
 * }} Elevation enrichment package
 */
export function attachElevationToRoute(routeCoordinates, segments, elevationsData) {
  if (!routeCoordinates || routeCoordinates.length === 0 || !elevationsData || !elevationsData.elevations || elevationsData.elevations.length === 0) {
    return {
      elevationProfile: [],
      elevationGain: 0,
      elevationLoss: 0,
      minElevation: 0,
      maxElevation: 0,
      segments: segments || []
    };
  }

  const { elevations } = elevationsData;
  const numSamples = elevations.length;
  const N = routeCoordinates.length;

  // Step 1: Assign elevations to every coordinate in routeCoordinates
  const coordElevations = new Array(N);

  // Set the exact sampled points first
  const sampledIndices = [];
  for (let i = 0; i < numSamples; i++) {
    const idx = Math.min(
      Math.round((i * (N - 1)) / (numSamples - 1)),
      N - 1
    );
    coordElevations[idx] = elevations[i];
    sampledIndices.push(idx);
  }

  // Linearly interpolate elevations between sampled points
  for (let i = 0; i < sampledIndices.length - 1; i++) {
    const startIdx = sampledIndices[i];
    const endIdx = sampledIndices[i + 1];
    const startEle = coordElevations[startIdx];
    const endEle = coordElevations[endIdx];

    if (endIdx - startIdx > 1) {
      const step = (endEle - startEle) / (endIdx - startIdx);
      for (let idx = startIdx + 1; idx < endIdx; idx++) {
        coordElevations[idx] = startEle + step * (idx - startIdx);
      }
    }
  }

  // Handle any unassigned endpoints just in case
  if (coordElevations[0] === undefined) coordElevations[0] = elevations[0] || 0;
  for (let i = 1; i < N; i++) {
    if (coordElevations[i] === undefined) {
      coordElevations[i] = coordElevations[i - 1];
    }
  }

  // Step 2: Calculate cumulative distances along the route coordinates and build profile
  let totalDist = 0;
  const elevationProfile = [{ distance: 0, elevation: Math.round(coordElevations[0] * 10) / 10 }];

  for (let i = 1; i < N; i++) {
    const d = getDistance(
      routeCoordinates[i - 1][0],
      routeCoordinates[i - 1][1],
      routeCoordinates[i][0],
      routeCoordinates[i][1]
    );
    totalDist += d;
    
    elevationProfile.push({
      distance: Math.round(totalDist * 100) / 100, // in km
      elevation: Math.round(coordElevations[i] * 10) / 10 // in meters
    });
  }

  // Step 3: Calculate ascent (gain) and descent (loss)
  let elevationGain = 0;
  let elevationLoss = 0;
  let minElevation = coordElevations[0];
  let maxElevation = coordElevations[0];

  for (let i = 1; i < N; i++) {
    const diff = coordElevations[i] - coordElevations[i - 1];
    if (diff > 0) {
      elevationGain += diff;
    } else {
      elevationLoss += Math.abs(diff);
    }
    if (coordElevations[i] < minElevation) minElevation = coordElevations[i];
    if (coordElevations[i] > maxElevation) maxElevation = coordElevations[i];
  }

  // Step 4: Enrich route segments with start/end elevations and slope grade
  const getElevationAt = (lat, lon) => {
    let closestIdx = 0;
    let minDist = Infinity;
    for (let i = 0; i < N; i++) {
      const d = Math.abs(routeCoordinates[i][0] - lat) + Math.abs(routeCoordinates[i][1] - lon);
      if (d < minDist) {
        minDist = d;
        closestIdx = i;
      }
    }
    return coordElevations[closestIdx];
  };

  const enrichedSegments = (segments || []).map(seg => {
    const ele1 = getElevationAt(seg.lat1, seg.lon1);
    const ele2 = getElevationAt(seg.lat2, seg.lon2);
    const rise = ele2 - ele1;
    const run = seg.distance * 1000; // convert km to meters
    const grade = run > 0.1 ? rise / run : 0; // rise / run decimal slope

    return {
      ...seg,
      ele1: Math.round(ele1 * 10) / 10,
      ele2: Math.round(ele2 * 10) / 10,
      grade // slope grade
    };
  });

  return {
    elevationProfile,
    elevationGain: Math.round(elevationGain * 10) / 10,
    elevationLoss: Math.round(elevationLoss * 10) / 10,
    minElevation: Math.round(minElevation * 10) / 10,
    maxElevation: Math.round(maxElevation * 10) / 10,
    segments: enrichedSegments
  };
}

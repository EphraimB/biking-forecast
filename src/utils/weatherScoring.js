/**
 * Maps WMO Weather codes to descriptions, emoji, and discomfort penalties.
 */
export const WMO_MAP = {
  0: { desc: "Clear sky", emoji: "☀️", penalty: 0 },
  1: { desc: "Mainly clear", emoji: "🌤️", penalty: 0 },
  2: { desc: "Partly cloudy", emoji: "⛅", penalty: 0 },
  3: { desc: "Overcast", emoji: "☁️", penalty: 5 },
  45: { desc: "Foggy", emoji: "🌫️", penalty: 15 },
  48: { desc: "Depositing rime fog", emoji: "🌫️", penalty: 20 },
  51: { desc: "Light drizzle", emoji: "🌦️", penalty: 15 },
  53: { desc: "Moderate drizzle", emoji: "🌦️", penalty: 20 },
  55: { desc: "Heavy drizzle", emoji: "🌦️", penalty: 25 },
  61: { desc: "Light rain", emoji: "🌧️", penalty: 35 },
  63: { desc: "Moderate rain", emoji: "🌧️", penalty: 50 },
  65: { desc: "Heavy rain", emoji: "🌧️", penalty: 75 },
  71: { desc: "Light snow", emoji: "🌨️", penalty: 50 },
  73: { desc: "Moderate snow", emoji: "🌨️", penalty: 70 },
  75: { desc: "Heavy snow", emoji: "🌨️", penalty: 90 },
  77: { desc: "Snow grains", emoji: "🌨️", penalty: 50 },
  80: { desc: "Light rain showers", emoji: "🌦️", penalty: 40 },
  81: { desc: "Moderate rain showers", emoji: "🌦️", penalty: 55 },
  82: { desc: "Violent rain showers", emoji: "🌧️", penalty: 75 },
  85: { desc: "Light snow showers", emoji: "🌨️", penalty: 50 },
  86: { desc: "Heavy snow showers", emoji: "🌨️", penalty: 80 },
  95: { desc: "Thunderstorm", emoji: "⛈️", penalty: 100 },
  96: { desc: "Thunderstorm with light hail", emoji: "⛈️", penalty: 100 },
  99: { desc: "Thunderstorm with heavy hail", emoji: "⛈️", penalty: 100 }
};

/**
 * Calculates segment speed and duration considering wind impact (headwind/tailwind).
 * @param {object} segment - Route segment with distance and bearing
 * @param {number} windSpeed - Wind speed in km/h
 * @param {number} windDir - Wind direction (coming from, in degrees)
 * @param {number} baseSpeed - Base speed in km/h
 * @returns {{speed: number, duration: number, headwind: number, crosswind: number}} Segment metrics
 */
export function calculateSegmentSpeed(segment, windSpeed, windDir, baseSpeed) {
  const angleRad = ((segment.bearing - windDir) * Math.PI) / 180;
  
  // Headwind is positive, Tailwind is negative
  const headwind = windSpeed * Math.cos(angleRad);
  const crosswind = windSpeed * Math.abs(Math.sin(angleRad));
  
  let adjustedSpeed = baseSpeed;
  if (headwind > 0) {
    // Headwind slows the rider down
    adjustedSpeed += -0.45 * headwind;
  } else {
    // Tailwind speeds the rider up (positive addition)
    adjustedSpeed += -0.18 * headwind; // since headwind is negative, -0.18 * headwind is positive
    
    // Cap tailwind speed gain to 25% of base speed
    const maxSpeed = baseSpeed * 1.25;
    if (adjustedSpeed > maxSpeed) {
      adjustedSpeed = maxSpeed;
    }
  }
  
  // Clamp absolute speed between 6 km/h (steep hills/winds) and baseSpeed + 10 km/h
  const minSpeed = 6;
  const maxAbsSpeed = baseSpeed + 10;
  adjustedSpeed = Math.max(minSpeed, Math.min(maxAbsSpeed, adjustedSpeed));
  
  // Duration in hours: t = d / v
  const duration = segment.distance / adjustedSpeed;
  
  return {
    speed: adjustedSpeed,
    duration, // in hours
    headwind,
    crosswind
  };
}

/**
 * Computes the Wind-Aware Commuting Score and Speed/Duration adjustment for a specific hour.
 * @param {number} hourIndex - Hour index (0 to 167)
 * @param {Array<object>} routeSegments - Pre-calculated route segments
 * @param {number} baseSpeed - Rider's base speed in km/h
 * @param {Array<object>} weatherResults - Weather data for sampled coordinates
 * @param {object} preferences - Custom comfort thresholds
 * @returns {object} Final score and metrics breakdown
 */
export function calculateCommuteScore(hourIndex, routeSegments, baseSpeed, weatherResults, preferences = {}) {
  if (!routeSegments || routeSegments.length === 0 || !weatherResults || weatherResults.length === 0) {
    return { score: 0, duration: 0, speed: baseSpeed, windImpact: "None" };
  }
  
  const numSamples = weatherResults.length;
  const S = routeSegments.length;
  
  let totalDurationHours = 0;
  let totalDistance = 0;
  let weightedHeadwindSum = 0;
  let weightedCrosswindSum = 0;
  
  // 1. Calculate segment-by-segment speed adjustments
  for (let i = 0; i < S; i++) {
    const seg = routeSegments[i];
    
    // Find closest weather sample point index for this segment
    const sampleIdx = Math.min(Math.floor((i / S) * numSamples), numSamples - 1);
    const hourly = weatherResults[sampleIdx]?.hourly;
    
    // Fallback if weather array is missing/incomplete
    const windSpeed = hourly?.wind_speed_10m?.[hourIndex] ?? 0;
    const windDir = hourly?.wind_direction_10m?.[hourIndex] ?? 0;
    
    const segmentMetrics = calculateSegmentSpeed(seg, windSpeed, windDir, baseSpeed);
    
    totalDurationHours += segmentMetrics.duration;
    totalDistance += seg.distance;
    weightedHeadwindSum += segmentMetrics.headwind * seg.distance;
    weightedCrosswindSum += segmentMetrics.crosswind * seg.distance;
  }
  
  const avgSpeed = totalDistance / totalDurationHours;
  const avgHeadwind = weightedHeadwindSum / totalDistance;
  const avgCrosswind = weightedCrosswindSum / totalDistance;
  
  // 2. Fetch general weather metrics from midpoint (or start if 1 sample)
  const midSampleIdx = Math.floor(numSamples / 2);
  const midHourly = weatherResults[midSampleIdx]?.hourly;
  
  const temp = midHourly?.temperature_2m?.[hourIndex] ?? 20;
  const rainProb = midHourly?.precipitation_probability?.[hourIndex] ?? 0;
  const precip = midHourly?.precipitation?.[hourIndex] ?? 0;
  const gusts = midHourly?.wind_gusts_10m?.[hourIndex] ?? 0;
  const weatherCode = midHourly?.weather_code?.[hourIndex] ?? 0;
  
  // 3. Compute Penalties
  
  // Temperature Penalty
  let tempPenalty = 0;
  const prefMinTemp = preferences.minTemp ?? 15;
  const prefMaxTemp = preferences.maxTemp ?? 24;
  
  if (temp < prefMinTemp) {
    tempPenalty = (prefMinTemp - temp) * 2.5;
    tempPenalty = Math.min(tempPenalty, preferences.maxTempPenalty ?? 45);
  } else if (temp > prefMaxTemp) {
    tempPenalty = (temp - prefMaxTemp) * 2.0;
    tempPenalty = Math.min(tempPenalty, preferences.maxTempPenalty ?? 35);
  }
  
  // Precipitation & Rain Intensity Penalty
  let rainPenalty = rainProb * 0.6; // Base probability penalty (up to 60)
  
  if (precip > 0.2) {
    let intensityPenalty = 15; // light drizzle
    if (precip > 1.0) intensityPenalty = 30; // moderate rain
    if (precip > 3.0) intensityPenalty = 50; // heavy rain
    rainPenalty += intensityPenalty;
  }
  rainPenalty = Math.min(rainPenalty, preferences.maxRainPenalty ?? 80);
  
  // Wind Speed & Gusts Penalty
  let windPenalty = 0;
  if (avgHeadwind > 12) {
    windPenalty += (avgHeadwind - 12) * 1.2;
  }
  if (avgCrosswind > 18) {
    windPenalty += (avgCrosswind - 18) * 1.0;
  }
  if (gusts > 30) {
    windPenalty += (gusts - 30) * 1.2;
  }
  windPenalty = Math.min(windPenalty, preferences.maxWindPenalty ?? 60);
  
  // Weather Code Penalty
  const wmoInfo = WMO_MAP[weatherCode] || { desc: "Unknown", emoji: "❓", penalty: 0 };
  const wmoPenalty = wmoInfo.penalty;
  
  // Calculate final score
  let finalScore = 100 - (tempPenalty + rainPenalty + windPenalty + wmoPenalty);
  finalScore = Math.max(0, Math.min(100, Math.round(finalScore)));
  
  // If there's a thunderstorm, make the score 0 (unsafe)
  if (wmoPenalty >= 100) {
    finalScore = 0;
  }
  
  // Determine text wind impact summary
  let windImpact = "Light breeze";
  if (Math.abs(avgHeadwind) > 10) {
    windImpact = avgHeadwind > 0 ? "Noticeable Headwind" : "Nice Tailwind";
  }
  if (Math.abs(avgHeadwind) > 20) {
    windImpact = avgHeadwind > 0 ? "Strong Headwind" : "Strong Tailwind";
  }
  if (avgCrosswind > 20 && Math.abs(avgHeadwind) < 10) {
    windImpact = "Gusty Crosswind";
  }
  
  return {
    score: finalScore,
    duration: Math.round(totalDurationHours * 60), // in minutes
    speed: Math.round(avgSpeed * 10) / 10, // in km/h
    distance: Math.round(totalDistance * 10) / 10,
    headwind: Math.round(avgHeadwind * 10) / 10,
    crosswind: Math.round(avgCrosswind * 10) / 10,
    windSpeed: Math.round((midHourly?.wind_speed_10m?.[hourIndex] ?? 0) * 10) / 10,
    windDir: midHourly?.wind_direction_10m?.[hourIndex] ?? 0,
    gusts: Math.round(gusts * 10) / 10,
    temp: Math.round(temp * 10) / 10,
    rainProb: Math.round(rainProb),
    precip,
    weatherCode,
    wmoDesc: wmoInfo.desc,
    wmoEmoji: wmoInfo.emoji,
    penalties: {
      temp: Math.round(tempPenalty),
      rain: Math.round(rainPenalty),
      wind: Math.round(windPenalty),
      wmo: wmoPenalty
    },
    windImpact
  };
}

/**
 * Executes a feedback convergence loop to calculate the exact departure time
 * given a desired arrival time for a specific day.
 * @param {Date} targetArrivalDate - Complete date of target arrival
 * @param {Array<object>} routeSegments - Route segments
 * @param {number} baseSpeed - Rider's base speed in km/h
 * @param {Array<object>} weatherResults - Weather data for sampled coordinates
 * @param {object} preferences - Rider preferences
 * @returns {{departureTime: Date, duration: number, speed: number, score: number, hourDetails: object}} Results
 */
export function calculateDepartureTimeForArrival(targetArrivalDate, routeSegments, baseSpeed, weatherResults, preferences = {}) {
  if (!weatherResults || weatherResults.length === 0 || !routeSegments || routeSegments.length === 0) {
    return { departureTime: targetArrivalDate, duration: 0, speed: baseSpeed, score: 0 };
  }
  
  const totalDistance = routeSegments.reduce((sum, seg) => sum + seg.distance, 0);
  
  // Find the hour index (0 to 167) that corresponds to targetArrivalDate
  // Open-Meteo's forecast starts on the current day's midnight.
  const firstHourlyTimeStr = weatherResults[0]?.hourly?.time?.[0];
  if (!firstHourlyTimeStr) {
    return { departureTime: targetArrivalDate, duration: 0, speed: baseSpeed, score: 0 };
  }
  
  const forecastStart = new Date(firstHourlyTimeStr);
  const diffMs = targetArrivalDate - forecastStart;
  const targetArrivalHourIdx = Math.max(0, Math.min(167, Math.floor(diffMs / (1000 * 60 * 60))));
  
  // Step 1: Initial estimated duration based on base speed (in hours)
  const initialDurationHours = totalDistance / baseSpeed;
  let departureHourIdx = Math.max(0, Math.min(167, Math.round(targetArrivalHourIdx - initialDurationHours)));
  
  // Step 2: Feedback loop - iteration 1
  let commuteDetails = calculateCommuteScore(departureHourIdx, routeSegments, baseSpeed, weatherResults, preferences);
  let adjustedDurationHours = commuteDetails.duration / 60;
  
  // Step 3: Feedback loop - iteration 2 (convergence)
  departureHourIdx = Math.max(0, Math.min(167, Math.round(targetArrivalHourIdx - adjustedDurationHours)));
  commuteDetails = calculateCommuteScore(departureHourIdx, routeSegments, baseSpeed, weatherResults, preferences);
  
  const finalDurationMinutes = commuteDetails.duration;
  
  // Calculate precise departure time by subtracting duration in ms
  const departureTime = new Date(targetArrivalDate.getTime() - finalDurationMinutes * 60 * 1000);
  
  return {
    departureTime,
    duration: finalDurationMinutes,
    speed: commuteDetails.speed,
    score: commuteDetails.score,
    hourDetails: commuteDetails
  };
}

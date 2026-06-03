import { NextResponse } from "next/server";

export async function POST(request) {
  try {
    const { title, result, isOutbound, targetTimeStr, baseSpeed = 18, unitSystem } = await request.json();
    
    const score = result.score !== undefined ? result.score : result.hourDetails.score;
    const duration = result.duration;
    const speed = result.speed;
    const details = result.hourDetails || result;
    
    // ANSI colors
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
    
    // If invalid date fallback to current date
    if (isNaN(departureTime.getTime())) {
      departureTime = new Date();
    }
    
    const arrivalTime = new Date(departureTime.getTime() + duration * 60 * 1000);
    
    const depTimeText = departureTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const arrTimeText = arrivalTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

    // Imperial conversion checks
    const isImperial = unitSystem === "imperial" || process.env.IMPERIAL === "true" || process.env.NEXT_PUBLIC_IMPERIAL === "true";
    
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

    // Output formatted line-by-line text
    console.log(`\n${bold}${cyan}${title}${reset}`);
    console.log(`  ${bold}Score     :${reset} ${bold}${scoreColor}${score}/100${reset} (${scoreRating})`);
    console.log(`  ${gray}Deds      : Temp: -${details.penalties?.temp ?? 0} | Wind: -${details.penalties?.wind ?? 0} | Rain: -${details.penalties?.rain ?? 0} | WMO: -${details.penalties?.wmo ?? 0}${reset}`);
    console.log(`  ${bold}Commute   :${reset} Dep: ${depTimeText} -> Arr: ${arrTimeText} (${duration} mins, ${displayDist})`);
    console.log(`  ${bold}Speed     :${reset} Avg: ${displaySpeedAvg} | Base: ${displaySpeedBase}`);
    console.log(`  ${bold}Weather   :${reset} ${details.wmoDesc ?? "Clear"} | Temp: ${displayTemp} | Rain: ${details.rainProb ?? 0}% (${displayPrecip})`);
    console.log(`  ${bold}Wind      :${reset} Speed: ${displayWindSpeed} | Impact: ${details.windImpact ?? "None"}`);
    console.log(`                 Headwind: ${displayHeadwind} | Crosswind: ${displayCrosswind} | Gusts: ${displayGusts}`);
    console.log();
    
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Failed to log commute to terminal:", err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

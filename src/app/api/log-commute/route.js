import { NextResponse } from "next/server";

export async function POST(request) {
  try {
    const { title, result, isOutbound, targetTimeStr, baseSpeed = 18 } = await request.json();
    
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

    // Output formatted line-by-line text
    console.log(`\n${bold}${cyan}${title}${reset}`);
    console.log(`  ${bold}Score     :${reset} ${bold}${scoreColor}${score}/100${reset} (${scoreRating})`);
    console.log(`  ${gray}Deds      : Temp: -${details.penalties?.temp ?? 0} | Wind: -${details.penalties?.wind ?? 0} | Rain: -${details.penalties?.rain ?? 0} | WMO: -${details.penalties?.wmo ?? 0}${reset}`);
    console.log(`  ${bold}Commute   :${reset} Dep: ${depTimeText} -> Arr: ${arrTimeText} (${duration} mins, ${(details.distance ?? 0).toFixed(1)} km)`);
    console.log(`  ${bold}Speed     :${reset} Avg: ${speed.toFixed(1)} km/h | Base: ${baseSpeed.toFixed(1)} km/h`);
    
    const tempF = Math.round((details.temp ?? 20) * 1.8 + 32);
    console.log(`  ${bold}Weather   :${reset} ${details.wmoDesc ?? "Clear"} | Temp: ${(details.temp ?? 20).toFixed(1)}°C (${tempF}°F) | Rain: ${details.rainProb ?? 0}% (${(details.precip ?? 0).toFixed(1)}mm)`);
    
    console.log(`  ${bold}Wind      :${reset} Speed: ${(details.windSpeed ?? 0).toFixed(1)} km/h | Impact: ${details.windImpact ?? "None"}`);
    console.log(`                 Headwind: ${(details.headwind ?? 0).toFixed(1)} km/h | Crosswind: ${(details.crosswind ?? 0).toFixed(1)} km/h | Gusts: ${(details.gusts ?? 0).toFixed(1)} km/h`);
    console.log();
    
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Failed to log commute to terminal:", err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

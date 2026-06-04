import { NextResponse } from "next/server";

export async function POST(request) {
  try {
    const { apiName, action, params, durationMs, extra } = await request.json();
    
    // ANSI colors
    const reset = "\x1b[0m";
    const bold = "\x1b[1m";
    const gray = "\x1b[90m";
    const cyan = "\x1b[36m";
    const yellow = "\x1b[33m";
    const green = "\x1b[32m";
    const red = "\x1b[31m";
    const magenta = "\x1b[35m";
    
    let timeText = durationMs ? ` [took ${durationMs}ms]` : "";
    let prefix = `[${apiName}]`;
    
    if (apiName === "Geocoding") prefix = `${bold}${cyan}${prefix}${reset}`;
    else if (apiName === "Routing") prefix = `${bold}${magenta}${prefix}${reset}`;
    else if (apiName === "Weather") prefix = `${bold}${yellow}${prefix}${reset}`;
    else if (apiName === "Reverse Geocoding") prefix = `${bold}${cyan}${prefix}${reset}`;

    if (action === "cache_hit") {
      console.log(`${prefix} 📦 Cache HIT for: ${extra?.key || JSON.stringify(params)}`);
    } else if (action === "cache_miss") {
      console.log(`${prefix} 🔍 Cache MISS for: ${extra?.key || JSON.stringify(params)}`);
    } else if (action === "network_request") {
      console.log(`${prefix} 🌐 Live Request to ${extra?.target}: ${extra?.url}`);
    } else if (action === "network_success") {
      console.log(`${prefix} ✅ ${extra?.target || "API"} responded HTTP ${extra?.status || 200} (Success)${timeText} ${extra?.info ? `- ${extra.info}` : ""}`);
    } else if (action === "network_failure") {
      console.log(`${prefix} ❌ ${extra?.target || "API"} failed: HTTP ${extra?.status || "Error"} - ${extra?.message || "Request failed"}${timeText}`);
    } else if (action === "rate_limited") {
      console.log(`${prefix} 🛑 ${extra?.target || "API"} rate-limited (HTTP 429). Cooldown activated.`);
    } else if (action === "cooldown_active") {
      console.log(`${prefix} 🛑 Cooldown active (${extra?.remaining || "active"}). Serving simulated forecast.`);
    } else if (action === "simulated_fallback") {
      console.log(`${prefix} 🤖 Serving simulated/offline forecast: ${extra?.reason || "offline fallback"}`);
    } else if (action === "simulated_mode") {
      console.log(`${prefix} 🤖 Mock Mode (MOCK=true). Serving offline simulated forecast.`);
    }
    
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Failed to log API telemetry to terminal:", err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

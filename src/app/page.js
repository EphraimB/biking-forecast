"use client";

import { useState, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import { 
  Bike, Plus, Trash2, Calendar, Clock, MapPin, Navigation, 
  Search, ShieldAlert, Sparkles, Sun, Compass, Play, 
  Check, ChevronRight, X, ArrowLeftRight, HelpCircle, 
  Bookmark, Sliders, SunDim, Award, Info
} from "lucide-react";

import { fetchBicycleRoute, fetchRouteWeather, geocodeAddress } from "@/utils/api";
import { decodePolyline6, calculateRouteSegments, sampleCoordinates } from "@/utils/routeUtils";
import { calculateCommuteScore, calculateDepartureTimeForArrival } from "@/utils/weatherScoring";

// Dynamic import of RouteMap to bypass SSR Leaflet issues
const RouteMap = dynamic(() => import("@/components/RouteMap"), {
  ssr: false,
  loading: () => (
    <div style={{
      display: "flex",
      justifyContent: "center",
      alignItems: "center",
      height: "100%",
      width: "100%",
      background: "#0b0f19",
      color: "var(--hud-text-secondary)",
      fontSize: "0.95rem",
      fontWeight: "500"
    }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "10px" }}>
        <Bike size={36} style={{ color: "var(--color-emerald)", animation: "pulse 2s infinite" }} />
        <span>Initializing Spatial Forecast Canvas...</span>
      </div>
    </div>
  )
});

const WEEKDAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAYS_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export default function Home() {
  // HUD UI States: 
  // 0: Ambient Map
  // 1: Route Setup
  // 2: 7-Day Commute Outlook Ribbon
  // 3: Single-Day Focus & Scrubber
  // 4: Segment Details Card
  const [hudState, setHudState] = useState(0);

  // Core Search & Autocomplete
  const [startQuery, setStartQuery] = useState("");
  const [endQuery, setEndQuery] = useState("");
  const [startResults, setStartResults] = useState([]);
  const [endResults, setEndResults] = useState([]);
  const [isSearchingStart, setIsSearchingStart] = useState(false);
  const [isSearchingEnd, setIsSearchingEnd] = useState(false);
  
  // Coordinates & Planned segments
  const [draftStart, setDraftStart] = useState(null);
  const [draftEnd, setDraftEnd] = useState(null);
  const [routeCoordinates, setRouteCoordinates] = useState([]);
  const [routeSegments, setRouteSegments] = useState([]);
  const [weatherResults, setWeatherResults] = useState([]);
  
  // HUD Config Settings (State 1)
  const [newBikeType, setNewBikeType] = useState("Hybrid");
  const [newSpeed, setNewSpeed] = useState(18);
  const [newOutboundTime, setNewOutboundTime] = useState("08:00");
  const [newReturnTime, setNewReturnTime] = useState("17:30");
  const [saveRouteName, setSaveRouteName] = useState("");
  const [shouldSaveRoute, setShouldSaveRoute] = useState(false);

  // Saved Routes Hub (🔖 Persistence)
  const [savedRoutes, setSavedRoutes] = useState([]);
  const [isSavedHubOpen, setIsSavedHubOpen] = useState(false);

  // Time & Timeline Scrub Scopes (State 3)
  const [selectedDayOffset, setSelectedDayOffset] = useState(0); // 0 (Today) to 6 (Day + 6)
  const [selectedHour, setSelectedHour] = useState(8); // 6:00 AM to 8:00 PM (commuter scrubber scale)

  // Dynamic Packing Drawer Scope (🎒 checklist toggle)
  const [isPackingOpen, setIsPackingOpen] = useState(false);
  const [packingList, setPackingList] = useState([]);

  // Adaptive Unit Toggle (📐 Metric / Imperial)
  const [unitSystem, setUnitSystem] = useState("metric");

  // Ambient Local WeatherHUD Info
  const [userLocation, setUserLocation] = useState(null);
  const [ambientWeather, setAmbientWeather] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const geocodeTimeoutRef = useRef(null);

  // Load Saved Routes from localStorage on Mount
  useEffect(() => {
    const saved = localStorage.getItem("hud_saved_routes");
    if (saved) {
      try {
        setSavedRoutes(JSON.parse(saved));
      } catch (e) {
        console.error("Error loading saved routes:", e);
      }
    }

    // Centered location default ambient lookup
    if (typeof window !== "undefined" && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const loc = { lat: position.coords.latitude, lon: position.coords.longitude };
          setUserLocation(loc);
          fetchAmbientWeather(loc.lat, loc.lon);
        },
        () => {
          // Central Park Fallback
          const fallback = { lat: 40.7851, lon: -73.9682 };
          setUserLocation(fallback);
          fetchAmbientWeather(fallback.lat, fallback.lon);
        }
      );
    }
  }, []);

  const fetchAmbientWeather = async (lat, lon) => {
    try {
      const dummyCoords = [[lat, lon]];
      const weather = await fetchRouteWeather(dummyCoords, 1);
      if (weather && weather.length > 0) {
        const hourly = weather[0]?.hourly;
        const currentHour = new Date().getHours();
        setAmbientWeather({
          temp: hourly?.temperature_2m?.[currentHour] ?? 22,
          windSpeed: hourly?.wind_speed_10m?.[currentHour] ?? 12,
          windDir: getWindCompassDirection(hourly?.wind_direction_10m?.[currentHour] ?? 0),
          desc: "Perfect Local Conditions"
        });
      }
    } catch (e) {
      console.error("Ambient weather fetch error:", e);
    }
  };

  const getWindCompassDirection = (degrees) => {
    const directions = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
    const index = Math.round(degrees / 45) % 8;
    return directions[index];
  };

  // Autocomplete Geocoding Debouncing
  const triggerGeocode = (query, isStart) => {
    if (!query || query.trim().length < 3) {
      if (isStart) setStartResults([]);
      else setEndResults([]);
      return;
    }

    if (geocodeTimeoutRef.current) {
      clearTimeout(geocodeTimeoutRef.current);
    }

    geocodeTimeoutRef.current = setTimeout(async () => {
      if (isStart) {
        setIsSearchingStart(true);
        const res = await geocodeAddress(query);
        setStartResults(res || []);
        setIsSearchingStart(false);
      } else {
        setIsSearchingEnd(true);
        const res = await geocodeAddress(query);
        setEndResults(res || []);
        setIsSearchingEnd(false);
      }
    }, 600);
  };

  // Route Planning API Core Trigger
  const loadRouteDetails = async (start, end, bikeType, speed) => {
    setIsLoading(true);
    setError(null);
    try {
      // 1. Fetch routing polyline from Valhalla
      const routeData = await fetchBicycleRoute(start.lat, start.lon, end.lat, end.lon, bikeType, speed);
      const decodedCoords = decodePolyline6(routeData.shape);
      setRouteCoordinates(decodedCoords);

      // 2. Pre-calculate bearings and segments
      const segments = calculateRouteSegments(decodedCoords);
      setRouteSegments(segments);

      // 3. Fetch Open-Meteo weather along the coordinates
      const weatherData = await fetchRouteWeather(decodedCoords, routeData.distance);
      setWeatherResults(weatherData);

      // Successfully mapped! Load State 2
      setHudState(2);
    } catch (err) {
      console.error(err);
      setError(err.message || "Route validation pipeline failed.");
    } finally {
      setIsLoading(false);
    }
  };

  // Save Route Action Persistence
  const handleSaveRoute = () => {
    if (!draftStart || !draftEnd) return;
    const name = saveRouteName.trim() || `Route: ${draftStart.label.split(",")[0]} ⇆ ${draftEnd.label.split(",")[0]}`;
    
    const newRoute = {
      id: Date.now().toString(),
      name,
      start: draftStart,
      end: draftEnd,
      bikeType: newBikeType,
      speed: newSpeed,
      outboundTime: newOutboundTime,
      returnTime: newReturnTime
    };

    const updated = [...savedRoutes, newRoute];
    setSavedRoutes(updated);
    localStorage.setItem("hud_saved_routes", JSON.stringify(updated));
    setShouldSaveRoute(false);
    setSaveRouteName("");
  };

  const handleDeleteSavedRoute = (id, e) => {
    e.stopPropagation();
    const updated = savedRoutes.filter(r => r.id !== id);
    setSavedRoutes(updated);
    localStorage.setItem("hud_saved_routes", JSON.stringify(updated));
  };

  const handleLoadSavedRoute = (route) => {
    setDraftStart(route.start);
    setDraftEnd(route.end);
    setNewBikeType(route.bikeType);
    setNewSpeed(route.speed);
    setNewOutboundTime(route.outboundTime || "08:00");
    setNewReturnTime(route.returnTime || "17:30");
    
    loadRouteDetails(route.start, route.end, route.bikeType, route.speed);
    setIsSavedHubOpen(false);
  };

  // Dynamic Weather-Adaptive Packing List Core Logic
  const compileDynamicPackingList = (dayOffset, activeHour) => {
    if (weatherResults.length === 0) return;
    
    const hourIdx = dayOffset * 24 + activeHour;
    const midIdx = Math.floor(weatherResults.length / 2);
    const midHourly = weatherResults[midIdx]?.hourly;

    const temp = midHourly?.temperature_2m?.[hourIdx] ?? 20;
    const isRaining = (midHourly?.precipitation?.[hourIdx] ?? 0) > 0.1;
    const uvIndex = midHourly?.uv_index?.[hourIdx] ?? 0;
    const isSunset = activeHour > 18 || activeHour < 7;
    const totalDist = routeSegments.reduce((sum, seg) => sum + seg.distance, 0);

    const checklist = [];

    // 1. Weather Shaders (Sunscreen & Rain Protection)
    if (uvIndex >= 6) {
      checklist.push({
        id: "sun-extreme",
        emoji: "🧴",
        item: "SPF 50+ Sweat-Resistant Sunscreen",
        advice: `Extreme UV Index (${uvIndex.toFixed(0)}) warning. Wear UV-sleeves and reapply every 90 minutes.`
      });
      checklist.push({
        id: "sun-lip",
        emoji: "💄",
        item: "UV Protective Lip Balm",
        advice: "Prevent wind and sun chapping."
      });
    } else if (uvIndex >= 3) {
      checklist.push({
        id: "sun-moderate",
        emoji: "🧴",
        item: "SPF 30+ Sunscreen",
        advice: `Moderate UV exposure forecast. Sunglasses recommended.`
      });
    }

    if (isRaining) {
      checklist.push({
        id: "rain-shell",
        emoji: "🧥",
        item: "Waterproof Rain Shell / Cape",
        advice: "Active precipitation forecasted along segments."
      });
      checklist.push({
        id: "rain-fender",
        emoji: "🚲",
        item: "Splash Fenders Check",
        advice: "Wet road sprays deplete heat rates on body."
      });
    }

    // 2. Temperature Shaders (Cold/Warm Protection)
    if (temp < 10) {
      checklist.push({
        id: "temp-cold",
        emoji: "🧤",
        item: "Windproof Thermal Gloves & Neck Gaiter",
        advice: `Chilly weather (${temp.toFixed(1)}°C / ${(temp * 1.8 + 32).toFixed(0)}°F). Hands lose motor control quickly.`
      });
    } else if (temp > 28) {
      checklist.push({
        id: "temp-hot",
        emoji: "💧",
        item: "Electrolyte Hydration Caps",
        advice: `Extreme heat (${temp.toFixed(1)}°C). Standard water is insufficient to replace salt depletion.`
      });
    }

    // 3. Dusk/Night Time Shaders (Active lights check)
    if (isSunset) {
      checklist.push({
        id: "sunset-light",
        emoji: "💡",
        item: "Active Blinking Front & Tail Lights",
        advice: "Commuting leg falls under twilight. High visibility required."
      });
    }

    // 4. Distance & Exertion Shaders
    if (totalDist > 20) {
      checklist.push({
        id: "dist-tubes",
        emoji: "🔧",
        item: "Spare Tubes, Lever & CO2 Inflator",
        advice: `Long distance (${(totalDist * 0.621371).toFixed(1)} miles). Self-rescue capacity required.`
      });
    }

    setPackingList(checklist);
  };

  // Toggle checklist open/closed
  const togglePackingList = () => {
    if (!isPackingOpen) {
      compileDynamicPackingList(selectedDayOffset, selectedHour);
    }
    setIsPackingOpen(!isPackingOpen);
  };

  // Get active forecast details for Top HUD bubbles
  const getActiveForecast = () => {
    if (weatherResults.length === 0) return null;
    const hourIdx = selectedDayOffset * 24 + selectedHour;
    
    // Average scores across segments
    return calculateCommuteScore(hourIdx, routeSegments, newSpeed, weatherResults);
  };

  const activeForecast = getActiveForecast();

  // Helper to format rolling day names
  const getRollingDayLabel = (offset) => {
    if (offset === 0) return "Today";
    if (offset === 1) return "Tomorrow";
    
    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() + offset);
    return WEEKDAYS_SHORT[targetDate.getDay()];
  };

  // Calculate 7-day commute tracks data for Double-Sided Ribbon
  const get7DayCommuteData = () => {
    if (weatherResults.length === 0) return [];
    
    const ribbonDays = [];
    for (let offset = 0; offset < 7; offset++) {
      // Outbound Leg Hour Index
      const outboundHour = parseInt(newOutboundTime.split(":")[0]);
      const outboundIdx = offset * 24 + outboundHour;
      const outboundScore = calculateCommuteScore(outboundIdx, routeSegments, newSpeed, weatherResults);

      // Return Leg Hour Index
      const returnHour = parseInt(newReturnTime.split(":")[0]);
      const returnIdx = offset * 24 + returnHour;
      const returnScore = calculateCommuteScore(returnIdx, routeSegments, newSpeed, weatherResults);

      ribbonDays.push({
        offset,
        label: getRollingDayLabel(offset),
        outbound: outboundScore,
        return: returnScore
      });
    }
    return ribbonDays;
  };

  const ribbonDaysData = get7DayCommuteData();

  return (
    <div style={{ position: "relative", width: "100vw", height: "100vh", overflow: "hidden", background: "#0b0f19" }}>
      
      {/* 
        -------------------------------------------------------------
        CORE MAP VIEWPORT (100% VISIBLE CANVAS BACKDROP)
        ------------------------------------------------------------- 
      */}
      <div style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", zIndex: 1 }}>
        <RouteMap
          coordinates={routeCoordinates}
          startLocation={draftStart}
          endLocation={draftEnd}
          routeSegments={routeSegments}
          weatherResults={weatherResults}
          selectedDay={selectedDayOffset}
          selectedHour={selectedHour}
          customSpeed={newSpeed}
          isDrawingMode={hudState === 1}
          onMapClick={(coord) => {
            const label = `Pinned coordinate (${coord.lat.toFixed(4)}, ${coord.lon.toFixed(4)})`;
            if (!draftStart) {
              setDraftStart({ ...coord, label });
              setStartQuery(label);
            } else if (!draftEnd) {
              setDraftEnd({ ...coord, label });
              setEndQuery(label);
            }
          }}
          unitSystem={unitSystem}
        />
      </div>

      {/* 
        -------------------------------------------------------------
        STATE 0: AMBIENT STATE / TOP HUD CONTROLS
        ------------------------------------------------------------- 
      */}
      
      {/* Top Left: Search & Saved Route Hub Trigger */}
      <div style={{ position: "absolute", top: "20px", left: "20px", zIndex: 9999, display: "flex", gap: "10px" }} className="hud-slide-top">
        
        {hudState === 0 && (
          <>
            <button 
              className="hud-bubble" 
              onClick={() => setHudState(1)}
              style={{ cursor: "pointer", fontWeight: "600", paddingRight: "30px", border: "1px solid rgba(255, 255, 255, 0.1)" }}
            >
              <Search size={16} style={{ color: "var(--hud-text-secondary)" }} />
              <span>Enter Route...</span>
            </button>

            <button 
              className="hud-bubble" 
              onClick={() => setIsSavedHubOpen(!isSavedHubOpen)}
              style={{ padding: "10px", width: "42px", justifyContent: "center", cursor: "pointer" }}
              title="Saved Routes"
            >
              <Bookmark size={16} style={{ color: isSavedHubOpen ? "var(--color-emerald)" : "var(--hud-text-primary)" }} />
            </button>
          </>
        )}

        {/* Saved Routes Dropdown overlay */}
        {isSavedHubOpen && hudState === 0 && (
          <div className="hud-card" style={{ position: "absolute", top: "54px", left: 0, width: "320px", zIndex: 99999, display: "flex", flexDirection: "column", gap: "12px", maxHeight: "300px", overflowY: "auto" }}>
            <h4 style={{ fontFamily: "var(--font-heading)", fontSize: "0.95rem", color: "var(--hud-text-secondary)", borderBottom: "1px solid var(--hud-border)", paddingBottom: "6px" }}>🔖 Saved Routes</h4>
            {savedRoutes.length === 0 ? (
              <p style={{ fontSize: "0.78rem", color: "var(--hud-text-secondary)" }}>No saved routes yet. Plan a route and save it to display here.</p>
            ) : (
              savedRoutes.map((route) => (
                <div 
                  key={route.id} 
                  className="hud-btn" 
                  onClick={() => handleLoadSavedRoute(route)}
                  style={{ justifyContent: "space-between", borderRadius: "10px", padding: "10px 14px", background: "rgba(255,255,255,0.05)" }}
                >
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", width: "80%" }}>{route.name}</span>
                  <button 
                    onClick={(e) => handleDeleteSavedRoute(route.id, e)} 
                    style={{ background: "none", border: "none", color: "var(--color-ruby)", cursor: "pointer", display: "flex", alignItems: "center" }}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Top Right: Unit Toggle & Ambient Weather HUD */}
      <div style={{ position: "absolute", top: "20px", right: "20px", zIndex: 9999, display: "flex", gap: "10px", alignItems: "center" }} className="hud-slide-top">
        
        {/* Metric / Imperial Toggling Bubble */}
        <button 
          className="hud-bubble" 
          onClick={() => setUnitSystem(unitSystem === "metric" ? "imperial" : "metric")}
          style={{ padding: "10px 14px", fontSize: "0.78rem", fontWeight: "800", cursor: "pointer", background: "rgba(15,23,42,0.85)" }}
          title="Switch Units"
        >
          📐 {unitSystem === "metric" ? "METRIC" : "IMPERIAL"}
        </button>

        {hudState === 0 && ambientWeather && (
          <div className="hud-bubble" style={{ pointerEvents: "none" }}>
            <SunDim size={16} style={{ color: "var(--color-amber)", animation: "spin 12s linear infinite" }} />
            <span style={{ fontSize: "0.82rem", fontWeight: "600" }}>
              {ambientWeather.temp.toFixed(1)}°C • {ambientWeather.windSpeed.toFixed(0)} km/h {ambientWeather.windDir}
            </span>
          </div>
        )}
      </div>

      {/* 
        -------------------------------------------------------------
        STATE 1: ROUTE SETUP INPUT PANEL & SETTINGS
        ------------------------------------------------------------- 
      */}
      {hudState === 1 && (
        <div style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", pointerEvents: "none", zIndex: 9999 }}>
          
          {/* Top Center: Search inputs Bar */}
          <div style={{ position: "absolute", top: "20px", left: "50%", transform: "translateX(-50%)", width: "420px", maxWidth: "calc(100% - 40px)", display: "flex", flexDirection: "column", gap: "8px" }} className="hud-slide-top">
            <div className="hud-card" style={{ padding: "12px", display: "flex", flexDirection: "column", gap: "10px", pointerEvents: "auto" }}>
              
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontFamily: "var(--font-heading)", fontWeight: "700", fontSize: "0.9rem" }}>Plan Custom Route</span>
                <button onClick={() => setHudState(0)} style={{ background: "none", border: "none", color: "var(--hud-text-secondary)", cursor: "pointer" }}><X size={16} /></button>
              </div>

              {/* Start input */}
              <div style={{ position: "relative" }}>
                <input 
                  type="text" 
                  className="hud-input" 
                  placeholder="🏡 Enter Start Address..." 
                  value={startQuery}
                  onChange={(e) => {
                    setStartQuery(e.target.value);
                    triggerGeocode(e.target.value, true);
                  }}
                />
                {startResults.length > 0 && (
                  <div className="hud-card" style={{ position: "absolute", top: "42px", left: 0, width: "100%", maxHeight: "180px", overflowY: "auto", zIndex: 99999, padding: "8px", gap: "4px", display: "flex", flexDirection: "column" }}>
                    {startResults.map((loc, idx) => (
                      <div 
                        key={idx} 
                        className="hud-btn" 
                        onClick={() => {
                          setDraftStart(loc);
                          setStartQuery(loc.label);
                          setStartResults([]);
                        }}
                        style={{ padding: "8px 12px", borderRadius: "8px", background: "none", border: "none", justifyContent: "flex-start", cursor: "pointer" }}
                      >
                        {loc.label}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* End input */}
              <div style={{ position: "relative" }}>
                <input 
                  type="text" 
                  className="hud-input" 
                  placeholder="🏢 Enter Destination..." 
                  value={endQuery}
                  onChange={(e) => {
                    setEndQuery(e.target.value);
                    triggerGeocode(e.target.value, false);
                  }}
                />
                {endResults.length > 0 && (
                  <div className="hud-card" style={{ position: "absolute", top: "42px", left: 0, width: "100%", maxHeight: "180px", overflowY: "auto", zIndex: 99999, padding: "8px", gap: "4px", display: "flex", flexDirection: "column" }}>
                    {endResults.map((loc, idx) => (
                      <div 
                        key={idx} 
                        className="hud-btn" 
                        onClick={() => {
                          setDraftEnd(loc);
                          setEndQuery(loc.label);
                          setEndResults([]);
                        }}
                        style={{ padding: "8px 12px", borderRadius: "8px", background: "none", border: "none", justifyContent: "flex-start", cursor: "pointer" }}
                      >
                        {loc.label}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Direct Pin Tapping Note */}
              <p style={{ fontSize: "0.68rem", color: "var(--hud-text-secondary)", textAlign: "center" }}>
                💡 Or tap start/end coordinates directly on the map.
              </p>
            </div>
          </div>

          {/* Center Right: Route config overlays */}
          <div style={{ position: "absolute", bottom: "30px", right: "20px", width: "320px" }} className="hud-slide-bottom">
            <div className="hud-card" style={{ display: "flex", flexDirection: "column", gap: "16px", pointerEvents: "auto" }}>
              <h4 style={{ fontFamily: "var(--font-heading)", fontWeight: "800", fontSize: "0.95rem" }}>🚴 Rider Configurations</h4>
              
              {/* Bike Selection */}
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <span style={{ fontSize: "0.74rem", color: "var(--hud-text-secondary)" }}>Bicycle Profile</span>
                <select 
                  className="hud-input" 
                  value={newBikeType}
                  onChange={(e) => {
                    setNewBikeType(e.target.value);
                    const defaultSpeeds = { Road: 24, Hybrid: 18, Mountain: 16, E_Bike: 25 };
                    setNewSpeed(defaultSpeeds[e.target.value] || 18);
                  }}
                  style={{ background: "#111827", border: "1px solid var(--hud-border)" }}
                >
                  <option value="Road">🚴 Road Bike</option>
                  <option value="Hybrid">🚲 Hybrid / Commuter</option>
                  <option value="Mountain">🚵 Mountain Bike</option>
                  <option value="E_Bike">⚡ Electric Bike</option>
                </select>
              </div>

              {/* Speed Slider */}
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.74rem" }}>
                  <span style={{ color: "var(--hud-text-secondary)" }}>Base Speed</span>
                  <span>{newSpeed} km/h</span>
                </div>
                <input 
                  type="range" 
                  min="10" 
                  max="35" 
                  value={newSpeed}
                  onChange={(e) => setNewSpeed(parseInt(e.target.value))}
                  style={{ accentColor: "var(--color-emerald)", cursor: "pointer" }}
                />
              </div>

              {/* Commute departure times */}
              <div style={{ display: "flex", gap: "10px" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "4px", width: "50%" }}>
                  <span style={{ fontSize: "0.72rem", color: "var(--hud-text-secondary)" }}>Outbound leg</span>
                  <input type="time" className="hud-input" value={newOutboundTime} onChange={(e) => setNewOutboundTime(e.target.value)} style={{ padding: "6px 8px" }} />
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "4px", width: "50%" }}>
                  <span style={{ fontSize: "0.72rem", color: "var(--hud-text-secondary)" }}>Return leg</span>
                  <input type="time" className="hud-input" value={newReturnTime} onChange={(e) => setNewReturnTime(e.target.value)} style={{ padding: "6px 8px" }} />
                </div>
              </div>

              {/* Save Route Persistence Toggle */}
              <div style={{ display: "flex", flexDirection: "column", gap: "8px", borderTop: "1px solid var(--hud-border)", paddingTop: "12px" }}>
                <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "0.78rem", cursor: "pointer" }}>
                  <input 
                    type="checkbox" 
                    checked={shouldSaveRoute} 
                    onChange={(e) => setShouldSaveRoute(e.target.checked)}
                    style={{ accentColor: "var(--color-emerald)" }}
                  />
                  <span>🔖 Save Route to local library</span>
                </label>

                {shouldSaveRoute && (
                  <input 
                    type="text" 
                    className="hud-input" 
                    placeholder="Route Name (e.g. Work Commute)..."
                    value={saveRouteName}
                    onChange={(e) => setSaveRouteName(e.target.value)}
                  />
                )}
              </div>

              {/* Confirm Route build pipeline */}
              <button 
                className="hud-btn active"
                onClick={() => {
                  if (!draftStart || !draftEnd) {
                    alert("Please select starting and destination points.");
                    return;
                  }
                  if (shouldSaveRoute) {
                    handleSaveRoute();
                  }
                  loadRouteDetails(draftStart, draftEnd, newBikeType, newSpeed);
                }}
                style={{ width: "100%", justifyContent: "center", padding: "12px", fontSize: "0.85rem", cursor: "pointer" }}
              >
                {isLoading ? "Analyzing..." : "Confirm & Map HUD"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 
        -------------------------------------------------------------
        STATES 2 & 3: COMMUTE 7-DAY OUTLOOK RIBBON & TEMPORAL HUD
        ------------------------------------------------------------- 
      */}
      {(hudState === 2 || hudState === 3) && activeForecast && (
        <div style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", pointerEvents: "none", zIndex: 9999 }}>
          
          {/* Top Left: Active Route details */}
          <div style={{ position: "absolute", top: "20px", left: "20px", zIndex: 9999 }} className="hud-slide-top">
            <div className="hud-bubble" style={{ pointerEvents: "auto", border: "1px solid rgba(255,255,255,0.15)" }}>
              <div 
                style={{
                  width: "10px",
                  height: "100%",
                  borderRadius: "50%",
                  background: activeForecast.score >= 85 ? "var(--color-emerald)" : activeForecast.score >= 50 ? "var(--color-amber)" : "var(--color-ruby)",
                  boxShadow: `0 0 10px ${activeForecast.score >= 85 ? "var(--color-emerald-glow)" : activeForecast.score >= 50 ? "var(--color-amber-glow)" : "var(--color-ruby-glow)"}`,
                  display: "inline-block",
                  marginRight: "4px"
                }} 
                className={activeForecast.score >= 85 ? "hud-pulse-emerald" : activeForecast.score >= 50 ? "hud-pulse-amber" : "hud-pulse-ruby"}
              />
              <span style={{ fontSize: "0.88rem", fontWeight: "700" }}>
                Score: {activeForecast.score}% • {activeForecast.wmoEmoji} {activeForecast.wmoDesc}
              </span>
              <button 
                onClick={() => {
                  setHudState(0);
                  setRouteCoordinates([]);
                  setRouteSegments([]);
                  setWeatherResults([]);
                  setDraftStart(null);
                  setDraftEnd(null);
                  setStartQuery("");
                  setEndQuery("");
                }} 
                style={{ background: "none", border: "none", color: "var(--hud-text-secondary)", cursor: "pointer", display: "flex", alignItems: "center", marginLeft: "8px" }}
              >
                <X size={14} />
              </button>
            </div>
          </div>

          {/* Top Right: Packing List Overlay (🎒) and Unit Toggle */}
          <div style={{ position: "absolute", top: "20px", right: "20px", display: "flex", gap: "10px" }} className="hud-slide-top">
            <button 
              className="hud-bubble" 
              onClick={togglePackingList}
              style={{ cursor: "pointer", border: isPackingOpen ? "1.5px solid var(--color-emerald)" : "1px solid var(--hud-border)" }}
            >
              <span>🎒</span>
              <span style={{ fontSize: "0.78rem", fontWeight: "800" }}>GEAR CHECK</span>
            </button>

            {/* Expanded Dynamic Packing Glass Card */}
            {isPackingOpen && (
              <div 
                className="hud-card" 
                style={{ 
                  position: "absolute", 
                  top: "54px", 
                  right: 0, 
                  width: "360px", 
                  display: "flex", 
                  flexDirection: "column", 
                  gap: "12px", 
                  maxHeight: "360px", 
                  overflowY: "auto",
                  border: "1px solid var(--hud-border)"
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--hud-border)", paddingBottom: "8px" }}>
                  <h4 style={{ fontFamily: "var(--font-heading)", fontSize: "0.95rem", fontWeight: "800" }}>🎒 Trip Packing List</h4>
                  <button onClick={() => setIsPackingOpen(false)} style={{ background: "none", border: "none", color: "var(--hud-text-secondary)", cursor: "pointer" }}><X size={14} /></button>
                </div>
                
                {packingList.length === 0 ? (
                  <p style={{ fontSize: "0.78rem", color: "var(--hud-text-secondary)", textAlign: "center" }}>☀️ Clear summer skies and perfect winds. Just bring your helmet & dynamic hydration!</p>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    {packingList.map((p) => (
                      <div key={p.id} style={{ background: "rgba(255,255,255,0.05)", padding: "10px", borderRadius: "10px", display: "flex", flexDirection: "column", gap: "4px" }}>
                        <span style={{ fontSize: "0.82rem", fontWeight: "700", color: "var(--hud-text-primary)", display: "flex", alignItems: "center", gap: "4px" }}>
                          {p.emoji} {p.item}
                        </span>
                        <span style={{ fontSize: "0.7rem", color: "var(--hud-text-secondary)", lineHeight: "1.4" }}>
                          {p.advice}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 
            -------------------------------------------------------------
            BOTTOM PANEL: DOUBLE-SIDED WEATHER RIBBON
            ------------------------------------------------------------- 
          */}
          <div 
            style={{ 
              position: "absolute", 
              bottom: "20px", 
              left: "20px", 
              right: "20px", 
              width: "calc(100% - 40px)", 
              display: "flex", 
              flexDirection: "column", 
              gap: "10px" 
            }} 
            className="hud-slide-bottom"
          >
            
            {/* The 7-Day Double-Sided Ribbon Container */}
            <div 
              className="hud-card" 
              style={{ 
                padding: "12px", 
                display: "flex", 
                justifyContent: "space-between", 
                alignItems: "center", 
                gap: "8px", 
                width: "100%",
                background: "rgba(15, 23, 42, 0.85)"
              }}
            >
              {ribbonDaysData.map((day) => {
                const isSelected = hudState === 3 && selectedDayOffset === day.offset;
                
                return (
                  <div 
                    key={day.offset} 
                    onClick={() => {
                      setSelectedDayOffset(day.offset);
                      setHudState(3); // Enter Single-Day Scrub state
                    }}
                    style={{ 
                      flex: 1, 
                      borderRadius: "14px", 
                      padding: "8px 6px", 
                      background: isSelected ? "rgba(255,255,255,0.08)" : "transparent",
                      border: isSelected ? "1px solid var(--hud-border-glow)" : "1px solid transparent",
                      cursor: "pointer",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: "6px",
                      transition: "all var(--duration-fluid) var(--ease-premium)"
                    }}
                  >
                    <span style={{ fontSize: "0.74rem", fontWeight: "700", color: isSelected ? "var(--hud-text-primary)" : "var(--hud-text-secondary)" }}>
                      {day.label}
                    </span>

                    {/* DUAL COGNITIVE TRACKS (Top: Outbound, Bottom: Return) */}
                    <div style={{ display: "flex", flexDirection: "column", gap: "4px", width: "100%", alignItems: "center" }}>
                      
                      {/* Outbound Leg Track Segment */}
                      <div style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "0.68rem" }}>
                        <span style={{ color: "var(--hud-text-secondary)" }}>AM</span>
                        <div style={{ 
                          width: "12px", 
                          height: "12px", 
                          borderRadius: "50%", 
                          background: day.outbound.score >= 85 ? "var(--color-emerald)" : day.outbound.score >= 50 ? "var(--color-amber)" : "var(--color-ruby)" 
                        }} />
                      </div>

                      {/* Return Leg Track Segment */}
                      <div style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "0.68rem" }}>
                        <span style={{ color: "var(--hud-text-secondary)" }}>PM</span>
                        <div style={{ 
                          width: "12px", 
                          height: "12px", 
                          borderRadius: "50%", 
                          background: day.return.score >= 85 ? "var(--color-emerald)" : day.return.score >= 50 ? "var(--color-amber)" : "var(--color-ruby)" 
                        }} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* 
              -------------------------------------------------------------
              STATE 3: FLOATING TEMPORAL SCRUBBER TIMELINE
              ------------------------------------------------------------- 
            */}
            {hudState === 3 && (
              <div 
                className="hud-card" 
                style={{ 
                  padding: "10px 16px", 
                  display: "flex", 
                  alignItems: "center", 
                  gap: "16px", 
                  width: "100%", 
                  background: "rgba(15, 23, 42, 0.9)" 
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>
                  <Clock size={14} style={{ color: "var(--hud-text-secondary)" }} />
                  <span style={{ fontSize: "0.78rem", fontWeight: "700", width: "64px" }}>
                    {selectedHour.toString().padStart(2, "0")}:00 {selectedHour >= 12 ? "PM" : "AM"}
                  </span>
                </div>

                {/* Scrubber Range Input */}
                <input 
                  type="range" 
                  min="6" // 6:00 AM
                  max="20" // 8:00 PM
                  value={selectedHour}
                  onChange={(e) => setSelectedHour(parseInt(e.target.value))}
                  style={{ flex: 1, accentColor: "var(--color-emerald)", cursor: "pointer" }}
                />

                <button 
                  onClick={() => setHudState(2)} // Return to Week-wide ambient outlook
                  className="hud-btn" 
                  style={{ padding: "4px 10px" }}
                >
                  <X size={12} />
                  <span>Exit Scrub</span>
                </button>
              </div>
            )}

          </div>
        </div>
      )}
    </div>
  );
}

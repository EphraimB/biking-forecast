"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import dynamic from "next/dynamic";
import { 
  Bike, Plus, Trash2, Calendar, Clock, MapPin, Navigation, 
  Search, ShieldAlert, Sparkles, Sun, Compass, Play, 
  Check, ChevronRight, X, ArrowLeftRight, HelpCircle, 
  Bookmark, Sliders, SunDim, Award, Info, Menu, Edit2, RefreshCw
} from "lucide-react";

import { fetchBicycleRoute, fetchRouteWeather, geocodeAddress, reverseGeocode } from "@/utils/api";
import { decodePolyline6, calculateRouteSegments, sampleCoordinates, getDistance } from "@/utils/routeUtils";
import { calculateCommuteScore, calculateDepartureTimeForArrival, WMO_MAP } from "@/utils/weatherScoring";
import styles from "./page.module.css";

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

function getWindCompassDirection(degrees) {
  const directions = [
    "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", 
    "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"
  ];
  const index = Math.floor((degrees / 22.5) + 0.5) % 16;
  return directions[index];
}

function CustomTimeInput({ value, onChange, unitSystem, isBulk = false }) {
  const [hStr, mStr] = (value || "08:00").split(":");
  let propHour = parseInt(hStr, 10);
  if (isNaN(propHour)) propHour = 8;
  let propMinute = parseInt(mStr, 10);
  if (isNaN(propMinute)) propMinute = 0;

  const getHourDisplayValue = (h) => {
    if (unitSystem === "metric") {
      return h.toString().padStart(2, "0");
    } else {
      const displayHour = h % 12 === 0 ? 12 : h % 12;
      return displayHour.toString().padStart(2, "0");
    }
  };

  const getMinuteDisplayValue = (m) => {
    return m.toString().padStart(2, "0");
  };

  const [prevValue, setPrevValue] = useState(value);
  const [prevUnitSystem, setPrevUnitSystem] = useState(unitSystem);
  const [localHour, setLocalHour] = useState(getHourDisplayValue(propHour));
  const [localMinute, setLocalMinute] = useState(getMinuteDisplayValue(propMinute));

  if (value !== prevValue || unitSystem !== prevUnitSystem) {
    setPrevValue(value);
    setPrevUnitSystem(unitSystem);
    setLocalHour(getHourDisplayValue(propHour));
    setLocalMinute(getMinuteDisplayValue(propMinute));
  }

  const handleLocalHourInputChange = (e) => {
    const val = e.target.value.replace(/\D/g, "");
    setLocalHour(val);
  };

  const handleLocalMinuteInputChange = (e) => {
    const val = e.target.value.replace(/\D/g, "");
    setLocalMinute(val);
  };

  const commitHour = (rawVal) => {
    let newHourNum = parseInt(rawVal, 10);
    if (isNaN(newHourNum)) {
      setLocalHour(getHourDisplayValue(propHour));
      return;
    }

    let finalHour24 = newHourNum;
    if (unitSystem === "metric") {
      newHourNum = Math.max(0, Math.min(23, newHourNum));
      finalHour24 = newHourNum;
    } else {
      newHourNum = Math.max(1, Math.min(12, newHourNum));
      const period = propHour >= 12 ? "PM" : "AM";
      const isPM = period === "PM";
      if (isPM && newHourNum !== 12) finalHour24 = newHourNum + 12;
      else if (!isPM && newHourNum === 12) finalHour24 = 0;
      else finalHour24 = isPM ? newHourNum + 12 : newHourNum;
    }

    const formattedHour = finalHour24.toString().padStart(2, "0");
    const formattedMinute = propMinute.toString().padStart(2, "0");
    setLocalHour(newHourNum.toString().padStart(2, "0"));
    onChange(`${formattedHour}:${formattedMinute}`);
  };

  const commitMinute = (rawVal) => {
    let newMinNum = parseInt(rawVal, 10);
    if (isNaN(newMinNum)) {
      setLocalMinute(getMinuteDisplayValue(propMinute));
      return;
    }

    newMinNum = Math.max(0, Math.min(59, newMinNum));
    const formattedHour = propHour.toString().padStart(2, "0");
    const formattedMinute = newMinNum.toString().padStart(2, "0");
    setLocalMinute(newMinNum.toString().padStart(2, "0"));
    onChange(`${formattedHour}:${formattedMinute}`);
  };

  const handlePeriodChange = (newPeriod) => {
    let new24Hour = propHour;
    const isPM = newPeriod === "PM";
    const currentIsPM = propHour >= 12;
    if (isPM && !currentIsPM) {
      new24Hour = (propHour % 12) + 12;
    } else if (!isPM && currentIsPM) {
      new24Hour = propHour % 12;
    }
    const formattedHour = new24Hour.toString().padStart(2, "0");
    const formattedMinute = propMinute.toString().padStart(2, "0");
    onChange(`${formattedHour}:${formattedMinute}`);
  };

  const inputClass = isBulk ? styles.bulkTimeInput : styles.timeInput;
  const selectClass = isBulk ? styles.bulkTimeSelect : styles.timeSelect;

  if (unitSystem === "metric") {
    return (
      <div style={{ display: "inline-flex", alignItems: "center", gap: "2px" }}>
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={2}
          value={localHour}
          onChange={handleLocalHourInputChange}
          onBlur={(e) => commitHour(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.target.blur();
            }
          }}
          className={inputClass}
        />
        <span style={{ fontSize: "0.72rem", color: "var(--hud-text-secondary)" }}>:</span>
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={2}
          value={localMinute}
          onChange={handleLocalMinuteInputChange}
          onBlur={(e) => commitMinute(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.target.blur();
            }
          }}
          className={inputClass}
        />
      </div>
    );
  } else {
    const period = propHour >= 12 ? "PM" : "AM";
    return (
      <div style={{ display: "inline-flex", alignItems: "center", gap: "2px" }}>
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={2}
          value={localHour}
          onChange={handleLocalHourInputChange}
          onBlur={(e) => commitHour(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.target.blur();
            }
          }}
          className={inputClass}
        />
        <span style={{ fontSize: "0.72rem", color: "var(--hud-text-secondary)" }}>:</span>
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={2}
          value={localMinute}
          onChange={handleLocalMinuteInputChange}
          onBlur={(e) => commitMinute(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.target.blur();
            }
          }}
          className={inputClass}
        />
        <select
          value={period}
          onChange={(e) => handlePeriodChange(e.target.value)}
          className={selectClass}
          style={{ marginLeft: "2px" }}
        >
          <option value="AM" style={{ background: "#0f172a", color: "#f8fafc" }}>AM</option>
          <option value="PM" style={{ background: "#0f172a", color: "#f8fafc" }}>PM</option>
        </select>
      </div>
    );
  }
}

const getCleanLabel = (label) => {
  if (!label) return "";
  if (label.startsWith("(") && label.endsWith(")")) return label;
  return label.split(",")[0];
};

export default function Home() {
  // Hydration & localStorage restoration guard
  const [isRestored, setIsRestored] = useState(false);

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
  const [confirmedStart, setConfirmedStart] = useState(null);
  const [confirmedEnd, setConfirmedEnd] = useState(null);
  const [routeCoordinates, setRouteCoordinates] = useState([]);
  const [routeSegments, setRouteSegments] = useState([]);
  const [weatherResults, setWeatherResults] = useState([]);
  
  // HUD Config Settings (State 1)
  const [newBikeType, setNewBikeType] = useState("Hybrid");
  const [newSpeed, setNewSpeed] = useState(18);

  // Recurring Weekly Commute Schedules (Assign different routes & outbound/return times per day)
  const [weeklySchedule, setWeeklySchedule] = useState({
    1: { routeId: null, outbound: "08:00", return: "17:30" }, // Monday
    2: { routeId: null, outbound: "08:00", return: "17:30" }, // Tuesday
    3: { routeId: null, outbound: "08:00", return: "17:30" }, // Wednesday
    4: { routeId: null, outbound: "08:00", return: "17:30" }, // Thursday
    5: { routeId: null, outbound: "08:00", return: "17:30" }, // Friday
    6: { routeId: null, outbound: "08:00", return: "17:30" }, // Saturday
    0: { routeId: null, outbound: "08:00", return: "17:30" }  // Sunday
  });

  const [isWeeklyPlannerOpen, setIsWeeklyPlannerOpen] = useState(false);
  const [scheduledRoutesWeather, setScheduledRoutesWeather] = useState({});

  // Bulk Scheduling States
  const [bulkRouteId, setBulkRouteId] = useState("");
  const [bulkOutbound, setBulkOutbound] = useState("08:00");
  const [bulkReturn, setBulkReturn] = useState("17:30");
  const [bulkSelectedDays, setBulkSelectedDays] = useState([]);

  // Saved Routes Hub (🔖 Persistence)
  const [savedRoutes, setSavedRoutes] = useState([]);
  const [isSavedHubOpen, setIsSavedHubOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [editingRouteId, setEditingRouteId] = useState(null);
  const [editingRouteName, setEditingRouteName] = useState("");

  // Time & Timeline Scrub Scopes (State 3)
  const [selectedDayOffset, setSelectedDayOffset] = useState(0); // 0 (Today) to 6 (Day + 6)
  const [selectedHour, setSelectedHour] = useState(8); // 6:00 AM to 8:00 PM (commuter scrubber scale)
  const [selectedMinute, setSelectedMinute] = useState(0);
  const [isReturnTripMode, setIsReturnTripMode] = useState(false);
  const [isDepartureTimeCustom, setIsDepartureTimeCustom] = useState(false);
  const [timeMode, setTimeMode] = useState("leave");


  // Dynamic Packing Drawer Scope (🎒 checklist toggle)
  const [isPackingOpen, setIsPackingOpen] = useState(false);
  const [isRiderConfigOpen, setIsRiderConfigOpen] = useState(false);

  // Adaptive Unit Toggle (📐 Metric / Imperial)
  const [unitSystem, setUnitSystem] = useState("metric");

  // Tagged Locations (Home, Work, Custom tags)
  const [taggedLocations, setTaggedLocations] = useState([]);
  const [isEditingCustomStart, setIsEditingCustomStart] = useState(false);
  const [isEditingCustomEnd, setIsEditingCustomEnd] = useState(false);

  const getDisplayNameForLocation = useCallback((loc) => {
    if (!loc) return "";
    if (taggedLocations.length > 0 && loc.lat !== undefined && loc.lon !== undefined) {
      const match = taggedLocations.find(tl => getDistance(tl.lat, tl.lon, loc.lat, loc.lon) < 0.05); // 50m
      if (match) {
        const emojis = { home: "🏠 Home", work: "💼 Work" };
        return emojis[match.tag.toLowerCase()] || `🏷️ ${match.tag}`;
      }
    }
    const label = loc.label || "";
    if (label.startsWith("🏠") || label.startsWith("💼") || label.startsWith("🏷️") || label.startsWith("🎓")) {
      return label.split(" (")[0];
    }
    if (label.startsWith("(") && label.endsWith(")")) return label;
    return label.split(",")[0];
  }, [taggedLocations]);

  const getLabelWithTag = useCallback((loc, taggedLocs = taggedLocations) => {
    if (!loc) return "";
    if (taggedLocs.length > 0 && loc.lat !== undefined && loc.lon !== undefined) {
      const match = taggedLocs.find(tl => getDistance(tl.lat, tl.lon, loc.lat, loc.lon) < 0.05);
      if (match) {
        const emojis = { home: "🏠 Home", work: "💼 Work" };
        const displayTag = emojis[match.tag.toLowerCase()] || `🏷️ ${match.tag}`;
        const cleanLabel = loc.label ? loc.label.split(",")[0] : "";
        return `${displayTag} (${cleanLabel})`;
      }
    }
    return loc.label || "";
  }, [taggedLocations]);

  const saveTaggedLocation = (lat, lon, tag, label) => {
    setTaggedLocations(prev => {
      const filtered = prev.filter(tl => getDistance(tl.lat, tl.lon, lat, lon) >= 0.05);
      let updated;
      if (tag) {
        updated = [...filtered, { lat, lon, tag, label }];
      } else {
        updated = filtered;
      }
      localStorage.setItem("hud_tagged_locations", JSON.stringify(updated));
      return updated;
    });
  };

  const getRouteDisplayName = useCallback((route) => {
    if (!route) return "";
    const startName = getDisplayNameForLocation(route.start);
    const endName = getDisplayNameForLocation(route.end);
    if (!route.name || route.name.includes(" ⇆ ")) {
      return `${startName} ⇆ ${endName}`;
    }
    return route.name;
  }, [getDisplayNameForLocation]);

  const handleToggleTag = (loc, tag, isStart) => {
    if (!loc) return;
    saveTaggedLocation(loc.lat, loc.lon, tag, loc.label);
    
    // Proactively update query string for the input
    const emojis = { home: "🏠 Home", work: "💼 Work" };
    const displayTag = tag ? (emojis[tag.toLowerCase()] || `🏷️ ${tag}`) : null;
    const cleanLabel = loc.label.split(",")[0];
    const newQueryVal = displayTag ? `${displayTag} (${cleanLabel})` : loc.label;
    
    if (isStart) {
      setStartQuery(newQueryVal);
    } else {
      setEndQuery(newQueryVal);
    }
  };

  const getActiveTag = useCallback((loc) => {
    if (!loc || !loc.lat || !loc.lon) return null;
    const match = taggedLocations.find(tl => getDistance(tl.lat, tl.lon, loc.lat, loc.lon) < 0.05);
    return match ? match.tag : null;
  }, [taggedLocations]);

  const startTag = getActiveTag(draftStart);
  const endTag = getActiveTag(draftEnd);

  // Custom Departure overlay time input states
  const [prevSelectedHour, setPrevSelectedHour] = useState(selectedHour);
  const [prevSelectedMinute, setPrevSelectedMinute] = useState(selectedMinute);
  const [prevUnitSystem, setPrevUnitSystem] = useState("metric");

  const getOverlayHourDisplay = (h, currentUnitSystem) => {
    if (currentUnitSystem === "metric") {
      return h.toString().padStart(2, "0");
    } else {
      const displayHour = h % 12 === 0 ? 12 : h % 12;
      return displayHour.toString().padStart(2, "0");
    }
  };

  const getOverlayMinuteDisplay = (m) => {
    return m.toString().padStart(2, "0");
  };

  const [overlayHourVal, setOverlayHourVal] = useState(getOverlayHourDisplay(selectedHour, "metric"));
  const [overlayMinVal, setOverlayMinVal] = useState(getOverlayMinuteDisplay(selectedMinute));

  // Sync local inputs when global states change
  if (selectedHour !== prevSelectedHour || selectedMinute !== prevSelectedMinute || unitSystem !== prevUnitSystem) {
    setPrevSelectedHour(selectedHour);
    setPrevSelectedMinute(selectedMinute);
    setPrevUnitSystem(unitSystem);
    setOverlayHourVal(getOverlayHourDisplay(selectedHour, unitSystem));
    setOverlayMinVal(getOverlayMinuteDisplay(selectedMinute));
  }


  // Helper unit formatting functions
  const formatTemp = (celsius) => {
    if (unitSystem === "imperial") {
      return `${Math.round(celsius * 1.8 + 32)}°F`;
    }
    return `${celsius.toFixed(1)}°C`;
  };

  const formatWind = (kmh) => {
    if (unitSystem === "imperial") {
      return `${Math.round(kmh * 0.621371)} mph`;
    }
    return `${kmh.toFixed(0)} km/h`;
  };

  const formatDistance = (km) => {
    if (unitSystem === "imperial") {
      return `${(km * 0.621371).toFixed(1)} miles`;
    }
    return `${km.toFixed(1)} km`;
  };

  // Ambient Local WeatherHUD Info
  const [userLocation, setUserLocation] = useState(null);
  const [baseWeatherLocationName, setBaseWeatherLocationName] = useState("Resolving GPS...");
  const [ambientWeather, setAmbientWeather] = useState(null);
  const [ambientWeatherForecast, setAmbientWeatherForecast] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);
  const [isRefreshingWeather, setIsRefreshingWeather] = useState(false);
  const [cooldownTime, setCooldownTime] = useState(() => {
    if (typeof window !== "undefined") {
      const cached = localStorage.getItem("weather_429_cooldown_until");
      if (cached && Number(cached) > Date.now()) {
        return Number(cached);
      }
    }
    return 0;
  });
  const [cooldownRemaining, setCooldownRemaining] = useState(() => {
    if (typeof window !== "undefined") {
      const cached = localStorage.getItem("weather_429_cooldown_until");
      if (cached && Number(cached) > Date.now()) {
        return Math.ceil((Number(cached) - Date.now()) / 1000);
      }
    }
    return 0;
  });
  const startGeocodeTimeoutRef = useRef(null);
  const endGeocodeTimeoutRef = useRef(null);
  const mapMoveTimeoutRef = useRef(null);
  const startInputRef = useRef(null);
  const endInputRef = useRef(null);
  const fetchedRouteIdsRef = useRef(new Set());


  // Derived state: weatherLocationName represents active route's starting city or fallback base location
  const activeStartLoc = (hudState === 2 || hudState === 3) ? confirmedStart : draftStart;
  const weatherLocationName = (activeStartLoc && activeStartLoc.label && baseWeatherLocationName !== "Map Viewport")
    ? (getDisplayNameForLocation(activeStartLoc) || "Route Start")
    : baseWeatherLocationName;

  const formatCooldown = (seconds) => {
    if (seconds <= 0) return "0s";
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    if (m > 0) {
      return `${m}m ${s}s`;
    }
    return `${s}s`;
  };

  const handleWeatherResponse = useCallback((weatherData) => {
    if (weatherData && weatherData.isOfflineForecast) {
      const isRateLimit = weatherData.errorType === "429" || (weatherData.errorMessage && String(weatherData.errorMessage).includes("429"));
      
      let cdTime = 0;
      if (isRateLimit) {
        cdTime = weatherData.cooldownUntil || (Date.now() + 120 * 1000);
        setCooldownTime(cdTime);
        localStorage.setItem("weather_429_cooldown_until", cdTime.toString());
        // Do not display a toast notification for rate limit errors as requested by the user
        return weatherData;
      }
      
      setToast(prev => {
        const remaining = cdTime ? Math.max(0, Math.ceil((cdTime - Date.now()) / 1000)) : 0;
        const message = `Weather API offline. Using simulated forecast.`;
          
        const newId = Math.random().toString();
        
        if (prev && prev.message === message) {
          return prev;
        }
        
        return {
          id: newId,
          type: "info",
          message,
          isPersistent: false
        };
      });
    }
    return weatherData;
  }, []);

  const handleShowSimulatedInfo = useCallback((e) => {
    e.stopPropagation();
    setToast({
      id: "toast-429-info",
      type: "warning",
      message: "Daily weather limit reached. Simulated forecast active for the rest of today.",
      isPersistent: false
    });
  }, []);

  const handleRefreshWeather = useCallback(async () => {
    if (isRefreshingWeather) return;
    setIsRefreshingWeather(true);
    
    try {
      if (routeCoordinates && routeCoordinates.length > 0) {
        const distance = routeSegments.reduce((sum, s) => sum + s.distance, 0) || 10;
        const weatherData = await fetchRouteWeather(routeCoordinates, distance, true);
        handleWeatherResponse(weatherData);
        setWeatherResults(weatherData);
        
        const activeRouteId = savedRoutes.find(r => 
          JSON.stringify(r.coordinates) === JSON.stringify(routeCoordinates)
        )?.id;
        if (activeRouteId) {
          setScheduledRoutesWeather(prev => ({
            ...prev,
            [activeRouteId]: {
              coordinates: routeCoordinates,
              segments: routeSegments,
              weather: weatherData
            }
          }));
        }
      } else {
        const lat = activeStartLoc?.lat || userLocation?.lat || 40.7128;
        const lon = activeStartLoc?.lon || userLocation?.lon || -74.0060;
        const dummyCoords = [[lat, lon]];
        const weather = await fetchRouteWeather(dummyCoords, 1, true);
        handleWeatherResponse(weather);
        if (weather && weather.length > 0) {
          const hourly = weather[0]?.hourly;
          const now = new Date();
          const year = now.getFullYear();
          const month = (now.getMonth() + 1).toString().padStart(2, "0");
          const date = now.getDate().toString().padStart(2, "0");
          const hour = now.getHours().toString().padStart(2, "0");
          const currentHourStr = `${year}-${month}-${date}T${hour}:00`;
          
          let currentHourIdx = hourly?.time?.indexOf(currentHourStr);
          if (currentHourIdx === -1 || currentHourIdx === undefined) {
            currentHourIdx = now.getHours();
          }
          
          const resolvedTemp = hourly?.temperature_2m?.[currentHourIdx] ?? 22;
          const resolvedWindSpeed = hourly?.wind_speed_10m?.[currentHourIdx] ?? 12;
          const resolvedWindCompass = getWindCompassDirection(hourly?.wind_direction_10m?.[currentHourIdx] ?? 0);
          
          setAmbientWeather({
            temp: resolvedTemp,
            windSpeed: resolvedWindSpeed,
            windDir: resolvedWindCompass,
            desc: weatherLocationName || "Perfect Local Conditions"
          });
          setAmbientWeatherForecast(weather[0]);
        }
      }
      
      setToast({
        id: Math.random(),
        type: "success",
        message: "Weather forecast refreshed successfully."
      });
    } catch (e) {
      console.error("Refresh weather error:", e);
      setToast({
        id: Math.random(),
        type: "error",
        message: `Failed to refresh weather: ${e.message || "Network error"}`
      });
    } finally {
      setIsRefreshingWeather(false);
    }
  }, [isRefreshingWeather, routeCoordinates, routeSegments, activeStartLoc, userLocation, weatherLocationName, savedRoutes, handleWeatherResponse]);

  // Memoized callback triggers to satisfy strict react-hooks rules and avoid hoisting issues
  const fetchAmbientWeather = useCallback(async (lat, lon) => {
    try {
      const dummyCoords = [[lat, lon]];
      const weather = handleWeatherResponse(await fetchRouteWeather(dummyCoords, 1));
      if (weather && weather.length > 0) {
        const hourly = weather[0]?.hourly;
        
        const now = new Date();
        const year = now.getFullYear();
        const month = (now.getMonth() + 1).toString().padStart(2, "0");
        const date = now.getDate().toString().padStart(2, "0");
        const hour = now.getHours().toString().padStart(2, "0");
        const currentHourStr = `${year}-${month}-${date}T${hour}:00`;
        
        let currentHourIdx = hourly?.time?.indexOf(currentHourStr);
        if (currentHourIdx === -1 || currentHourIdx === undefined) {
          currentHourIdx = now.getHours();
        }
        
        const resolvedTemp = hourly?.temperature_2m?.[currentHourIdx] ?? 22;
        const resolvedWindSpeed = hourly?.wind_speed_10m?.[currentHourIdx] ?? 12;
        const resolvedWindDirDeg = hourly?.wind_direction_10m?.[currentHourIdx] ?? 0;
        const resolvedWindCompass = getWindCompassDirection(resolvedWindDirDeg);

        setAmbientWeather({
          temp: resolvedTemp,
          windSpeed: resolvedWindSpeed,
          windDir: resolvedWindCompass,
          desc: "Perfect Local Conditions"
        });
        setAmbientWeatherForecast(weather[0]);

        console.log(`☀️ [Ambient Weather HUD] Resolved values for coordinates:`, {
          coordinates: { lat, lon },
          matchedTime: currentHourStr,
          arrayIndex: currentHourIdx,
          celsius: `${resolvedTemp.toFixed(1)}°C`,
          fahrenheit: `${Math.round(resolvedTemp * 1.8 + 32)}°F`,
          wind: `${resolvedWindSpeed.toFixed(1)} km/h (${Math.round(resolvedWindSpeed * 0.621371)} mph)`,
          windCompass: `${resolvedWindCompass} (${resolvedWindDirDeg}°)`
        });
      }
    } catch (e) {
      console.error("Ambient weather fetch error:", e);
    }
  }, [handleWeatherResponse]);

  const loadRouteDetails = useCallback(async (start, end, bikeType, speed, overrideState = null, shouldSave = false, saveName = "") => {
    setIsLoading(true);
    setError(null);
    try {
      const routeData = await fetchBicycleRoute(start.lat, start.lon, end.lat, end.lon, bikeType, speed);
      const decodedCoords = decodePolyline6(routeData.shape);
      setRouteCoordinates(decodedCoords);

      const segments = calculateRouteSegments(decodedCoords);
      setRouteSegments(segments);

      const weatherData = handleWeatherResponse(await fetchRouteWeather(decodedCoords, routeData.distance));
      setWeatherResults(weatherData);

      setConfirmedStart(start);
      setConfirmedEnd(end);
      setHudState(overrideState !== null ? overrideState : 2);

      if (shouldSave) {
        const getCleanLabel = (label) => {
          if (!label) return "";
          if (label.startsWith("(") && label.endsWith(")")) return label;
          return label.split(",")[0];
        };
        const cleanStart = getCleanLabel(start.label) || "Start";
        const cleanEnd = getCleanLabel(end.label) || "Destination";
        const name = saveName.trim() || `${cleanStart} ⇆ ${cleanEnd}`;
        const newRoute = {
          id: Date.now().toString(),
          name,
          start,
          end,
          bikeType,
          speed,
          coordinates: decodedCoords,
          segments: segments,
          distance: routeData.distance
        };
        setSavedRoutes(prev => {
          const updated = [...prev, newRoute];
          localStorage.setItem("hud_saved_routes", JSON.stringify(updated));
          return updated;
        });
      }
    } catch (err) {
      console.error(err);
      setError(err.message || "Route validation pipeline failed.");
    } finally {
      setIsLoading(false);
    }
  }, [handleWeatherResponse]);

  const triggerGeocode = useCallback((query, isStart) => {
    if (!query || query.trim().length < 3) {
      if (isStart) {
        setStartResults([]);
        if (startGeocodeTimeoutRef.current) {
          clearTimeout(startGeocodeTimeoutRef.current);
          startGeocodeTimeoutRef.current = null;
        }
      } else {
        setEndResults([]);
        if (endGeocodeTimeoutRef.current) {
          clearTimeout(endGeocodeTimeoutRef.current);
          endGeocodeTimeoutRef.current = null;
        }
      }
      return;
    }

    if (isStart) {
      if (startGeocodeTimeoutRef.current) {
        clearTimeout(startGeocodeTimeoutRef.current);
      }
      startGeocodeTimeoutRef.current = setTimeout(async () => {
        setIsSearchingStart(true);
        try {
          const res = await geocodeAddress(query);
          setStartResults(res || []);
        } catch (err) {
          console.error("Geocoding start address failed:", err);
        } finally {
          setIsSearchingStart(false);
          startGeocodeTimeoutRef.current = null;
        }
      }, 600);
    } else {
      if (endGeocodeTimeoutRef.current) {
        clearTimeout(endGeocodeTimeoutRef.current);
      }
      endGeocodeTimeoutRef.current = setTimeout(async () => {
        setIsSearchingEnd(true);
        try {
          const res = await geocodeAddress(query);
          setEndResults(res || []);
        } catch (err) {
          console.error("Geocoding end address failed:", err);
        } finally {
          setIsSearchingEnd(false);
          endGeocodeTimeoutRef.current = null;
        }
      }, 600);
    }
  }, []);

  // Click outside to close autosuggestions dropdowns
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (startInputRef.current && !startInputRef.current.contains(event.target)) {
        setStartResults([]);
      }
      if (endInputRef.current && !endInputRef.current.contains(event.target)) {
        setEndResults([]);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("touchstart", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
    };
  }, []);

  // Auto-hide toast notification after 6 seconds (if not persistent)
  useEffect(() => {
    if (toast && !toast.isPersistent) {
      const timer = setTimeout(() => {
        setToast(null);
      }, 6000);
      return () => clearTimeout(timer);
    }
  }, [toast]);



  // Cooldown countdown interval
  useEffect(() => {
    if (cooldownTime > Date.now()) {
      const interval = setInterval(() => {
        const left = Math.ceil((cooldownTime - Date.now()) / 1000);
        if (left <= 0) {
          setCooldownRemaining(0);
          setCooldownTime(0);
          localStorage.removeItem("weather_429_cooldown_until");
          clearInterval(interval);
          setToast({
            id: Math.random().toString(),
            type: "success",
            message: "Rate limit cooldown expired. You can now refresh weather data."
          });
        } else {
          setCooldownRemaining(left);
          
          setToast(prev => {
            if (prev && prev.id === "toast-429") {
              const message = `Weather rate limit active. Using offline forecast. Retry in ${formatCooldown(left)}.`;
              if (prev.message === message) return prev;
              return {
                ...prev,
                message
              };
            }
            return prev;
          });
        }
      }, 1000);
      
      return () => clearInterval(interval);
    } else {
      setTimeout(() => {
        setCooldownRemaining(prev => prev === 0 ? 0 : 0);
      }, 0);
    }
  }, [cooldownTime]);

  // 1. Initial Mount: Restore Active View State
  useEffect(() => {
    const handle = setTimeout(() => {
      // Restore weekly schedule and saved routes first
      const savedWeeklySchedule = localStorage.getItem("hud_weekly_schedule");
      if (savedWeeklySchedule) {
        try {
          setWeeklySchedule(JSON.parse(savedWeeklySchedule));
        } catch (e) {
          console.error("Error loading weekly schedule:", e);
        }
      }

      const saved = localStorage.getItem("hud_saved_routes");
      if (saved) {
        try {
          setSavedRoutes(JSON.parse(saved));
        } catch (e) {
          console.error("Error loading saved routes:", e);
        }
      }

      const savedTagged = localStorage.getItem("hud_tagged_locations");
      let loadedTags = [];
      if (savedTagged) {
        try {
          loadedTags = JSON.parse(savedTagged);
          setTaggedLocations(loadedTags);
        } catch (e) {
          console.error("Error loading tagged locations:", e);
        }
      }

      // Restore independent preferences next (rider profile and unit system)
      const savedBikeType = localStorage.getItem("hud_rider_profile_bike_type");
      if (savedBikeType) setNewBikeType(savedBikeType);

      const savedSpeed = localStorage.getItem("hud_rider_profile_speed");
      if (savedSpeed) {
        const parsedSpeed = parseInt(savedSpeed, 10);
        if (!isNaN(parsedSpeed)) setNewSpeed(parsedSpeed);
      }

      const savedUnitSystem = localStorage.getItem("hud_unit_system");
      if (savedUnitSystem) setUnitSystem(savedUnitSystem);

      // Restore Global View-State Caching (Reload Survival)
      const cachedState = localStorage.getItem("hud_active_view_state");
      let restoredHour = false;
      if (cachedState) {
        try {
          const state = JSON.parse(cachedState);
          if (state.selectedDayOffset !== undefined) setSelectedDayOffset(state.selectedDayOffset);
          if (state.selectedHour !== undefined) {
            setSelectedHour(state.selectedHour);
            restoredHour = true;
          }
          if (state.selectedMinute !== undefined) setSelectedMinute(state.selectedMinute);
          if (state.isReturnTripMode !== undefined) setIsReturnTripMode(state.isReturnTripMode);
          if (state.timeMode !== undefined) setTimeMode(state.timeMode);
          
          // Only overwrite if present in view state and not already set by independent keys
          if (state.newBikeType !== undefined && !savedBikeType) setNewBikeType(state.newBikeType);
          if (state.newSpeed !== undefined && !savedSpeed) setNewSpeed(state.newSpeed);
          if (state.unitSystem !== undefined && !savedUnitSystem) setUnitSystem(state.unitSystem);
          
          const startLoc = state.confirmedStart || state.draftStart;
          const endLoc = state.confirmedEnd || state.draftEnd;
          if (startLoc && endLoc && (state.hudState === 2 || state.hudState === 3)) {
            setConfirmedStart(startLoc);
            setConfirmedEnd(endLoc);
            setDraftStart(startLoc);
            setDraftEnd(endLoc);
            setStartQuery(getLabelWithTag(startLoc, loadedTags));
            setEndQuery(getLabelWithTag(endLoc, loadedTags));
            
            // Re-trigger background fetches, maintaining correct visual state
            loadRouteDetails(
              startLoc, 
              endLoc, 
              state.newBikeType || savedBikeType || "Hybrid", 
              state.newSpeed || (savedSpeed ? parseInt(savedSpeed, 10) : 18), 
              state.hudState
            );
          } else {
            setConfirmedStart(null);
            setConfirmedEnd(null);
            setDraftStart(null);
            setDraftEnd(null);
            setStartQuery("");
            setEndQuery("");
            if (state.hudState !== undefined) {
              // Restore only safe base states if no route coordinates exist
              setHudState(state.hudState === 1 ? 0 : state.hudState);
            }
          }
        } catch (err) {
          console.error("View state restoration error: ", err);
        }
      }

      if (!restoredHour) {
        const now = new Date();
        const currentHour = now.getHours();
        setSelectedHour(Math.max(6, Math.min(20, currentHour)));
        const currentMin = now.getMinutes();
        const roundedMin = Math.round(currentMin / 15) * 15 % 60;
        setSelectedMinute(roundedMin);
      }

      // Centered location default ambient lookup
      if (typeof window !== "undefined" && navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (position) => {
            const loc = { lat: position.coords.latitude, lon: position.coords.longitude };
            setUserLocation(loc);
            setBaseWeatherLocationName("Live GPS");
            fetchAmbientWeather(loc.lat, loc.lon);
          },
          () => {
            // Central Park Fallback
            const fallback = { lat: 40.7851, lon: -73.9682 };
            setUserLocation(fallback);
            setBaseWeatherLocationName("Central Park");
            fetchAmbientWeather(fallback.lat, fallback.lon);
          }
        );
      }

      // Set restoration flag complete
      setIsRestored(true);
    }, 0);

    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 2. Global View State Cache Synchronizer (Guarded)
  useEffect(() => {
    if (!isRestored) return;
    const activeState = {
      confirmedStart,
      confirmedEnd,
      draftStart,
      draftEnd,
      selectedDayOffset,
      selectedHour,
      selectedMinute,
      isReturnTripMode,
      timeMode,
      newBikeType,
      newSpeed,
      unitSystem,
      hudState
    };
    localStorage.setItem("hud_active_view_state", JSON.stringify(activeState));
  }, [confirmedStart, confirmedEnd, draftStart, draftEnd, selectedDayOffset, selectedHour, selectedMinute, isReturnTripMode, timeMode, newBikeType, newSpeed, unitSystem, hudState, isRestored]);

  // 3. Persist Rider Profile and Unit System preferences separately
  useEffect(() => {
    if (!isRestored) return;
    localStorage.setItem("hud_rider_profile_bike_type", newBikeType);
    localStorage.setItem("hud_rider_profile_speed", newSpeed.toString());
    localStorage.setItem("hud_unit_system", unitSystem);
  }, [newBikeType, newSpeed, unitSystem, isRestored]);

  // Persist Weekly Schedule Changes
  useEffect(() => {
    localStorage.setItem("hud_weekly_schedule", JSON.stringify(weeklySchedule));
  }, [weeklySchedule]);

  // Update ambient weather dynamically when the planned route's start location changes
  useEffect(() => {
    if (draftStart && draftStart.lat && draftStart.lon) {
      const handle = setTimeout(() => {
        fetchAmbientWeather(draftStart.lat, draftStart.lon);
      }, 0);
      return () => clearTimeout(handle);
    }
  }, [draftStart, fetchAmbientWeather]);

  // Clear search results and geocode timeouts if the route setup panel is closed
  useEffect(() => {
    if (hudState !== 1) {
      const handle = setTimeout(() => {
        setStartResults([]);
        setEndResults([]);
      }, 0);
      if (startGeocodeTimeoutRef.current) {
        clearTimeout(startGeocodeTimeoutRef.current);
        startGeocodeTimeoutRef.current = null;
      }
      if (endGeocodeTimeoutRef.current) {
        clearTimeout(endGeocodeTimeoutRef.current);
        endGeocodeTimeoutRef.current = null;
      }
      return () => clearTimeout(handle);
    }
  }, [hudState]);

  // 4. Custom Departure Overlay Event Handlers (Native React)
  const handleOverlayDayChange = (val) => {
    setSelectedDayOffset(parseInt(val, 10));
    setIsDepartureTimeCustom(true);
  };

  const handleOverlayHourChange = (val) => {
    setSelectedHour(parseInt(val, 10));
    setIsDepartureTimeCustom(true);
  };

  const handleOverlayHour12Change = (val) => {
    setSelectedHour(prev => {
      const isPM = prev >= 12;
      let newHour = parseInt(val, 10) % 12;
      if (isPM) newHour += 12;
      return newHour;
    });
    setIsDepartureTimeCustom(true);
  };

  const handleOverlayMinuteChange = (val) => {
    setSelectedMinute(parseInt(val, 10));
    setIsDepartureTimeCustom(true);
  };

  const handleOverlayPeriodChange = (val) => {
    setSelectedHour(prev => {
      let new24Hour = prev;
      const isPM = val === "PM";
      const currentIsPM = prev >= 12;
      if (isPM && !currentIsPM) {
        new24Hour = (prev % 12) + 12;
      } else if (!isPM && currentIsPM) {
        new24Hour = prev % 12;
      }
      return new24Hour;
    });
    setIsDepartureTimeCustom(true);
  };

  const handleOverlayTimeModeChange = (val) => {
    setTimeMode(val);
    setIsDepartureTimeCustom(true);
  };

  const handleOverlayResetClick = () => {
    const now = new Date();
    setSelectedDayOffset(0);
    setSelectedHour(now.getHours());
    
    const currentMin = now.getMinutes();
    const roundedMin = Math.round(currentMin / 15) * 15 % 60;
    setSelectedMinute(roundedMin);

    setTimeMode("leave");
    setIsDepartureTimeCustom(false);
  };

  const handleOverlayReverseClick = () => {
    if (!confirmedStart || !confirmedEnd) return;
    const oldStart = confirmedStart;
    const oldEnd = confirmedEnd;

    // Physically swap search query values and draft locations
    setDraftStart(oldEnd);
    setDraftEnd(oldStart);
    setStartQuery(getLabelWithTag(oldEnd) || "");
    setEndQuery(getLabelWithTag(oldStart) || "");

    // Physically swap confirmed endpoints
    setConfirmedStart(oldEnd);
    setConfirmedEnd(oldStart);

    // Reset return trip modes and weather results to avoid visual lag
    setIsReturnTripMode(false);
    setWeatherResults([]);

    // Trigger recalculation and fresh Valhalla routing
    loadRouteDetails(oldEnd, oldStart, newBikeType, newSpeed);
  };

  const handleOverlaySaveRouteClick = () => {
    if (!confirmedStart || !confirmedEnd || !routeCoordinates || routeCoordinates.length === 0) return;
    
    const getCleanLabel = (label) => {
      if (!label) return "";
      if (label.startsWith("(") && label.endsWith(")")) return label;
      return label.split(",")[0];
    };
    
    const startLabel = getCleanLabel(confirmedStart.label) || "Start";
    const endLabel = getCleanLabel(confirmedEnd.label) || "Destination";
    const name = `${startLabel} ⇆ ${endLabel}`;
    
    const computedDistance = routeSegments.reduce((sum, seg) => sum + seg.distance, 0);
    const roundedDistance = Math.round(computedDistance * 10) / 10;
    
    const newRoute = {
      id: Date.now().toString(),
      name,
      start: confirmedStart,
      end: confirmedEnd,
      bikeType: newBikeType,
      speed: newSpeed,
      coordinates: routeCoordinates,
      segments: routeSegments,
      distance: roundedDistance
    };

    setSavedRoutes(prev => {
      const updated = [...prev, newRoute];
      localStorage.setItem("hud_saved_routes", JSON.stringify(updated));
      return updated;
    });
  };

  const commitOverlayHour = (rawVal) => {
    let val = parseInt(rawVal, 10);
    if (isNaN(val)) {
      setOverlayHourVal(getOverlayHourDisplay(selectedHour, unitSystem));
      return;
    }
    let new24Hour = val;
    if (unitSystem === "metric") {
      val = Math.max(0, Math.min(23, val));
      new24Hour = val;
    } else {
      val = Math.max(1, Math.min(12, val));
      const isPM = selectedHour >= 12;
      if (isPM && val !== 12) new24Hour = val + 12;
      else if (!isPM && val === 12) new24Hour = 0;
      else new24Hour = isPM ? val + 12 : val;
    }
    setOverlayHourVal(val.toString().padStart(2, "0"));
    setSelectedHour(new24Hour);
    setIsDepartureTimeCustom(true);
  };

  const commitOverlayMinute = (rawVal) => {
    let val = parseInt(rawVal, 10);
    if (isNaN(val)) {
      setOverlayMinVal(getOverlayMinuteDisplay(selectedMinute));
      return;
    }
    val = Math.max(0, Math.min(59, val));
    setOverlayMinVal(val.toString().padStart(2, "0"));
    setSelectedMinute(val);
    setIsDepartureTimeCustom(true);
  };


  const handleDeleteSavedRoute = (id, e) => {
    e.stopPropagation();
    const updated = savedRoutes.filter(r => r.id !== id);
    setSavedRoutes(updated);
    localStorage.setItem("hud_saved_routes", JSON.stringify(updated));

    // Clear weekly binds for this route ID
    const updatedSchedule = { ...weeklySchedule };
    let scheduleChanged = false;
    Object.keys(updatedSchedule).forEach(day => {
      if (updatedSchedule[day].routeId === id) {
        updatedSchedule[day].routeId = null;
        scheduleChanged = true;
      }
    });
    if (scheduleChanged) {
      setWeeklySchedule(updatedSchedule);
    }
  };

  const handleRenameSavedRoute = (id, newName) => {
    if (!newName || !newName.trim()) return;
    const updated = savedRoutes.map(r => {
      if (r.id === id) {
        return { ...r, name: newName.trim() };
      }
      return r;
    });
    setSavedRoutes(updated);
    localStorage.setItem("hud_saved_routes", JSON.stringify(updated));
    setEditingRouteId(null);
  };

  const handleCloseRouteSetup = () => {
    if (routeCoordinates.length > 0 && confirmedStart && confirmedEnd) {
      setHudState(2);
      setDraftStart(confirmedStart);
      setDraftEnd(confirmedEnd);
      setStartQuery(getLabelWithTag(confirmedStart) || "");
      setEndQuery(getLabelWithTag(confirmedEnd) || "");
    } else {
      setHudState(0);
      setConfirmedStart(null);
      setConfirmedEnd(null);
      setDraftStart(null);
      setDraftEnd(null);
      setStartQuery("");
      setEndQuery("");
      setIsDepartureTimeCustom(false);
      setIsReturnTripMode(false);
    }
  };

  const handleLoadSavedRoute = (route) => {
    setDraftStart(route.start);
    setDraftEnd(route.end);
    setConfirmedStart(route.start);
    setConfirmedEnd(route.end);
    setStartQuery(getLabelWithTag(route.start) || "");
    setEndQuery(getLabelWithTag(route.end) || "");
    if (route.bikeType) setNewBikeType(route.bikeType);
    if (route.speed) setNewSpeed(route.speed);
    
    if (route.coordinates && route.coordinates.length > 0 && route.segments && route.segments.length > 0) {
      setWeatherResults([]); // Clear previous weather to prevent stale/incorrect overlay calculations
      setRouteCoordinates(route.coordinates);
      setRouteSegments(route.segments);
      fetchRouteWeather(route.coordinates, route.distance || 10).then(weatherData => {
        handleWeatherResponse(weatherData);
        setWeatherResults(weatherData);
      }).catch(e => console.error("Error fetching weather for loaded route:", e));
      setHudState(2);
    } else {
      loadRouteDetails(route.start, route.end, route.bikeType || newBikeType, route.speed || newSpeed);
    }
    
    setIsSavedHubOpen(false);
  };

  // Modify individual day schedules on scrubbing card (State 3)
  const updateDailySchedule = (dayOffset, field, val) => {
    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() + dayOffset);
    const dayOfWeek = targetDate.getDay();

    const updated = {
      ...weeklySchedule,
      [dayOfWeek]: {
        ...weeklySchedule[dayOfWeek],
        [field]: val
      }
    };
    setWeeklySchedule(updated);
  };

  const applyBulkSchedule = () => {
    if (bulkSelectedDays.length === 0) {
      alert("Please select at least one day of the week.");
      return;
    }
    
    const routeVal = bulkRouteId ? bulkRouteId : null;
    const updatedSchedule = { ...weeklySchedule };
    
    bulkSelectedDays.forEach(day => {
      updatedSchedule[day] = {
        routeId: routeVal,
        outbound: bulkOutbound,
        return: bulkReturn
      };
    });
    
    setWeeklySchedule(updatedSchedule);
    setBulkSelectedDays([]); // Reset day selections after applying
  };

  const deleteGroupSchedule = (daysToClear) => {
    const updatedSchedule = { ...weeklySchedule };
    daysToClear.forEach(day => {
      updatedSchedule[day] = {
        ...updatedSchedule[day],
        routeId: null
      };
    });
    setWeeklySchedule(updatedSchedule);
  };

  const getReturnSegments = (segments) => {
    if (!segments) return [];
    return [...segments].reverse().map(seg => ({
      ...seg,
      lat1: seg.lat2,
      lon1: seg.lon2,
      lat2: seg.lat1,
      lon2: seg.lon1,
      bearing: (seg.bearing + 180) % 360
    }));
  };

  const formatTimeToAMPM = (timeStr) => {
    if (!timeStr) return "";
    const [h, m] = timeStr.split(":").map(Number);
    if (unitSystem === "metric") {
      return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
    }
    const ampm = h >= 12 ? "PM" : "AM";
    const displayH = h % 12 === 0 ? 12 : h % 12;
    const displayM = m.toString().padStart(2, "0");
    return `${displayH}:${displayM} ${ampm}`;
  };

  const getShortLabel = (label) => {
    if (!label) return "";
    const parts = label.split(",");
    if (parts.length > 1 && !isNaN(parts[0].trim())) {
      return `${parts[0].trim()} ${parts[1].trim()}`;
    }
    return parts[0].trim();
  };

  const getSuggestedDeparture = (routeId, day, targetArrivalTimeStr, isReturn = false) => {
    const route = savedRoutes.find(r => r.id === routeId);
    const boundWeatherEntry = scheduledRoutesWeather[routeId];
    if (!route || !boundWeatherEntry) return { timeStr: targetArrivalTimeStr, duration: 0, score: 0 };
    
    // Construct Date object for target arrival
    const targetDate = new Date();
    const currentDay = targetDate.getDay(); // 0 = Sunday, 1 = Monday...
    let dayOffset = day - currentDay;
    if (dayOffset < 0) dayOffset += 7; // Ensure rolling future day
    
    targetDate.setDate(targetDate.getDate() + dayOffset);
    
    const [h, m] = targetArrivalTimeStr.split(":").map(Number);
    targetDate.setHours(h, m, 0, 0);
    
    const segments = isReturn 
      ? getReturnSegments(boundWeatherEntry.segments) 
      : boundWeatherEntry.segments;
      
    // Call utility function
    const result = calculateDepartureTimeForArrival(
      targetDate,
      segments,
      newSpeed,
      isReturn ? [...boundWeatherEntry.weather].reverse() : boundWeatherEntry.weather
    );
    
    // Format departure time
    const depH = result.departureTime.getHours().toString().padStart(2, "0");
    const depM = result.departureTime.getMinutes().toString().padStart(2, "0");
    
    return {
      timeStr: `${depH}:${depM}`,
      duration: result.duration,
      score: result.score
    };
  };

  const getSuggestedArrival = (routeId, day, targetLeaveTimeStr) => {
    const route = savedRoutes.find(r => r.id === routeId);
    const boundWeatherEntry = scheduledRoutesWeather[routeId];
    if (!route || !boundWeatherEntry) return { timeStr: targetLeaveTimeStr, duration: 0 };
    
    // Construct Date object for target departure
    const targetDate = new Date();
    const currentDay = targetDate.getDay();
    let dayOffset = day - currentDay;
    if (dayOffset < 0) dayOffset += 7;
    
    targetDate.setDate(targetDate.getDate() + dayOffset);
    const [h, m] = targetLeaveTimeStr.split(":").map(Number);
    targetDate.setHours(h, m, 0, 0);
    
    const forecastStart = new Date(boundWeatherEntry.weather[0]?.hourly?.time?.[0]);
    const diffMs = targetDate - forecastStart;
    const hourIdx = Math.max(0, Math.min(167, Math.floor(diffMs / (1000 * 60 * 60))));
    
    const commuteDetails = calculateCommuteScore(
      hourIdx,
      getReturnSegments(boundWeatherEntry.segments),
      newSpeed,
      [...boundWeatherEntry.weather].reverse()
    );
    
    const durationMinutes = commuteDetails.duration;
    const arrivalTime = new Date(targetDate.getTime() + durationMinutes * 60 * 1000);
    
    const arrH = arrivalTime.getHours().toString().padStart(2, "0");
    const arrM = arrivalTime.getMinutes().toString().padStart(2, "0");
    
    return {
      timeStr: `${arrH}:${arrM}`,
      duration: durationMinutes,
      score: commuteDetails.score
    };
  };

  // Clear processed prefetch attempts when config or schedule changes
  useEffect(() => {
    fetchedRouteIdsRef.current.clear();
  }, [newBikeType, newSpeed, weeklySchedule]);

  // 3. Background Weather Pre-fetcher for Weekly Scheduled Routes
  useEffect(() => {
    const fetchScheduledWeather = async () => {
      // Find all distinct route IDs in weeklySchedule that are NOT null, and NOT yet attempted in this config run
      const boundRouteIds = Object.values(weeklySchedule)
        .map(s => s?.routeId)
        .filter(id => id && !fetchedRouteIdsRef.current.has(id));
      
      const distinctIds = [...new Set(boundRouteIds)];
      if (distinctIds.length === 0) return;

      const fetchedResults = {};
      let updated = false;

      for (const rid of distinctIds) {
        fetchedRouteIdsRef.current.add(rid); // Mark as attempted immediately to prevent duplicate fetches
        const route = savedRoutes.find(r => r.id === rid);
        if (route) {
          try {
            let coords = route.coordinates;
            let dist = route.distance;
            let segments = route.segments;
            
            // If older route, we fetch routing details
            if (!coords || !dist || !segments) {
              const routeData = await fetchBicycleRoute(
                route.start.lat, 
                route.start.lon, 
                route.end.lat, 
                route.end.lon, 
                newBikeType, 
                newSpeed
              );
              coords = decodePolyline6(routeData.shape);
              dist = routeData.distance;
              segments = calculateRouteSegments(coords);
            }
            
            const wData = handleWeatherResponse(await fetchRouteWeather(coords, dist));
            fetchedResults[rid] = {
              weather: wData,
              coordinates: coords,
              segments: segments,
              distance: dist
            };
            updated = true;
          } catch (e) {
            console.error(`Failed to prefetch weather for route ${rid}:`, e);
          }
        }
      }

      if (updated) {
        setScheduledRoutesWeather(prev => ({
          ...prev,
          ...fetchedResults
        }));
      }
    };

    fetchScheduledWeather();
  }, [weeklySchedule, savedRoutes, newBikeType, newSpeed, handleWeatherResponse]);

  // Compute currently displayed route based on selected day offset schedule
  const getActiveRouteData = () => {
    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() + selectedDayOffset);
    const dayOfWeek = targetDate.getDay();
    
    const daySched = weeklySchedule[dayOfWeek];
    const boundRouteId = daySched?.routeId;
    const boundRoute = savedRoutes.find(r => r.id === boundRouteId);
    const boundWeatherEntry = scheduledRoutesWeather[boundRouteId];

    if (hudState === 3 && boundRoute && boundWeatherEntry) {
      if (isReturnTripMode) {
        return {
          coordinates: [...boundWeatherEntry.coordinates].reverse(),
          segments: getReturnSegments(boundWeatherEntry.segments),
          weatherResults: [...boundWeatherEntry.weather].reverse(),
          startLocation: boundRoute.end,
          endLocation: boundRoute.start,
          speed: newSpeed,
          name: `${boundRoute.name} (Return)`
        };
      }
      return {
        coordinates: boundWeatherEntry.coordinates,
        segments: boundWeatherEntry.segments,
        weatherResults: boundWeatherEntry.weather,
        startLocation: boundRoute.start,
        endLocation: boundRoute.end,
        speed: newSpeed,
        name: boundRoute.name
      };
    }

    const activeWeatherResults = (routeCoordinates && routeCoordinates.length > 0)
      ? weatherResults
      : (ambientWeatherForecast ? [ambientWeatherForecast] : []);

    if (hudState === 3 && isReturnTripMode && routeCoordinates && routeCoordinates.length > 0) {
      return {
        coordinates: [...routeCoordinates].reverse(),
        segments: getReturnSegments(routeSegments),
        weatherResults: [...activeWeatherResults].reverse(),
        startLocation: confirmedEnd || draftEnd,
        endLocation: confirmedStart || draftStart,
        speed: newSpeed,
        name: "Active Route (Return)"
      };
    }

    return {
      coordinates: routeCoordinates,
      segments: routeSegments,
      weatherResults: activeWeatherResults,
      startLocation: confirmedStart || draftStart,
      endLocation: confirmedEnd || draftEnd,
      speed: newSpeed,
      name: "Active Route"
    };
  };

  const activeRouteData = getActiveRouteData();

  // Debounced map viewport move callback for panning updates
  const handleMapMove = useCallback((coord) => {
    if (isLoading) return;

    if (mapMoveTimeoutRef.current) {
      clearTimeout(mapMoveTimeoutRef.current);
    }

    mapMoveTimeoutRef.current = setTimeout(async () => {
      setBaseWeatherLocationName("Map Viewport");
      fetchAmbientWeather(coord.lat, coord.lon);
      mapMoveTimeoutRef.current = null;
    }, 500); // 500ms panning debounce
  }, [fetchAmbientWeather, isLoading]);



  // Get active forecast details for Top HUD bubbles (declared before accessed by packing logic)
  const getActiveForecast = () => {
    if (!activeRouteData || !activeRouteData.segments || activeRouteData.segments.length === 0 || !activeRouteData.weatherResults || activeRouteData.weatherResults.length === 0) return null;
    
    let hourIdx;
    if (hudState === 3 || isDepartureTimeCustom) {
      if (timeMode === "arrive") {
        const totalDist = activeRouteData.segments.reduce((sum, seg) => sum + seg.distance, 0);
        const baseSpeed = activeRouteData.speed || 18;
        const durationMins = (totalDist / baseSpeed) * 60;

        const arrDate = new Date();
        arrDate.setDate(arrDate.getDate() + selectedDayOffset);
        arrDate.setHours(selectedHour, selectedMinute, 0, 0);

        const depDate = new Date(arrDate.getTime() - durationMins * 60 * 1000);
        
        const now = new Date();
        now.setSeconds(0, 0);
        depDate.setSeconds(0, 0);
        
        const diffTime = depDate.getTime() - now.getTime();
        const diffDays = Math.floor(diffTime / (24 * 60 * 60 * 1000));
        const depDayOffset = Math.max(0, diffDays);
        const depHour = depDate.getHours();
        const depMin = depDate.getMinutes();

        hourIdx = depDayOffset * 24 + depHour;
        if (depMin >= 30) {
          hourIdx += 1;
        }
      } else {
        hourIdx = selectedDayOffset * 24 + selectedHour;
        if (selectedMinute >= 30) {
          hourIdx += 1;
        }
      }
      hourIdx = Math.max(0, Math.min(167, hourIdx));
    } else {
      const now = new Date();
      const year = now.getFullYear();
      const month = (now.getMonth() + 1).toString().padStart(2, "0");
      const date = now.getDate().toString().padStart(2, "0");
      const hour = now.getHours().toString().padStart(2, "0");
      const currentHourStr = `${year}-${month}-${date}T${hour}:00`;
      
      const firstHourly = activeRouteData.weatherResults[0]?.hourly;
      let currentHourIdx = firstHourly?.time?.indexOf(currentHourStr);
      if (currentHourIdx === -1 || currentHourIdx === undefined) {
        currentHourIdx = now.getHours();
      }
      hourIdx = currentHourIdx;
    }
    
    return calculateCommuteScore(
      hourIdx, 
      activeRouteData.segments, 
      activeRouteData.speed, 
      activeRouteData.weatherResults
    );
  };

  const getDayLabel = (offset) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    if (offset === 0) return `Today (${d.toLocaleDateString("en-US", { weekday: "short" })})`;
    if (offset === 1) return `Tomorrow (${d.toLocaleDateString("en-US", { weekday: "short" })})`;
    return d.toLocaleDateString("en-US", { weekday: "long" });
  };

  const activeForecast = getActiveForecast();

  const getLeaveNowOverlayData = () => {
    if (!activeForecast) return null;
    
    const duration = activeForecast.duration;
    
    let depDate;
    let label;
    if (hudState === 3 || isDepartureTimeCustom) {
      if (timeMode === "arrive") {
        const arrDate = new Date();
        arrDate.setDate(arrDate.getDate() + selectedDayOffset);
        arrDate.setHours(selectedHour, selectedMinute, 0, 0);
        depDate = new Date(arrDate.getTime() - duration * 60 * 1000);
        label = "Custom Arrival";
      } else {
        depDate = new Date();
        depDate.setDate(depDate.getDate() + selectedDayOffset);
        depDate.setHours(selectedHour, selectedMinute, 0, 0);
        label = hudState === 3
          ? `Trip at ${formatTimeAMPM(depDate)}`
          : "Custom Departure";
      }
    } else {
      depDate = new Date();
      label = "Leave Now";
    }
    
    const arrivalDate = new Date(depDate.getTime() + duration * 60 * 1000);
    const arrivalTimeStr = formatTimeAMPM(arrivalDate);
    const depTimeStr = formatTimeAMPM(depDate);
    
    // Packing list
    const checkHour = depDate.getHours();
    const temp = activeForecast.temp;
    const isRaining = activeForecast.precip > 0.1;
    const isSunset = checkHour > 18 || checkHour < 7;
    
    const items = [];
    items.push("🥤 Fluid");
    items.push("🍌 Fuel");
    if (isRaining) items.push("🧥 Rain Jacket");
    if (temp < 12) items.push("🧣 Warm Gear");
    if (isSunset) items.push("🔦 Lights");
    
    const isImperial = unitSystem === "imperial";
    const displayDist = isImperial
      ? `${Math.round(activeForecast.distance * 0.621371 * 10) / 10} mi`
      : `${activeForecast.distance.toFixed(1)} km`;

    const isSaved = savedRoutes.some(r => 
      r.start && r.end && confirmedStart && confirmedEnd &&
      Math.abs(r.start.lat - confirmedStart.lat) < 0.0001 && 
      Math.abs(r.start.lon - confirmedStart.lon) < 0.0001 && 
      Math.abs(r.end.lat - confirmedEnd.lat) < 0.0001 && 
      Math.abs(r.end.lon - confirmedEnd.lon) < 0.0001
    );

    return {
      duration,
      distance: displayDist,
      depTimeStr,
      arrivalTimeStr,
      label,
      packingList: items.join(", "),
      selectedDayOffset,
      selectedHour,
      selectedMinute,
      isDepartureTimeCustom,
      timeMode,
      isSaved
    };
  };

  // Pure derived state: Packing list calculated synchronously inside render (satisfies react-hooks linter rules)
  const getDynamicPackingList = () => {
    if (!isPackingOpen || activeRouteData.weatherResults.length === 0) return [];
    
    const hourIdx = selectedDayOffset * 24 + selectedHour;
    
    let tempSum = 0;
    let maxPrecip = 0;
    let maxUv = 0;
    let validCount = 0;

    activeRouteData.weatherResults.forEach((station, idx) => {
      const hourly = station?.hourly;
      if (hourly) {
        // Estimate arrival hour index at this station based on progress
        const totalDurationHours = (activeForecast?.duration || 0) / 60;
        const stationTravelDurationHours = totalDurationHours * (idx / Math.max(1, activeRouteData.weatherResults.length - 1));
        const stationHourIdx = Math.max(0, Math.min(167, hourIdx + Math.floor(stationTravelDurationHours)));

        tempSum += hourly.temperature_2m?.[stationHourIdx] ?? 20;
        const pVal = hourly.precipitation?.[stationHourIdx] ?? 0;
        if (pVal > maxPrecip) maxPrecip = pVal;
        const uVal = hourly.uv_index?.[stationHourIdx] ?? 0;
        if (uVal > maxUv) maxUv = uVal;
        validCount++;
      }
    });

    const temp = validCount > 0 ? (tempSum / validCount) : 20;
    const isRaining = maxPrecip > 0.1;
    const uvIndex = maxUv;
    const isSunset = selectedHour > 18 || selectedHour < 7;
    const totalDist = activeRouteData.segments.reduce((sum, seg) => sum + seg.distance, 0);

    const checklist = [];
    const avgHeadwind = activeForecast?.headwind ?? 0;
    
    const waterPerKm = temp > 27 ? (350 / 5) : (350 / 8);
    const totalWaterMl = totalDist * waterPerKm;
    const totalWaterOzs = totalWaterMl * 0.033814;
    
    const carbsPerKm = avgHeadwind > 12 ? (30 / 12) : (30 / 16);
    const totalCarbsG = totalDist * carbsPerKm;
    const totalKcal = totalCarbsG * 4;
    
    const waterDisplay = unitSystem === "imperial"
      ? `${Math.round(totalWaterOzs)} fl oz (${(totalWaterOzs / 20).toFixed(1)} standard bottles)`
      : `${Math.round(totalWaterMl)} ml (${(totalWaterMl / 750).toFixed(1)} bottles)`;
      
    const carbsDisplay = `${Math.round(totalCarbsG)}g Carbs (~${Math.round(totalKcal)} kcal)`;

    checklist.push({
      id: "hydration-pack",
      emoji: "🥤",
      item: `Total Fluid Intake: ${waterDisplay}`,
      advice: `Pack at least ${waterDisplay} of fluid for this ${formatDistance(totalDist)} trip. Calculated sweat rate matches active segment temperature: ${formatTemp(temp)}.`
    });

    checklist.push({
      id: "carbs-pack",
      emoji: "🍌",
      item: `Total Carbohydrates: ${carbsDisplay}`,
      advice: `Carry ${carbsDisplay} of fuel (e.g. gels, chews, or bananas) for this commute. Caloric depletion rate is adjusted for energy expenditure under ${activeForecast?.windImpact || "standard"} wind resistance.`
    });

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

    if (temp < 10) {
      checklist.push({
        id: "temp-cold",
        emoji: "🧤",
        item: "Windproof Thermal Gloves & Neck Gaiter",
        advice: `Chilly weather (${formatTemp(temp)}). Hands lose motor control quickly.`
      });
    } else if (temp > 28) {
      checklist.push({
        id: "temp-hot",
        emoji: "💧",
        item: "Electrolyte Hydration Caps",
        advice: `Extreme heat (${formatTemp(temp)}). Standard water is insufficient to replace salt depletion.`
      });
    }

    if (isSunset) {
      checklist.push({
        id: "sunset-light",
        emoji: "💡",
        item: "Active Blinking Front & Tail Lights",
        advice: "Commuting leg falls under twilight. High visibility required."
      });
    }

    if (totalDist > 20) {
      checklist.push({
        id: "dist-tubes",
        emoji: "🔧",
        item: "Spare Tubes, Lever & CO2 Inflator",
        advice: `Long distance (${formatDistance(totalDist)}). Self-rescue capacity required.`
      });
    }

    return checklist;
  };

  const packingList = getDynamicPackingList();

  const toggleRiderConfig = () => {
    if (!isRiderConfigOpen) {
      setIsWeeklyPlannerOpen(false);
      setIsPackingOpen(false);
      setIsSavedHubOpen(false);
    }
    setIsRiderConfigOpen(!isRiderConfigOpen);
  };

  // Toggle checklist open/closed with mutual exclusion
  const togglePackingList = () => {
    if (!isPackingOpen) {
      setIsWeeklyPlannerOpen(false);
      setIsSavedHubOpen(false);
      setIsRiderConfigOpen(false);
    }
    setIsPackingOpen(!isPackingOpen);
  };

  const toggleWeeklyPlanner = () => {
    if (!isWeeklyPlannerOpen) {
      setIsPackingOpen(false);
      setIsSavedHubOpen(false);
      setIsRiderConfigOpen(false);
    }
    setIsWeeklyPlannerOpen(!isWeeklyPlannerOpen);
  };

  const toggleSavedHub = () => {
    if (!isSavedHubOpen) {
      setIsWeeklyPlannerOpen(false);
      setIsPackingOpen(false);
      setIsRiderConfigOpen(false);
    }
    setIsSavedHubOpen(!isSavedHubOpen);
  };

  // Get dynamic ambient weather based on timeline scrub position
  const getDynamicAmbientWeather = () => {
    const activeWeatherSource = ambientWeatherForecast;

    if (!activeWeatherSource) return ambientWeather;
    const hourly = activeWeatherSource.hourly;
    if (!hourly) return ambientWeather;
    
    let hourIdx;
    if (hudState === 3) {
      hourIdx = selectedDayOffset * 24 + selectedHour;
    } else {
      const now = new Date();
      const year = now.getFullYear();
      const month = (now.getMonth() + 1).toString().padStart(2, "0");
      const date = now.getDate().toString().padStart(2, "0");
      const hour = now.getHours().toString().padStart(2, "0");
      const currentHourStr = `${year}-${month}-${date}T${hour}:00`;
      
      let currentHourIdx = hourly.time?.indexOf(currentHourStr);
      if (currentHourIdx === -1 || currentHourIdx === undefined) {
        currentHourIdx = now.getHours();
      }
      hourIdx = currentHourIdx;
    }

    return {
      temp: hourly.temperature_2m?.[hourIdx] ?? (ambientWeather?.temp ?? 22),
      windSpeed: hourly.wind_speed_10m?.[hourIdx] ?? (ambientWeather?.windSpeed ?? 12),
      windDir: getWindCompassDirection(hourly.wind_direction_10m?.[hourIdx] ?? 0),
      desc: weatherLocationName
    };
  };

  const dynamicAmbientWeather = getDynamicAmbientWeather();


  // 4. Debug Console Logger for Route-Specific Weather and Scores
  useEffect(() => {
    if (!activeForecast || !activeForecast.penalties || !activeRouteData || !activeRouteData.weatherResults || activeRouteData.weatherResults.length === 0) return;

    let hourIdx;
    if (hudState === 3) {
      hourIdx = selectedDayOffset * 24 + selectedHour;
    } else {
      const now = new Date();
      const year = now.getFullYear();
      const month = (now.getMonth() + 1).toString().padStart(2, "0");
      const date = now.getDate().toString().padStart(2, "0");
      const hour = now.getHours().toString().padStart(2, "0");
      const currentHourStr = `${year}-${month}-${date}T${hour}:00`;
      
      const firstHourly = activeRouteData.weatherResults[0]?.hourly;
      let currentHourIdx = firstHourly?.time?.indexOf(currentHourStr);
      if (currentHourIdx === -1 || currentHourIdx === undefined) {
        currentHourIdx = now.getHours(); // Fallback to current local hour index
      }
      hourIdx = currentHourIdx;
    }

    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() + selectedDayOffset);
    const dateFormatted = targetDate.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
    
    const activeHourNumber = hourIdx % 24;
    const timeFormatted = `${activeHourNumber.toString().padStart(2, "0")}:00 ${activeHourNumber >= 12 ? "PM" : "AM"}`;

    const numPoints = activeRouteData.weatherResults.length;
    
    const getDetailedCompassDirection = (deg) => {
      const directions = [
        "North (N)", "North-Northeast (NNE)", "Northeast (NE)", "East-Northeast (ENE)", 
        "East (E)", "East-Southeast (ESE)", "Southeast (SE)", "South-Southeast (SSE)", 
        "South (S)", "South-Southwest (SSW)", "Southwest (SW)", "West-Southwest (WSW)", 
        "West (W)", "West-Northwest (WNW)", "Northwest (NW)", "North-Northwest (NNW)"
      ];
      const val = Math.floor((deg / 22.5) + 0.5);
      return directions[val % 16];
    };

    const stationLogs = activeRouteData.weatherResults.map((station, idx) => {
      const hourly = station?.hourly;
      if (!hourly) return null;
      const temp = hourly.temperature_2m?.[hourIdx] ?? 20;
      const humidity = hourly.relative_humidity_2m?.[hourIdx] ?? 0;
      const windSp = hourly.wind_speed_10m?.[hourIdx] ?? 0;
      const windDi = hourly.wind_direction_10m?.[hourIdx] ?? 0;
      const rain = hourly.precipitation_probability?.[hourIdx] ?? 0;
      const precip = hourly.precipitation?.[hourIdx] ?? 0;
      const wmo = hourly.weather_code?.[hourIdx] ?? 0;
      
      const role = idx === 0 ? "🟢 Route Origin" : idx === numPoints - 1 ? "🔴 Route Destination" : `🟡 Station #${idx + 1}`;
      const compassText = getDetailedCompassDirection(windDi);

      return {
        "Route Station Point": role,
        "Coordinates": `${station.latitude.toFixed(4)}, ${station.longitude.toFixed(4)}`,
        "Temperature": `${temp.toFixed(1)}°C (${Math.round(temp * 1.8 + 32)}°F)`,
        "Humidity": `${humidity}%`,
        "Rain Chance": `${rain}%`,
        "Precipitation": `${precip.toFixed(1)} mm`,
        "Wind Speed": `${windSp.toFixed(1)} km/h (${Math.round(windSp * 0.621371)} mph)`,
        "Wind Direction": `${compassText} (${windDi}°)`,
        "Weather Condition": `${WMO_MAP[wmo]?.desc || "Clear"} ${WMO_MAP[wmo]?.emoji || "☀️"} (Code: ${wmo})`
      };
    }).filter(Boolean);

    console.group(`🚲 [Biking Forecast Debugger] Score and Weather for: ${activeRouteData.name || "Active Route"}`);
    console.log(`📅 Target Time: ${dateFormatted} at ${timeFormatted} (Hour Offset Index: ${hourIdx})`);
    console.log(`📍 Start Location:`, activeRouteData.startLocation?.label || "Unknown");
    console.log(`📍 End Location:`, activeRouteData.endLocation?.label || "Unknown");
    console.log(`⚡ Base Speed: ${activeRouteData.speed} km/h (${Math.round(activeRouteData.speed * 0.621371)} mph)`);
    
    console.group("🌦️ Weather Station Readings along Route (Hourly Interpolations)");
    console.table(stationLogs);
    console.groupEnd();

    console.group("🔢 Suitability Score & Deduction Breakdown");
    console.log(`🎯 Final Suitability Score: ${activeForecast.score}/100`);
    console.log(`📉 Penalty Breakdown:`, {
      "🌡️ Temperature Penalty": `${activeForecast.penalties.temp} pts (Temp: ${activeForecast.temp.toFixed(1)}°C)`,
      "🌧️ Rain/Precip Penalty": `${activeForecast.penalties.rain} pts (Precip: ${activeForecast.precip.toFixed(1)} mm, Prob: ${activeForecast.rainProb}%)`,
      "💨 Wind/Gusts Penalty": `${activeForecast.penalties.wind} pts (Gusts: ${activeForecast.gusts.toFixed(1)} km/h, Avg Headwind: ${activeForecast.headwind.toFixed(1)} km/h)`,
      "☁️ General Weather Penalty": `${activeForecast.penalties.wmo} pts (${activeForecast.wmoEmoji} ${activeForecast.wmoDesc})`
    });
    console.groupEnd();

    console.group("🌬️ Wind Aware Commute Metrics");
    console.log(`💨 Wind Flow Impact: ${activeForecast.windImpact}`);
    console.log(`🚴 Adjusted Average Riding Speed: ${activeForecast.speed.toFixed(1)} km/h (${Math.round(activeForecast.speed * 0.621371)} mph)`);
    console.log(`⏱️ Estimated Ride Duration: ${activeForecast.duration} minutes (Distance: ${activeForecast.distance.toFixed(1)} km)`);
    console.log(`🧭 Average Headwind component: ${activeForecast.headwind.toFixed(1)} km/h (Tailwind if negative)`);
    console.log(`🧭 Average Crosswind component: ${activeForecast.crosswind.toFixed(1)} km/h`);
    console.groupEnd();

    console.groupEnd();
  }, [activeForecast, activeRouteData, selectedDayOffset, selectedHour, hudState]);

  const selectedDayDate = new Date();
  selectedDayDate.setDate(selectedDayDate.getDate() + selectedDayOffset);
  const currentDayOfWeek = selectedDayDate.getDay();

  // Helper to format rolling day names
  const getRollingDayLabel = (offset) => {
    if (offset === 0) return "Today";
    if (offset === 1) return "Tomorrow";
    
    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() + offset);
    return WEEKDAYS_SHORT[targetDate.getDay()];
  };

  // Helper to format a Date object as h:mm A
  const formatTimeAMPM = (dateObj) => {
    const hours = dateObj.getHours();
    const minutes = dateObj.getMinutes();
    if (unitSystem === "metric") {
      return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;
    }
    const ampm = hours >= 12 ? "PM" : "AM";
    const displayH = hours % 12 || 12;
    const displayM = minutes.toString().padStart(2, "0");
    return `${displayH}:${displayM} ${ampm}`;
  };

  // Calculate 7-day commute tracks data for Double-Sided Ribbon
  const get7DayCommuteData = () => {
    const isAnyDayScheduled = Object.values(weeklySchedule).some(sched => sched.routeId !== null);
    if (!isAnyDayScheduled) return [];
    
    const ribbonDays = [];
    for (let offset = 0; offset < 7; offset++) {
      const targetDate = new Date();
      targetDate.setDate(targetDate.getDate() + offset);
      const dayOfWeek = targetDate.getDay(); // 0 = Sunday, 1 = Monday, etc.
      
      const daySched = weeklySchedule[dayOfWeek] || { routeId: null, outbound: "08:00", return: "17:30" };

      let activeCoords = null;
      let activeSegs = null;
      let activeWeather = null;
      let activeSpeed = 18;

      const boundRouteId = daySched.routeId;
      const boundRoute = savedRoutes.find(r => r.id === boundRouteId);
      const boundWeatherEntry = scheduledRoutesWeather[boundRouteId];

      let destinationName = "Destination";
      if (boundRoute) {
        destinationName = getDisplayNameForLocation(boundRoute.end) || "Destination";
      } else if (confirmedEnd || draftEnd) {
        destinationName = getDisplayNameForLocation(confirmedEnd || draftEnd) || "Destination";
      }

      if (boundRoute && boundWeatherEntry) {
        activeCoords = boundWeatherEntry.coordinates;
        activeSegs = boundWeatherEntry.segments;
        activeWeather = boundWeatherEntry.weather;
        activeSpeed = newSpeed;
      } else if (!isAnyDayScheduled && routeCoordinates && routeCoordinates.length > 0 && weatherResults && weatherResults.length > 0) {
        // Fall back to active custom route planned on the map ONLY if there are no days scheduled in the Weekly Commute Planner
        activeCoords = routeCoordinates;
        activeSegs = routeSegments;
        activeWeather = weatherResults;
        activeSpeed = newSpeed;
      }

      if (activeWeather && activeWeather.length > 0) {
        // AM Outbound Calculation
        const outboundTargetDate = new Date();
        outboundTargetDate.setDate(outboundTargetDate.getDate() + offset);
        const [outH, outM] = daySched.outbound.split(":").map(Number);
        outboundTargetDate.setHours(outH, outM, 0, 0);

        const outboundResult = calculateDepartureTimeForArrival(
          outboundTargetDate,
          activeSegs,
          activeSpeed,
          activeWeather
        );

        // PM Return Calculation (reversing segments for PM bearing wind adjustments)
        const returnTargetDate = new Date();
        returnTargetDate.setDate(returnTargetDate.getDate() + offset);
        const [retH, retM] = daySched.return.split(":").map(Number);
        returnTargetDate.setHours(retH, retM, 0, 0);

        const forecastStart = new Date(activeWeather[0]?.hourly?.time?.[0]);
        const diffMs = returnTargetDate - forecastStart;
        const returnHourIdx = Math.max(0, Math.min(167, Math.floor(diffMs / (1000 * 60 * 60))));

        const returnResult = calculateCommuteScore(
          returnHourIdx,
          getReturnSegments(activeSegs),
          activeSpeed,
          [...activeWeather].reverse()
        );

        const arrivalTimeMs = returnTargetDate.getTime() + returnResult.duration * 60 * 1000;
        const arrivalTimeDate = new Date(arrivalTimeMs);

        ribbonDays.push({
          offset,
          label: getRollingDayLabel(offset),
          outbound: {
            score: outboundResult.score,
            duration: outboundResult.duration,
            departure: formatTimeAMPM(outboundResult.departureTime),
            arrival: formatTimeAMPM(outboundTargetDate),
            toLabel: `Outbound to ${destinationName}`
          },
          return: {
            score: returnResult.score,
            duration: returnResult.duration,
            departure: formatTimeAMPM(returnTargetDate),
            arrival: formatTimeAMPM(arrivalTimeDate),
            fromLabel: `Inbound from ${destinationName}`
          },
          routeId: boundRouteId,
          routeName: boundRoute ? boundRoute.name : "Active Route"
        });
      } else {
        ribbonDays.push({
          offset,
          label: getRollingDayLabel(offset),
          outbound: { score: null, duration: 0, departure: null, arrival: null, toLabel: `Outbound to ${destinationName}` },
          return: { score: null, duration: 0, departure: null, arrival: null, fromLabel: `Inbound from ${destinationName}` },
          routeId: boundRouteId,
          routeName: boundRoute ? boundRoute.name : "Active Route"
        });
      }
    }
    return ribbonDays;
  };

  const ribbonDaysData = get7DayCommuteData();

  const getGroupedSchedules = () => {
    const groups = [];
    const processedDays = new Set();
    const order = [1, 2, 3, 4, 5, 6, 0]; // Monday to Sunday order
    
    order.forEach(day => {
      const sched = weeklySchedule[day];
      if (sched && sched.routeId && !processedDays.has(day)) {
        const route = savedRoutes.find(r => r.id === sched.routeId);
        const sameConfigDays = [day];
        
        order.forEach(otherDay => {
          if (otherDay !== day && !processedDays.has(otherDay)) {
            const otherSched = weeklySchedule[otherDay];
            if (
              otherSched && 
              otherSched.routeId === sched.routeId &&
              otherSched.outbound === sched.outbound &&
              otherSched.return === sched.return
            ) {
              sameConfigDays.push(otherDay);
              processedDays.add(otherDay);
            }
          }
        });
        processedDays.add(day);
        
        groups.push({
          days: sameConfigDays,
          routeId: sched.routeId,
          routeName: route ? route.name : "Active Route",
          outbound: sched.outbound,
          return: sched.return
        });
      }
    });
    return groups;
  };

  const groupedSchedules = getGroupedSchedules();

  return (
    <div className={styles.rootPage}>
      
      {/* 
        -------------------------------------------------------------
        CORE MAP VIEWPORT (100% VISIBLE CANVAS BACKDROP)
        ------------------------------------------------------------- 
      */}
      <div className={styles.mapBackdrop}>
        <RouteMap
          coordinates={activeRouteData.coordinates}
          startLocation={activeRouteData.startLocation}
          endLocation={activeRouteData.endLocation}
          routeSegments={activeRouteData.segments}
          weatherResults={activeRouteData.weatherResults}
          selectedDay={selectedDayOffset}
          selectedHour={selectedHour}
          customSpeed={activeRouteData.speed}
          isDrawingMode={hudState === 1}
          hudState={hudState}
          onMapClick={async (coord) => {
            const tempLabel = `(${coord.lat.toFixed(4)}, ${coord.lon.toFixed(4)})`;
            const isStart = !draftStart;
            
            if (hudState !== 1) {
              setHudState(1);
            }
            
            if (isStart) {
              setDraftStart({ ...coord, label: tempLabel });
              setStartQuery(tempLabel);
            } else if (!draftEnd) {
              setDraftEnd({ ...coord, label: tempLabel });
              setEndQuery(tempLabel);
            }

            try {
              const resolved = await reverseGeocode(coord.lat, coord.lon);
              if (resolved) {
                const resolvedLoc = { ...coord, label: resolved };
                const taggedLabel = getLabelWithTag(resolvedLoc);
                if (isStart) {
                  setDraftStart(resolvedLoc);
                  setStartQuery(taggedLabel);
                } else {
                  setDraftEnd(resolvedLoc);
                  setEndQuery(taggedLabel);
                }
              }
            } catch (err) {
              console.error("Reverse geocoding failed:", err);
            }
          }}
          unitSystem={unitSystem}
          userLocation={userLocation}
          ambientWeatherForecast={ambientWeatherForecast}
          onMapMove={handleMapMove}
        />
      </div>

      {/* Premium Glassmorphic Toast Notification */}
      {toast && (
        <div 
          className={`${styles.toastNotification} ${styles[toast.type]}`}
          key={toast.id}
          onClick={(e) => e.stopPropagation()}
        >
          <div className={styles.toastContainer}>
            <div className={styles.toastContent}>
              <span className={styles.toastIcon}>
                {toast.type === "error" && "🚨"}
                {toast.type === "warning" && "⚠️"}
                {toast.type === "success" && "✅"}
                {toast.type === "info" && "ℹ️"}
              </span>
              <span className={styles.toastMessage}>{toast.message}</span>
            </div>
            <button 
              onClick={() => setToast(null)} 
              className={styles.toastCloseBtn}
              title="Dismiss Alert"
            >
              <X size={12} />
            </button>
          </div>
        </div>
      )}

      {/* 
        -------------------------------------------------------------
        STATE 0: AMBIENT STATE / TOP HUD CONTROLS
        ------------------------------------------------------------- 
      */}
      
      {/* Top Controls: Unified Full-Width HUD Container */}
      <div className="hud-top-container">
        
        {/* Left Side: Unified Navigation & Controls Hub */}
        <div className="hud-top-left">
        
          {/* State 0: Enter Route Search bubble */}
          {hudState === 0 && (
            <button 
              className="hud-bubble" 
              onClick={() => setHudState(1)}
              style={{ cursor: "pointer", fontWeight: "600", border: "1px solid rgba(255, 255, 255, 0.1)", display: "flex", alignItems: "center", gap: "8px", pointerEvents: "auto" }}
              title="Plan Custom Route"
            >
              <Search size={16} style={{ color: "var(--hud-text-secondary)" }} />
              <span className="mobile-hide">Enter Route...</span>
            </button>
          )}

          {/* Combined active route weather score bubble inside the departure container header */}

          {/* State 2 & 3: Change Route button */}
          {(hudState === 2 || hudState === 3) && (
            <button 
              className="hud-bubble" 
              onClick={() => setHudState(1)}
              style={{ cursor: "pointer", fontWeight: "600", border: "1px solid rgba(255, 255, 255, 0.1)", display: "flex", alignItems: "center", gap: "8px", pointerEvents: "auto" }}
              title="Change Active Route"
            >
              <Search size={16} style={{ color: "var(--hud-text-secondary)" }} />
              <span className="mobile-hide">Change Route</span>
            </button>
          )}

          {(hudState === 2 || hudState === 3) && activeForecast && (
            <div style={{ position: "relative" }}>
              {/* Gear Check Trigger Button */}
              <button 
                className="hud-bubble" 
                onClick={togglePackingList}
                style={{ cursor: "pointer", border: isPackingOpen ? "1.5px solid var(--color-emerald)" : "1px solid var(--hud-border)", pointerEvents: "auto" }}
              >
                <span>🎒</span>
                <span className="mobile-hide" style={{ fontSize: "0.78rem", fontWeight: "800" }}>GEAR CHECK</span>
              </button>

              {/* Expanded Dynamic Packing Glass Card */}
              {isPackingOpen && (
                <div 
                  className={`${styles.packingDropdown} hud-card hud-card-responsive`}
                  onMouseDown={(e) => e.stopPropagation()}
                  onMouseUp={(e) => e.stopPropagation()}
                  onTouchStart={(e) => e.stopPropagation()}
                  onTouchMove={(e) => e.stopPropagation()}
                  onTouchEnd={(e) => e.stopPropagation()}
                >
                  <div className={styles.packingHeader}>
                    <h4 className={styles.packingTitle}>🎒 Trip Packing List</h4>
                    <button onClick={() => setIsPackingOpen(false)} className={styles.closeBtn}><X size={14} /></button>
                  </div>
                  
                  {packingList.length === 0 ? (
                    <p className={styles.emptyChecklist}>☀️ Clear summer skies and perfect winds. Just bring your helmet & dynamic hydration!</p>
                  ) : (
                    <div className={styles.packingList}>
                      {packingList.map((p) => (
                        <div key={p.id} className={styles.packingItemCard}>
                          <span className={styles.packingItemTitle}>
                            {p.emoji} {p.item}
                          </span>
                          <span className={styles.packingItemAdvice}>
                            {p.advice}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}


          {/* Saved Routes Hub Trigger & Dropdown (Permanently Available in States 0, 2, 3) */}
          {(hudState === 0 || hudState === 2 || hudState === 3) && (
            <div className={isSavedHubOpen ? "" : "desktop-only"} style={{ position: "relative" }}>
              <button 
                className={`hud-bubble desktop-only ${styles.hubBtn}`}
                onClick={toggleSavedHub}
                style={{ 
                  border: isSavedHubOpen ? "1.5px solid var(--color-emerald)" : "1px solid var(--hud-border)"
                }}
                title="Saved Routes Library"
              >
                <Bookmark size={16} style={{ color: isSavedHubOpen ? "var(--color-emerald)" : "var(--hud-text-primary)" }} />
                <span className="mobile-hide" style={{ fontSize: "0.78rem", fontWeight: "800", color: isSavedHubOpen ? "var(--color-emerald)" : "var(--hud-text-primary)" }}>
                  SAVED
                </span>
              </button>

              {/* Saved Routes Dropdown overlay */}
              {isSavedHubOpen && (
                <div 
                  className={`${styles.savedRoutesHubDropdown} hud-card hud-card-responsive`}
                  onMouseDown={(e) => e.stopPropagation()}
                  onMouseUp={(e) => e.stopPropagation()}
                  onTouchStart={(e) => e.stopPropagation()}
                  onTouchMove={(e) => e.stopPropagation()}
                  onTouchEnd={(e) => e.stopPropagation()}
                >
                  <div className={styles.hubDropdownHeader}>
                    <h4 className={styles.hubDropdownTitle}>🔖 Saved Routes</h4>
                    <button onClick={() => setIsSavedHubOpen(false)} className={styles.closeBtn}><X size={14} /></button>
                  </div>
                  {savedRoutes.length === 0 ? (
                    <p className={styles.emptyMsg}>No saved routes yet. Plan a route and save it to display here.</p>
                  ) : (
                    savedRoutes.map((route) => {
                      const isEditing = editingRouteId === route.id;
                      
                      if (isEditing) {
                        return (
                          <div 
                            key={route.id} 
                            className={styles.savedRouteItemEditing}
                            onClick={(e) => e.stopPropagation()}
                            onMouseDown={(e) => e.stopPropagation()}
                            onMouseUp={(e) => e.stopPropagation()}
                          >
                            <input
                              type="text"
                              className={styles.renameInput}
                              value={editingRouteName}
                              onChange={(e) => setEditingRouteName(e.target.value)}
                              onClick={(e) => e.stopPropagation()}
                              onKeyDown={(e) => {
                                e.stopPropagation();
                                if (e.key === "Enter") {
                                  handleRenameSavedRoute(route.id, editingRouteName);
                                } else if (e.key === "Escape") {
                                  setEditingRouteId(null);
                                }
                              }}
                              autoFocus
                            />
                            <div className={styles.editActions}>
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleRenameSavedRoute(route.id, editingRouteName);
                                }}
                                className={styles.saveRouteBtn}
                                title="Save Name"
                              >
                                <Check size={13} />
                              </button>
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditingRouteId(null);
                                }}
                                className={styles.cancelRouteBtn}
                                title="Cancel Editing"
                              >
                                <X size={13} />
                              </button>
                            </div>
                          </div>
                        );
                      }

                      return (
                        <div 
                          key={route.id} 
                          className={`hud-btn ${styles.savedRouteItem}`} 
                          onClick={() => handleLoadSavedRoute(route)}
                        >
                          <span className={styles.savedRouteText}>{getRouteDisplayName(route)}</span>
                          <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                            <button 
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditingRouteId(route.id);
                                setEditingRouteName(route.name);
                              }} 
                              className={styles.editRouteBtn}
                              title="Rename Route"
                            >
                              <Edit2 size={13} />
                            </button>
                            <button 
                              onClick={(e) => handleDeleteSavedRoute(route.id, e)} 
                              className={styles.deleteRouteBtn}
                              title="Delete Route"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          )}

          {/* Weekly Schedule Planner Trigger (Permanently Available in States 0, 2, 3) */}
          {(hudState === 0 || hudState === 2 || hudState === 3) && (
            <button 
              className={`hud-bubble desktop-only ${styles.hubBtn}`}
              onClick={toggleWeeklyPlanner}
              style={{ 
                border: isWeeklyPlannerOpen ? "1.5px solid var(--color-emerald)" : "1px solid var(--hud-border)"
              }}
              title="Weekly Schedule Planner"
            >
              <Calendar size={16} style={{ color: isWeeklyPlannerOpen ? "var(--color-emerald)" : "var(--hud-text-primary)" }} />
              <span style={{ fontSize: "0.78rem", fontWeight: "800", color: isWeeklyPlannerOpen ? "var(--color-emerald)" : "var(--hud-text-primary)" }}>
                WEEKLY<span className="mobile-hide"> PLANNER</span>
              </span>
            </button>
          )}
        </div>

        {/* Right Side: Unit Toggle, Ambient Weather, Gear Check, and Mobile Menu HUD */}
        <div className={`hud-top-right ${styles.topRightControls}`}>
          
          {/* Rider Configuration Bubble (Desktop-only) */}
          <button 
            className={`hud-bubble desktop-only ${styles.riderConfigBtn}`} 
            onClick={toggleRiderConfig}
            style={{ border: isRiderConfigOpen ? "1.5px solid var(--color-emerald)" : "1px solid var(--hud-border)" }}
            title="Rider Profile Configurations"
          >
            <span>🚴</span> <span className="mobile-hide">RIDER PROFILE</span>
          </button>

          {/* Expanded Rider Configurations Glass Card */}
          {isRiderConfigOpen && (
            <div 
              className={`${styles.riderConfigDropdown} hud-card hud-card-responsive`}
              onMouseDown={(e) => e.stopPropagation()}
              onMouseUp={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
              onTouchMove={(e) => e.stopPropagation()}
              onTouchEnd={(e) => e.stopPropagation()}
            >
              <div className={styles.riderHeader}>
                <h4 className={styles.riderTitle}>
                  🚴 Rider Configurator
                </h4>
                <button onClick={() => setIsRiderConfigOpen(false)} className={styles.closeBtn}><X size={14} /></button>
              </div>
              
              {/* Bike Selection */}
              <div className={styles.inputRow}>
                <span className={styles.inputLabel}>Bicycle Profile</span>
                <select 
                  className={`${styles.selectOverride} hud-input`} 
                  value={newBikeType}
                  onChange={(e) => {
                    setNewBikeType(e.target.value);
                    const defaultSpeeds = { Road: 24, Hybrid: 18, Mountain: 16, E_Bike: 25 };
                    setNewSpeed(defaultSpeeds[e.target.value] || 18);
                  }}
                >
                  <option value="Road">🚴 Road Bike</option>
                  <option value="Hybrid">🚲 Hybrid / Commuter</option>
                  <option value="Mountain">🚵 Mountain Bike</option>
                  <option value="E_Bike">⚡ Electric Bike</option>
                </select>
              </div>

              {/* Speed Slider */}
              <div className={styles.inputRow}>
                <div className={styles.speedSliderRow}>
                  <span className={styles.inputLabel}>Base Speed</span>
                  <span>{unitSystem === "imperial" ? `${Math.round(newSpeed * 0.621371)} mph` : `${newSpeed} km/h`}</span>
                </div>
                <input 
                  type="range" 
                  min="10" 
                  max="35" 
                  value={newSpeed}
                  onChange={(e) => setNewSpeed(parseInt(e.target.value))}
                  className={styles.rangeInput}
                />
              </div>
            </div>
          )}

          {/* Metric / Imperial Toggling Bubble (Desktop-only) */}
          <button 
            className={`hud-bubble desktop-only ${styles.unitsBtn}`} 
            onClick={() => setUnitSystem(unitSystem === "metric" ? "imperial" : "metric")}
            title="Switch Units"
          >
            📐 <span className="mobile-hide">{unitSystem === "metric" ? "METRIC" : "IMPERIAL"}</span>
          </button>

          {dynamicAmbientWeather && (
            <div className={`hud-bubble ${styles.weatherBubble}`} title={`Location: ${dynamicAmbientWeather.desc}`}>
              <SunDim size={16} className={styles.sunDimIcon} style={{ animation: "spin 12s linear infinite" }} />
              <span className={styles.weatherText}>
                <span className="mobile-hide" style={{ color: "var(--color-emerald)", fontWeight: "800", marginRight: "4px" }}>
                  {dynamicAmbientWeather.desc}:
                </span>
                {formatTemp(dynamicAmbientWeather.temp)}
                <span> • {formatWind(dynamicAmbientWeather.windSpeed)} {dynamicAmbientWeather.windDir}</span>
                {cooldownRemaining > 0 && (
                  <span 
                    className={styles.cooldownBadge} 
                    onClick={handleShowSimulatedInfo}
                    style={{ cursor: "pointer" }}
                    title="Daily weather limit reached. Simulated forecast active for the rest of today. Tap for more info."
                  >
                    ⚠️ SIMULATED <span className="mobile-hide">(Daily Limit)</span>
                  </span>
                )}
              </span>
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  handleRefreshWeather();
                }} 
                className={`${styles.weatherRefreshBtn} ${isRefreshingWeather ? styles.spinning : ""}`}
                title={cooldownRemaining > 0 ? "Daily weather limit reached. Simulated forecast active for the rest of today." : "Refresh Weather"}
                disabled={isRefreshingWeather || cooldownRemaining > 0}
                style={{ opacity: cooldownRemaining > 0 ? 0.35 : 1, cursor: cooldownRemaining > 0 ? "not-allowed" : "pointer" }}
              >
                <RefreshCw size={12} />
              </button>
            </div>
          )}



          {/* Unified Settings & Menu Trigger Button (Mobile-only) */}
          <button 
            className={`hud-bubble mobile-only`}
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            style={{ border: isMobileMenuOpen ? "1.5px solid var(--color-emerald)" : "1px solid var(--hud-border)" }}
            title="Menu & Settings"
          >
            <Menu size={16} style={{ color: isMobileMenuOpen ? "var(--color-emerald)" : "var(--hud-text-primary)" }} />
          </button>

          {/* Mobile settings menu dropdown card (Mobile-only) */}
          {isMobileMenuOpen && (
            <div 
              className={`${styles.mobileMenuDropdown} hud-card hud-card-responsive`}
              onMouseDown={(e) => e.stopPropagation()}
              onMouseUp={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
              onTouchMove={(e) => e.stopPropagation()}
              onTouchEnd={(e) => e.stopPropagation()}
            >
              <div className={styles.hubDropdownHeader}>
                <h4 className={styles.hubDropdownTitle}>⚙️ Settings & Menu</h4>
                <button onClick={() => setIsMobileMenuOpen(false)} className={styles.closeBtn}><X size={14} /></button>
              </div>

              <div className={styles.mobileMenuList}>
                <button 
                  className={`hud-btn ${styles.mobileMenuItem}`}
                  onClick={() => {
                    setIsMobileMenuOpen(false);
                    setIsWeeklyPlannerOpen(false);
                    setIsPackingOpen(false);
                    setIsRiderConfigOpen(false);
                    setIsSavedHubOpen(!isSavedHubOpen);
                  }}
                  style={{ border: isSavedHubOpen ? "1px solid var(--color-emerald)" : "1px solid rgba(255, 255, 255, 0.08)", width: "100%", textAlign: "left" }}
                >
                  <span style={{ fontSize: "1.1rem" }}>🔖</span> Saved Routes Library
                </button>

                <button 
                  className={`hud-btn ${styles.mobileMenuItem}`}
                  onClick={() => {
                    setIsMobileMenuOpen(false);
                    setIsWeeklyPlannerOpen(!isWeeklyPlannerOpen);
                    setIsPackingOpen(false);
                    setIsRiderConfigOpen(false);
                    setIsSavedHubOpen(false);
                  }}
                  style={{ border: isWeeklyPlannerOpen ? "1px solid var(--color-emerald)" : "1px solid rgba(255, 255, 255, 0.08)", width: "100%", textAlign: "left" }}
                >
                  <span style={{ fontSize: "1.1rem" }}>📅</span> Weekly Commute Planner
                </button>

                <button 
                  className={`hud-btn ${styles.mobileMenuItem}`}
                  onClick={() => {
                    setIsMobileMenuOpen(false);
                    setIsWeeklyPlannerOpen(false);
                    setIsPackingOpen(false);
                    setIsRiderConfigOpen(!isRiderConfigOpen);
                    setIsSavedHubOpen(false);
                  }}
                  style={{ border: isRiderConfigOpen ? "1px solid var(--color-emerald)" : "1px solid rgba(255, 255, 255, 0.08)", width: "100%", textAlign: "left" }}
                >
                  <span style={{ fontSize: "1.1rem" }}>🚴</span> Rider Configurator
                </button>


                <button 
                  className={`hud-btn ${styles.mobileMenuItem}`}
                  onClick={() => {
                    setUnitSystem(unitSystem === "metric" ? "imperial" : "metric");
                  }}
                  style={{ width: "100%", textAlign: "left", border: "1px solid rgba(255, 255, 255, 0.08)" }}
                >
                  <span style={{ fontSize: "1.1rem" }}>📐</span> Units: <strong>{unitSystem === "metric" ? "METRIC" : "IMPERIAL"}</strong>
                </button>
              </div>
            </div>
          )}

        </div>

      </div>

      {/* 
        -------------------------------------------------------------
        STATE 1: ROUTE SETUP INPUT PANEL & SETTINGS
        ------------------------------------------------------------- 
      */}
      {hudState === 1 && (
        <div className={styles.setupCover}>
          
          {/* Centered: Search inputs Bar */}
          <div className={`${styles.setupSearchContainer} hud-slide-top`}>
            <div 
              className={`hud-card ${styles.setupCard}`}
              onMouseDown={(e) => e.stopPropagation()}
              onMouseUp={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
              onTouchMove={(e) => e.stopPropagation()}
              onTouchEnd={(e) => e.stopPropagation()}
            >
              
              <div className={styles.setupHeader}>
                <span className={styles.setupTitle}>Plan Custom Route</span>
                 <button onClick={handleCloseRouteSetup} className={styles.closeBtn}><X size={16} /></button>
              </div>

              {/* Start input */}
              <div ref={startInputRef} className={styles.relativeWrapper}>
                <input 
                  type="text" 
                  className="hud-input" 
                  placeholder="🏡 Enter Start Address..." 
                  value={startQuery}
                  onChange={(e) => {
                    const val = e.target.value;
                    setStartQuery(val);
                    if (draftStart && val !== draftStart.label) {
                      setDraftStart(null);
                    }
                    triggerGeocode(val, true);
                  }}
                />
                {startResults.length > 0 && (
                  <div className={`${styles.setupDropBox} hud-card`}>
                    {startResults.map((loc, idx) => (
                      <div 
                        key={idx} 
                        className={`hud-btn ${styles.setupDropItem}`} 
                        onClick={() => {
                          setDraftStart(loc);
                          setStartQuery(getLabelWithTag(loc));
                          setStartResults([]);
                          if (startGeocodeTimeoutRef.current) {
                            clearTimeout(startGeocodeTimeoutRef.current);
                            startGeocodeTimeoutRef.current = null;
                          }
                        }}
                      >
                        <MapPin size={12} style={{ color: "var(--color-emerald)", flexShrink: 0 }} />
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{loc.label}</span>
                      </div>
                    ))}
                  </div>
                )}
                {draftStart && (
                  <div className={styles.tagSelector}>
                    <span className={styles.tagLabel}>Tag start:</span>
                    <button
                      className={`${styles.tagButton} ${startTag === 'home' ? styles.tagButtonActive : ''}`}
                      onClick={() => handleToggleTag(draftStart, 'home', true)}
                    >
                      🏠 Home
                    </button>
                    <button
                      className={`${styles.tagButton} ${startTag === 'work' ? styles.tagButtonActive : ''}`}
                      onClick={() => handleToggleTag(draftStart, 'work', true)}
                    >
                      💼 Work
                    </button>
                    {isEditingCustomStart ? (
                      <div className={styles.customTagInputWrapper}>
                        <input
                          type="text"
                          className={styles.customTagInput}
                          placeholder="Tag..."
                          defaultValue={startTag && startTag !== 'home' && startTag !== 'work' ? startTag : ''}
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              const val = e.target.value.trim();
                              handleToggleTag(draftStart, val, true);
                              setIsEditingCustomStart(false);
                            } else if (e.key === 'Escape') {
                              setIsEditingCustomStart(false);
                            }
                          }}
                          onBlur={(e) => {
                            const val = e.target.value.trim();
                            if (val) {
                              handleToggleTag(draftStart, val, true);
                            }
                            setIsEditingCustomStart(false);
                          }}
                        />
                      </div>
                    ) : (
                      <button
                        className={`${styles.tagButton} ${startTag && startTag !== 'home' && startTag !== 'work' ? styles.tagButtonActive : ''}`}
                        onClick={() => setIsEditingCustomStart(true)}
                      >
                        🏷️ {startTag && startTag !== 'home' && startTag !== 'work' ? startTag : 'Custom'}
                      </button>
                    )}
                    {startTag && (
                      <button
                        className={styles.tagClearButton}
                        onClick={() => handleToggleTag(draftStart, null, true)}
                        title="Clear Tag"
                      >
                        <X size={12} />
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* End input */}
              <div ref={endInputRef} className={styles.relativeWrapper}>
                <input 
                  type="text" 
                  className="hud-input" 
                  placeholder="🏢 Enter Destination..." 
                  value={endQuery}
                  onChange={(e) => {
                    const val = e.target.value;
                    setEndQuery(val);
                    if (draftEnd && val !== draftEnd.label) {
                      setDraftEnd(null);
                    }
                    triggerGeocode(val, false);
                  }}
                />
                {endResults.length > 0 && (
                  <div className={`${styles.setupDropBox} hud-card`}>
                    {endResults.map((loc, idx) => (
                      <div 
                        key={idx} 
                        className={`hud-btn ${styles.setupDropItem}`} 
                        onClick={() => {
                          setDraftEnd(loc);
                          setEndQuery(getLabelWithTag(loc));
                          setEndResults([]);
                          if (endGeocodeTimeoutRef.current) {
                            clearTimeout(endGeocodeTimeoutRef.current);
                            endGeocodeTimeoutRef.current = null;
                          }
                        }}
                      >
                        <MapPin size={12} style={{ color: "var(--color-emerald)", flexShrink: 0 }} />
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{loc.label}</span>
                      </div>
                    ))}
                  </div>
                )}
                {draftEnd && (
                  <div className={styles.tagSelector}>
                    <span className={styles.tagLabel}>Tag dest:</span>
                    <button
                      className={`${styles.tagButton} ${endTag === 'home' ? styles.tagButtonActive : ''}`}
                      onClick={() => handleToggleTag(draftEnd, 'home', false)}
                    >
                      🏠 Home
                    </button>
                    <button
                      className={`${styles.tagButton} ${endTag === 'work' ? styles.tagButtonActive : ''}`}
                      onClick={() => handleToggleTag(draftEnd, 'work', false)}
                    >
                      💼 Work
                    </button>
                    {isEditingCustomEnd ? (
                      <div className={styles.customTagInputWrapper}>
                        <input
                          type="text"
                          className={styles.customTagInput}
                          placeholder="Tag..."
                          defaultValue={endTag && endTag !== 'home' && endTag !== 'work' ? endTag : ''}
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              const val = e.target.value.trim();
                              handleToggleTag(draftEnd, val, false);
                              setIsEditingCustomEnd(false);
                            } else if (e.key === 'Escape') {
                              setIsEditingCustomEnd(false);
                            }
                          }}
                          onBlur={(e) => {
                            const val = e.target.value.trim();
                            if (val) {
                              handleToggleTag(draftEnd, val, false);
                            }
                            setIsEditingCustomEnd(false);
                          }}
                        />
                      </div>
                    ) : (
                      <button
                        className={`${styles.tagButton} ${endTag && endTag !== 'home' && endTag !== 'work' ? styles.tagButtonActive : ''}`}
                        onClick={() => setIsEditingCustomEnd(true)}
                      >
                        🏷️ {endTag && endTag !== 'home' && endTag !== 'work' ? endTag : 'Custom'}
                      </button>
                    )}
                    {endTag && (
                      <button
                        className={styles.tagClearButton}
                        onClick={() => handleToggleTag(draftEnd, null, false)}
                        title="Clear Tag"
                      >
                        <X size={12} />
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Confirm Route build pipeline */}
              <button 
                className={`${styles.confirmBtn} hud-btn ${draftStart && draftEnd ? "active" : ""}`}
                disabled={!draftStart || !draftEnd || isLoading}
                onClick={() => {
                  loadRouteDetails(draftStart, draftEnd, newBikeType, newSpeed);
                }}
              >
                {isLoading ? "Analyzing..." : "Confirm & Map HUD"}
              </button>

              {/* Direct Pin Tapping Note */}
              <p className={styles.setupNote}>
                💡 Or tap start/end coordinates directly on the map.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* 
        -------------------------------------------------------------
        STATE 2 & 3: CUSTOM DEPARTURE/ARRIVALS SIDEBAR OVERLAY
        ------------------------------------------------------------- 
      */}
      {(hudState === 2 || hudState === 3) && getLeaveNowOverlayData() && (
        <div className={styles.setupCover}>
          <div className={`${styles.departureContainer} hud-slide-top`}>
            <div 
              className={`hud-card ${styles.setupCard}`}
              onMouseDown={(e) => e.stopPropagation()}
              onMouseUp={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
              onTouchMove={(e) => e.stopPropagation()}
              onTouchEnd={(e) => e.stopPropagation()}
            >
              {/* Header: Route Score & Clear Route (Combined) */}
              <div className={styles.setupHeader} style={{ borderBottom: "1px solid rgba(255,255,255,0.08)", paddingBottom: "8px", marginBottom: "8px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <div 
                    className={`${styles.pulseDot} ${activeForecast.score >= 85 ? "hud-pulse-emerald" : activeForecast.score >= 50 ? "hud-pulse-amber" : "hud-pulse-ruby"}`}
                    style={{
                      background: activeForecast.score >= 85 ? "var(--color-emerald)" : activeForecast.score >= 50 ? "var(--color-amber)" : "var(--color-ruby)",
                      boxShadow: `0 0 10px ${activeForecast.score >= 85 ? "var(--color-emerald-glow)" : activeForecast.score >= 50 ? "var(--color-amber-glow)" : "var(--color-ruby-glow)"}`,
                      width: "8px",
                      height: "8px",
                      borderRadius: "50%",
                      flexShrink: 0
                    }} 
                  />
                  <span style={{ fontSize: "0.85rem", fontWeight: "700", display: "flex", alignItems: "center", gap: "4px" }}>
                    Score: {activeForecast.score}% • {activeForecast.wmoEmoji} {activeForecast.wmoDesc}
                  </span>
                </div>
                <button 
                  onClick={() => {
                    setHudState(0);
                    setRouteCoordinates([]);
                    setRouteSegments([]);
                    setWeatherResults([]);
                    setConfirmedStart(null);
                    setConfirmedEnd(null);
                    setDraftStart(null);
                    setDraftEnd(null);
                    setStartQuery("");
                    setEndQuery("");
                    setIsDepartureTimeCustom(false);
                    setIsReturnTripMode(false);
                    localStorage.removeItem("hud_active_view_state"); // Clear cached route state on manual reset
                  }} 
                  className={styles.clearRouteBtn}
                  style={{
                    background: "none",
                    border: "none",
                    color: "var(--hud-text-secondary)",
                    cursor: "pointer",
                    padding: "4px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    transition: "color 0.2s ease"
                  }}
                  onMouseOver={(e) => e.currentTarget.style.color = "var(--color-ruby)"}
                  onMouseOut={(e) => e.currentTarget.style.color = "var(--hud-text-secondary)"}
                  title="Clear Route"
                >
                  <X size={14} />
                </button>
              </div>

              {/* Departure Mode Title & Reset */}
              <div className={styles.setupHeader} style={{ marginBottom: "6px" }}>
                <span className={styles.setupTitle} style={{ color: "#ef4444", display: "flex", alignItems: "center", gap: "6px", fontSize: "0.82rem" }}>
                  🏁 {getLeaveNowOverlayData().isDepartureTimeCustom ? (getLeaveNowOverlayData().timeMode === "arrive" ? "Custom Arrival" : "Custom Departure") : "Leave Now"}
                </span>
                {getLeaveNowOverlayData().isDepartureTimeCustom && (
                  <button 
                    onClick={handleOverlayResetClick} 
                    className={styles.overlayResetBtn}
                    style={{
                      background: "none",
                      border: "none",
                      color: "var(--color-amber)",
                      textDecoration: "underline",
                      cursor: "pointer",
                      padding: 0,
                      fontSize: "10px",
                    }}
                  >
                    Reset to Now
                  </button>
                )}
              </div>

              {/* Leave / Arrive Segmented Control */}
              <div style={{
                display: "flex",
                background: "rgba(0,0,0,0.3)",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: "8px",
                padding: "2px",
                marginBottom: "2px"
              }}>
                <button 
                  onClick={() => handleOverlayTimeModeChange('leave')} 
                  style={{
                    flex: 1,
                    background: getLeaveNowOverlayData().timeMode === "leave" ? "rgba(255, 255, 255, 0.12)" : "transparent",
                    border: "none",
                    borderRadius: "6px",
                    color: getLeaveNowOverlayData().timeMode === "leave" ? "var(--color-emerald)" : "var(--hud-text-secondary)",
                    fontSize: "11px",
                    fontWeight: 700,
                    padding: "6px",
                    cursor: "pointer",
                    transition: "all 0.2s ease",
                    outline: "none",
                  }}
                >
                  Leave At
                </button>
                <button 
                  onClick={() => handleOverlayTimeModeChange('arrive')} 
                  style={{
                    flex: 1,
                    background: getLeaveNowOverlayData().timeMode === "arrive" ? "rgba(255, 255, 255, 0.12)" : "transparent",
                    border: "none",
                    borderRadius: "6px",
                    color: getLeaveNowOverlayData().timeMode === "arrive" ? "var(--color-emerald)" : "var(--hud-text-secondary)",
                    fontSize: "11px",
                    fontWeight: 700,
                    padding: "6px",
                    cursor: "pointer",
                    transition: "all 0.2s ease",
                    outline: "none",
                  }}
                >
                  Arrive At
                </button>
              </div>

              {/* Date & Time Selectors Row */}
              <div style={{ display: "flex", gap: "6px", alignItems: "center", width: "100%" }}>
                <select 
                  value={selectedDayOffset}
                  onChange={(e) => handleOverlayDayChange(e.target.value)} 
                  className={styles.timeSelect}
                  style={{
                    flex: 1.5,
                    fontSize: "11px",
                    padding: "5px 6px",
                  }}
                >
                  {Array.from({ length: 7 }).map((_, offset) => {
                    const label = getDayLabel(offset);
                    return (
                      <option key={offset} value={offset} style={{ background: "#0f172a", color: "#f8fafc" }}>
                        {label}
                      </option>
                    );
                  })}
                </select>
                
                <div style={{ display: "flex", gap: "4px", alignItems: "center", flex: 2, justifyContent: "flex-end" }}>
                  <input 
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={2}
                    value={overlayHourVal}
                    onChange={(e) => setOverlayHourVal(e.target.value.replace(/\D/g, ''))}
                    onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); e.stopPropagation(); }}
                    onKeyUp={(e) => e.stopPropagation()}
                    onKeyPress={(e) => e.stopPropagation()}
                    onBlur={(e) => commitOverlayHour(e.target.value)}
                    className={styles.timeInput}
                    style={{
                      fontSize: "11px",
                      padding: "5px 3px",
                      width: "28px",
                    }}
                  />
                  <span style={{ color: "var(--hud-text-secondary)", fontSize: "11px" }}>:</span>
                  <input 
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={2}
                    value={overlayMinVal}
                    onChange={(e) => setOverlayMinVal(e.target.value.replace(/\D/g, ''))}
                    onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); e.stopPropagation(); }}
                    onKeyUp={(e) => e.stopPropagation()}
                    onKeyPress={(e) => e.stopPropagation()}
                    onBlur={(e) => commitOverlayMinute(e.target.value)}
                    className={styles.timeInput}
                    style={{
                      fontSize: "11px",
                      padding: "5px 3px",
                      width: "28px",
                    }}
                  />
                  {unitSystem === "imperial" && (
                    <select 
                      value={selectedHour >= 12 ? "PM" : "AM"}
                      onChange={(e) => handleOverlayPeriodChange(e.target.value)} 
                      className={styles.timeSelect}
                      style={{
                        fontSize: "11px",
                        padding: "5px 6px",
                        flex: 1.1,
                      }}
                    >
                      <option value="AM" style={{ background: "#0f172a", color: "#f8fafc" }}>AM</option>
                      <option value="PM" style={{ background: "#0f172a", color: "#f8fafc" }}>PM</option>
                    </select>
                  )}
                </div>
              </div>

              {/* Telemetry info */}
              <div style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "11px", borderTop: "1px solid rgba(255, 255, 255, 0.08)", paddingTop: "8px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <span>⏱️</span>
                  <span><strong>Ride</strong>: {getLeaveNowOverlayData().duration} mins ({getLeaveNowOverlayData().distance})</span>
                </div>
                {getLeaveNowOverlayData().timeMode === "arrive" ? (
                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <span>🚀</span>
                    <span><strong>Depart by</strong>: {getLeaveNowOverlayData().depTimeStr}</span>
                  </div>
                ) : (
                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <span>⏰</span>
                    <span><strong>Arrival</strong>: {getLeaveNowOverlayData().arrivalTimeStr}</span>
                  </div>
                )}
              </div>

              {/* Actions Row */}
              <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: "8px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" }}>
                {getLeaveNowOverlayData().isSaved ? (
                  <button 
                    disabled 
                    className="hud-btn"
                    style={{
                      background: "rgba(255,255,255,0.05)",
                      border: "1px solid rgba(255,255,255,0.1)",
                      color: "var(--hud-text-secondary)",
                      fontSize: "10px",
                      fontWeight: 700,
                      padding: "4px 8px",
                      cursor: "not-allowed",
                      borderRadius: "6px"
                    }}
                  >
                    ✓ Bookmarked
                  </button>
                ) : (
                  <button 
                    onClick={handleOverlaySaveRouteClick} 
                    className="hud-btn"
                    style={{
                      background: "rgba(255, 255, 255, 0.1)",
                      border: "1px solid rgba(255, 255, 255, 0.2)",
                      color: "var(--hud-text-primary)",
                      fontSize: "10px",
                      fontWeight: 700,
                      padding: "4px 8px",
                      cursor: "pointer",
                      borderRadius: "6px",
                      transition: "all 0.2s ease",
                    }}
                  >
                    💾 Save Route
                  </button>
                )}
                <button 
                  onClick={handleOverlayReverseClick} 
                  className="hud-btn"
                  style={{
                    background: "var(--color-emerald)",
                    border: "none",
                    borderRadius: "6px",
                    color: "white",
                    fontSize: "10px",
                    fontWeight: 700,
                    padding: "4px 8px",
                    cursor: "pointer",
                    boxShadow: "0 2px 6px rgba(16, 185, 129, 0.3)",
                  }}
                >
                  ⇅ Reverse Route
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 
        -------------------------------------------------------------
        STATES 2 & 3: COMMUTE 7-DAY OUTLOOK RIBBON & scrubber
        ------------------------------------------------------------- 
      */}
      {/* 7-Day Biking Commute Forecast Ribbon (Always Visible in States 0, 2, 3) */}
      {(hudState === 0 || hudState === 2 || hudState === 3) && ribbonDaysData.length > 0 && (
        <div className={styles.ribbonOuter}>
          <div className={styles.ribbonHeaderRow}>
            <span className={styles.ribbonTitle}>
              🚴 7-Day Commuter Biking Forecast
            </span>
          </div>

          <div 
            className={`${styles.ribbonBox} hud-card`}
            onMouseDown={(e) => e.stopPropagation()}
            onMouseUp={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
            onTouchMove={(e) => e.stopPropagation()}
            onTouchEnd={(e) => e.stopPropagation()}
          >
            {ribbonDaysData.map((day) => {
              const isSelected = hudState === 3 && selectedDayOffset === day.offset;
              const hasOutbound = day.outbound && day.outbound.departure !== null && day.outbound.score !== null;
              const hasReturn = day.return && day.return.departure !== null && day.return.score !== null;
              
              return (
                <div 
                  key={day.offset} 
                  className={`${styles.ribbonItem} ${isSelected ? "selected" : ""}`}
                  onClick={() => {
                    if (hasOutbound || hasReturn) {
                      setSelectedDayOffset(day.offset);
                      setHudState(3); // Enter Single-Day Scrub state
                      
                      // Default snap: Outbound AM hour
                      const targetDate = new Date();
                      targetDate.setDate(targetDate.getDate() + day.offset);
                      const dayOfWeek = targetDate.getDay();
                      const daySched = weeklySchedule[dayOfWeek] || { outbound: "08:00", return: "17:30" };
                      const outboundHour = parseInt(daySched.outbound.split(":")[0]);
                      setSelectedHour(outboundHour);
                      setIsReturnTripMode(false);
                    } else {
                      // Helpfully prompt route setup
                      setHudState(1);
                    }
                  }}
                  style={{ 
                    background: isSelected ? "rgba(255,255,255,0.08)" : "transparent",
                    border: isSelected ? "1px solid var(--hud-border-glow)" : "1px solid transparent"
                  }}
                >
                  <span className={styles.ribbonItemLabel} style={{ color: isSelected ? "var(--hud-text-primary)" : "var(--hud-text-secondary)" }}>
                    {day.label}
                  </span>

                  {/* DUAL RIDE TRACKS (Top: Outbound AM, Bottom: Return PM) */}
                  <div className={styles.tracksCol}>
                    
                    {/* AM Outbound Biking Forecast */}
                    <div 
                      onClick={(e) => {
                        if (hasOutbound || hasReturn) {
                          e.stopPropagation();
                          setSelectedDayOffset(day.offset);
                          setHudState(3);
                          const targetDate = new Date();
                          targetDate.setDate(targetDate.getDate() + day.offset);
                          const dayOfWeek = targetDate.getDay();
                          const daySched = weeklySchedule[dayOfWeek] || { outbound: "08:00", return: "17:30" };
                          const outboundHour = parseInt(daySched.outbound.split(":")[0]);
                          setSelectedHour(outboundHour);
                          setIsReturnTripMode(false);
                        } else {
                          setHudState(1);
                        }
                      }}
                      className={styles.trackCard}
                    >
                      <div className={styles.trackHeaderRow}>
                        <span style={{ color: "var(--hud-text-secondary)", fontSize: "0.6rem" }}>🌅 Outbound</span>
                        {hasOutbound ? (
                          <span 
                            className={styles.scoreBadge}
                            style={{ 
                              background: day.outbound.score >= 85 ? "rgba(16,185,129,0.15)" : day.outbound.score >= 50 ? "rgba(245,158,11,0.15)" : "rgba(239,68,68,0.15)",
                              color: day.outbound.score >= 85 ? "var(--color-emerald)" : day.outbound.score >= 50 ? "var(--color-amber)" : "var(--color-ruby)"
                            }}
                          >
                            {day.outbound.score}%
                          </span>
                        ) : (
                          <span style={{ color: "var(--hud-text-secondary)", fontSize: "0.6rem" }}>--</span>
                        )}
                      </div>
                      {hasOutbound ? (
                        <>
                          <div className={styles.trackTime}>
                            {day.outbound.departure.replace(" AM", "a").replace(" PM", "p")}
                            <span className="mobile-hide"> → {day.outbound.arrival.replace(" AM", "a").replace(" PM", "p")}</span>
                          </div>
                          <div className={styles.trackDuration}>
                            {day.outbound.duration} min ride
                          </div>
                        </>
                      ) : (
                        <div className={styles.trackEmpty}>
                          {day.routeId ? "Loading..." : "No Route"}
                        </div>
                      )}
                    </div>

                    {/* PM Return Biking Forecast */}
                    <div 
                      onClick={(e) => {
                        if (hasOutbound || hasReturn) {
                          e.stopPropagation();
                          setSelectedDayOffset(day.offset);
                          setHudState(3);
                          const targetDate = new Date();
                          targetDate.setDate(targetDate.getDate() + day.offset);
                          const dayOfWeek = targetDate.getDay();
                          const daySched = weeklySchedule[dayOfWeek] || { outbound: "08:00", return: "17:30" };
                          const returnHour = parseInt(daySched.return.split(":")[0]);
                          setSelectedHour(returnHour);
                          setIsReturnTripMode(true);
                        } else {
                          setHudState(1);
                        }
                      }}
                      className={styles.trackCard}
                    >
                      <div className={styles.trackHeaderRow}>
                        <span style={{ color: "var(--hud-text-secondary)", fontSize: "0.6rem" }}>🌇 Inbound</span>
                        {hasReturn ? (
                          <span 
                            className={styles.scoreBadge}
                            style={{ 
                              background: day.return.score >= 85 ? "rgba(16,185,129,0.15)" : day.return.score >= 50 ? "rgba(245,158,11,0.15)" : "rgba(239,68,68,0.15)",
                              color: day.return.score >= 85 ? "var(--color-emerald)" : day.return.score >= 50 ? "var(--color-amber)" : "var(--color-ruby)"
                            }}
                          >
                            {day.return.score}%
                          </span>
                        ) : (
                          <span style={{ color: "var(--hud-text-secondary)", fontSize: "0.6rem" }}>--</span>
                        )}
                      </div>
                      {hasReturn ? (
                        <>
                          <div className={styles.trackTime}>
                            {day.return.departure.replace(" AM", "a").replace(" PM", "p")}
                            <span className="mobile-hide"> → {day.return.arrival.replace(" AM", "a").replace(" PM", "p")}</span>
                          </div>
                          <div className={styles.trackDuration}>
                            {day.return.duration} min ride
                          </div>
                        </>
                      ) : (
                        <div className={styles.trackEmpty}>
                          {day.routeId ? "Loading..." : "No Route"}
                        </div>
                      )}
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
              className={`${styles.scrubberContainer} hud-card timeline-scrubber-container`}
              onMouseDown={(e) => e.stopPropagation()}
              onMouseUp={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
              onTouchMove={(e) => e.stopPropagation()}
              onTouchEnd={(e) => e.stopPropagation()}
            >
              {/* Timeline Scrubber */}
              <div style={{ display: "flex", alignItems: "center", gap: "10px", flex: 1, flexWrap: "wrap" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>
                  <Clock size={14} style={{ color: "var(--hud-text-secondary)" }} />
                  <span style={{ fontSize: "0.78rem", fontWeight: "700", width: "64px" }}>
                    {unitSystem === "metric" 
                      ? `${selectedHour.toString().padStart(2, "0")}:00` 
                      : `${selectedHour % 12 === 0 ? 12 : selectedHour % 12}:00 ${selectedHour >= 12 ? "PM" : "AM"}`}
                  </span>
                </div>

                {/* Outbound / Return Quick Snapper Toggle */}
                <div className={styles.quickSnapperToggle}>
                  <button 
                    onClick={() => {
                      const daySched = weeklySchedule[currentDayOfWeek] || { outbound: "08:00", return: "17:30" };
                      const outboundHour = parseInt(daySched.outbound.split(":")[0]);
                      setSelectedHour(outboundHour);
                      setIsReturnTripMode(false);
                    }}
                    style={{ 
                      background: !isReturnTripMode ? "var(--color-emerald)" : "transparent",
                      border: "none",
                      borderRadius: "6px",
                      color: "var(--hud-text-primary)",
                      fontSize: "0.68rem",
                      fontWeight: "800",
                      padding: "4px 8px",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: "4px",
                      transition: "all var(--duration-fluid) var(--ease-premium)"
                    }}
                  >
                    🌅 Outbound
                  </button>
                  <button 
                    onClick={() => {
                      const daySched = weeklySchedule[currentDayOfWeek] || { outbound: "08:00", return: "17:30" };
                      const returnHour = parseInt(daySched.return.split(":")[0]);
                      setSelectedHour(returnHour);
                      setIsReturnTripMode(true);
                    }}
                    style={{ 
                      background: isReturnTripMode ? "var(--color-emerald)" : "transparent",
                      border: "none",
                      borderRadius: "6px",
                      color: "var(--hud-text-primary)",
                      fontSize: "0.68rem",
                      fontWeight: "800",
                      padding: "4px 8px",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: "4px",
                      transition: "all var(--duration-fluid) var(--ease-premium)"
                    }}
                  >
                    🌇 Inbound
                  </button>
                </div>

                {/* Scrubber Range Input */}
                <input 
                  type="range" 
                  min="6" // 6:00 AM
                  max="20" // 8:00 PM
                  value={selectedHour}
                  onChange={(e) => setSelectedHour(parseInt(e.target.value))}
                  className={styles.rangeScrubber}
                />
              </div>

              {/* Independent Day Schedule Config Inputs */}
              <div className={`${styles.timeInputsGroup} time-inputs-group`}>
                <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                  <span style={{ fontSize: "0.68rem", color: "var(--hud-text-secondary)" }}>Outbound:</span>
                  <CustomTimeInput 
                    value={weeklySchedule[currentDayOfWeek]?.outbound || "08:00"}
                    onChange={(val) => updateDailySchedule(selectedDayOffset, 'outbound', val)}
                    unitSystem={unitSystem}
                  />
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                  <span style={{ fontSize: "0.68rem", color: "var(--hud-text-secondary)" }}>Return:</span>
                  <CustomTimeInput 
                    value={weeklySchedule[currentDayOfWeek]?.return || "17:30"}
                    onChange={(val) => updateDailySchedule(selectedDayOffset, 'return', val)}
                    unitSystem={unitSystem}
                  />
                </div>
              </div>

              {/* Exit day focus button */}
              <button 
                onClick={() => setHudState(routeCoordinates.length > 0 ? 2 : 0)} // Return to Week-wide ambient outlook or Ambient map
                className={`hud-btn ${styles.exitScrubBtn}`}
              >
                <X size={12} />
                <span>Exit Scrub</span>
              </button>
            </div>
          )}

        </div>
      )}

      {/* Weekly Commute Planner HUD Sliding/Overlay Card */}
      {isWeeklyPlannerOpen && (
        <div 
          className={`${styles.weeklyPlannerPanel} hud-card hud-card-responsive`}
          onMouseDown={(e) => e.stopPropagation()}
          onMouseUp={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          onTouchMove={(e) => e.stopPropagation()}
          onTouchEnd={(e) => e.stopPropagation()}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--hud-border)", paddingBottom: "10px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <Calendar size={18} style={{ color: "var(--color-emerald)" }} />
              <h4 style={{ fontFamily: "var(--font-heading)", fontSize: "1rem", fontWeight: "800" }}>📅 Weekly Commute Planner</h4>
            </div>
            <button onClick={() => setIsWeeklyPlannerOpen(false)} className={styles.closeBtn}><X size={16} /></button>
          </div>

          <p style={{ fontSize: "0.74rem", color: "var(--hud-text-secondary)", lineHeight: "1.45" }}>
            Build your weekly commute schedule. Add routes, AM/PM times, and assign them to multiple days in one click.
          </p>

          {/* Quick Bulk Scheduler Form */}
          <div style={{ background: "rgba(255,255,255,0.05)", padding: "12px", borderRadius: "14px", border: "1px solid rgba(255,255,255,0.1)", display: "flex", flexDirection: "column", gap: "10px" }}>
            <span style={{ fontSize: "0.82rem", fontWeight: "800", color: "var(--color-emerald)", display: "flex", alignItems: "center", gap: "4px" }}>
              🚀 Quick Bulk Scheduler
            </span>

            {/* Bulk Route Selector */}
            <div className={styles.inputRow}>
              <span className={styles.inputLabel}>Route</span>
              <select
                className="hud-input"
                value={bulkRouteId}
                onChange={(e) => setBulkRouteId(e.target.value)}
                style={{ background: "#111827", border: "1px solid var(--hud-border)", fontSize: "0.72rem", padding: "6px" }}
              >
                <option value="">🗺️ Follow Active / Default Route</option>
                {savedRoutes.map(r => (
                  <option key={r.id} value={r.id}>🔖 {getRouteDisplayName(r)}</option>
                ))}
              </select>
            </div>

            {/* Bulk Times */}
            <div style={{ display: "flex", gap: "8px" }}>
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "4px" }}>
                <span style={{ fontSize: "0.66rem", color: "var(--hud-text-secondary)" }}>Arrive by</span>
                <CustomTimeInput
                  value={bulkOutbound}
                  onChange={setBulkOutbound}
                  unitSystem={unitSystem}
                  isBulk={true}
                />
              </div>
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "4px" }}>
                <span style={{ fontSize: "0.66rem", color: "var(--hud-text-secondary)" }}>Leave at</span>
                <CustomTimeInput
                  value={bulkReturn}
                  onChange={setBulkReturn}
                  unitSystem={unitSystem}
                  isBulk={true}
                />
              </div>
            </div>

            {/* Day Selection Checkboxes (Sleek rows of pills) */}
            <div className={styles.inputRow}>
              <span className={styles.inputLabel}>Days to Assign</span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                {[
                  { val: 1, label: "M" },
                  { val: 2, label: "T" },
                  { val: 3, label: "W" },
                  { val: 4, label: "T" },
                  { val: 5, label: "F" },
                  { val: 6, label: "S" },
                  { val: 0, label: "S" }
                ].map((dayObj, index) => {
                  const isActive = bulkSelectedDays.includes(dayObj.val);
                  
                  return (
                    <button
                      key={index}
                      onClick={() => {
                        if (isActive) {
                          setBulkSelectedDays(bulkSelectedDays.filter(d => d !== dayObj.val));
                        } else {
                          setBulkSelectedDays([...bulkSelectedDays, dayObj.val]);
                        }
                      }}
                      className={styles.pillDayCheckbox}
                      style={{
                        background: isActive ? "var(--color-emerald)" : "rgba(255,255,255,0.06)",
                        border: isActive ? "1px solid var(--color-emerald)" : "1px solid var(--hud-border)"
                      }}
                    >
                      {dayObj.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Apply Button */}
            <button
              className="hud-btn active"
              onClick={applyBulkSchedule}
              style={{ width: "100%", justifyContent: "center", padding: "8px", fontSize: "0.78rem", cursor: "pointer", marginTop: "4px" }}
            >
              ⚡ Add to Schedule
            </button>
          </div>

          {/* List of active schedules */}
          <div className={styles.scheduledCommutesList}>
            <span style={{ fontSize: "0.82rem", fontWeight: "800", color: "var(--hud-text-secondary)" }}>
              📅 Scheduled Commutes
            </span>

            {groupedSchedules.length === 0 ? (
              <div className={styles.emptySchedulePlaceholder}>
                💨 No scheduled commutes yet. Select a route, outbound/return times, choose your days, and press &quot;Add to Schedule&quot; above!
              </div>
            ) : (
              groupedSchedules.map((group, index) => {
                const sortedDays = group.days.sort((a, b) => {
                  const order = [1, 2, 3, 4, 5, 6, 0];
                  return order.indexOf(a) - order.indexOf(b);
                });
                const daysLabel = sortedDays.map(d => WEEKDAYS_SHORT[d]).join(", ");
                
                // Calculate suggested times for a representative day in this group
                const targetDay = group.days[0];
                const outboundDep = getSuggestedDeparture(group.routeId, targetDay, group.outbound, false);
                const returnArr = getSuggestedArrival(group.routeId, targetDay, group.return);
                
                return (
                  <div key={index} className={styles.scheduledCommuteCard}>
                    <div className={styles.scheduledHeader}>
                      <span className={styles.scheduledRouteName}>
                        {(() => {
                          const route = savedRoutes.find(r => r.id === group.routeId);
                          return route ? getRouteDisplayName(route) : group.routeName;
                        })()}
                      </span>
                      <button
                        onClick={() => deleteGroupSchedule(group.days)}
                        className={styles.scheduledRemoveBtn}
                        title="Remove from Schedule"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>

                    {/* Day list badges */}
                    <span style={{ fontSize: "0.72rem", color: "var(--color-emerald)", fontWeight: "700" }}>
                      🗓️ {daysLabel}
                    </span>

                    {/* Outbound & Return AM/PM Arrive by vs. Suggested Leave-by Times */}
                    <div className={styles.scheduledDetailsWrapper}>
                      <div className={styles.scheduledDetailsRow}>
                        <span style={{ fontSize: "0.7rem", color: "var(--hud-text-secondary)" }}>
                          🌅 Arrive by: <strong>{formatTimeToAMPM(group.outbound)}</strong>
                        </span>
                        <span style={{ fontSize: "0.7rem", color: "var(--hud-text-primary)", paddingLeft: "14px" }}>
                          👉 Leave by: <strong style={{ color: "var(--color-emerald)" }}>{formatTimeToAMPM(outboundDep.timeStr)}</strong> ({outboundDep.duration} min commute)
                        </span>
                      </div>
                      <div className={styles.scheduledDetailsRow}>
                        <span style={{ fontSize: "0.7rem", color: "var(--hud-text-secondary)" }}>
                          🌇 Leave at: <strong>{formatTimeToAMPM(group.return)}</strong>
                        </span>
                        <span style={{ fontSize: "0.7rem", color: "var(--hud-text-primary)", paddingLeft: "14px" }}>
                          👉 Arrive home: <strong style={{ color: "var(--color-emerald)" }}>{formatTimeToAMPM(returnArr.timeStr)}</strong> ({returnArr.duration} min return, tailwind-aware)
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

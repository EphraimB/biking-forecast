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
import { calculateCommuteScore, calculateDepartureTimeForArrival, WMO_MAP } from "@/utils/weatherScoring";

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
  const [saveRouteName, setSaveRouteName] = useState("");
  const [shouldSaveRoute, setShouldSaveRoute] = useState(false);

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

  // Time & Timeline Scrub Scopes (State 3)
  const [selectedDayOffset, setSelectedDayOffset] = useState(0); // 0 (Today) to 6 (Day + 6)
  const [selectedHour, setSelectedHour] = useState(8); // 6:00 AM to 8:00 PM (commuter scrubber scale)

  // Dynamic Packing Drawer Scope (🎒 checklist toggle)
  const [isPackingOpen, setIsPackingOpen] = useState(false);
  const [packingList, setPackingList] = useState([]);

  // Adaptive Unit Toggle (📐 Metric / Imperial)
  const [unitSystem, setUnitSystem] = useState("metric");

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
  const [ambientWeather, setAmbientWeather] = useState(null);
  const [ambientWeatherForecast, setAmbientWeatherForecast] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const geocodeTimeoutRef = useRef(null);

  // 1. Initial Mount: Load Saved Routes & Restore Active View State
  useEffect(() => {
    const saved = localStorage.getItem("hud_saved_routes");
    if (saved) {
      try {
        setSavedRoutes(JSON.parse(saved));
      } catch (e) {
        console.error("Error loading saved routes:", e);
      }
    }

    // Load Weekly Schedule
    const savedWeeklySchedule = localStorage.getItem("hud_weekly_schedule");
    if (savedWeeklySchedule) {
      try {
        setWeeklySchedule(JSON.parse(savedWeeklySchedule));
      } catch (e) {
        console.error("Error loading weekly schedule:", e);
      }
    }

    // Restore Global View-State Caching (Reload Survival)
    const cachedState = localStorage.getItem("hud_active_view_state");
    if (cachedState) {
      try {
        const state = JSON.parse(cachedState);
        if (state.selectedDayOffset !== undefined) setSelectedDayOffset(state.selectedDayOffset);
        if (state.selectedHour !== undefined) setSelectedHour(state.selectedHour);
        if (state.newBikeType !== undefined) setNewBikeType(state.newBikeType);
        if (state.newSpeed !== undefined) setNewSpeed(state.newSpeed);
        if (state.unitSystem !== undefined) setUnitSystem(state.unitSystem);
        
        if (state.draftStart && state.draftEnd) {
          setDraftStart(state.draftStart);
          setDraftEnd(state.draftEnd);
          setStartQuery(state.draftStart.label);
          setEndQuery(state.draftEnd.label);
          
          // Re-trigger background fetches, maintaining correct visual state
          loadRouteDetails(
            state.draftStart, 
            state.draftEnd, 
            state.newBikeType || "Hybrid", 
            state.newSpeed || 18, 
            state.hudState !== undefined ? state.hudState : 2
          );
        } else {
          if (state.hudState !== undefined) {
            // Restore only safe base states if no route coordinates exist
            setHudState(state.hudState === 1 ? 1 : 0);
          }
        }
      } catch (err) {
        console.error("View state restoration error: ", err);
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

  // 2. Global View State Cache Synchronizer
  useEffect(() => {
    const activeState = {
      draftStart,
      draftEnd,
      selectedDayOffset,
      selectedHour,
      newBikeType,
      newSpeed,
      unitSystem,
      hudState
    };
    localStorage.setItem("hud_active_view_state", JSON.stringify(activeState));
  }, [draftStart, draftEnd, selectedDayOffset, selectedHour, newBikeType, newSpeed, unitSystem, hudState]);

  // Persist Weekly Schedule Changes
  useEffect(() => {
    localStorage.setItem("hud_weekly_schedule", JSON.stringify(weeklySchedule));
  }, [weeklySchedule]);

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
        setAmbientWeatherForecast(weather[0]);
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
  const loadRouteDetails = async (start, end, bikeType, speed, overrideState = null) => {
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

      // Successfully mapped! Restore or load correct state
      setHudState(overrideState !== null ? overrideState : 2);
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
    const totalDist = routeSegments.reduce((sum, seg) => sum + seg.distance, 0);
    
    const newRoute = {
      id: Date.now().toString(),
      name,
      start: draftStart,
      end: draftEnd,
      bikeType: newBikeType,
      speed: newSpeed,
      coordinates: routeCoordinates,
      segments: routeSegments,
      distance: totalDist
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

  const handleLoadSavedRoute = (route) => {
    setDraftStart(route.start);
    setDraftEnd(route.end);
    setNewBikeType(route.bikeType || "Hybrid");
    setNewSpeed(route.speed || 18);
    
    if (route.coordinates && route.segments) {
      setRouteCoordinates(route.coordinates);
      setRouteSegments(route.segments);
      // Fetch weather for this loaded route
      fetchRouteWeather(route.coordinates, route.distance || 10).then(weatherData => {
        setWeatherResults(weatherData);
      }).catch(e => console.error("Error fetching weather for loaded route:", e));
      setHudState(2);
    } else {
      loadRouteDetails(route.start, route.end, route.bikeType || "Hybrid", route.speed || 18);
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
      bearing: (seg.bearing + 180) % 360
    }));
  };

  const formatTimeToAMPM = (timeStr) => {
    if (!timeStr) return "";
    const [h, m] = timeStr.split(":").map(Number);
    const ampm = h >= 12 ? "PM" : "AM";
    const displayH = h % 12 === 0 ? 12 : h % 12;
    const displayM = m.toString().padStart(2, "0");
    return `${displayH}:${displayM} ${ampm}`;
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
      route.speed || 18,
      boundWeatherEntry.weather
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
      route.speed || 18,
      boundWeatherEntry.weather
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

  // 3. Background Weather Pre-fetcher for Weekly Scheduled Routes
  useEffect(() => {
    const fetchScheduledWeather = async () => {
      // Find all distinct route IDs in weeklySchedule that are NOT null and NOT already in scheduledRoutesWeather
      const boundRouteIds = Object.values(weeklySchedule)
        .map(s => s?.routeId)
        .filter(id => id && !scheduledRoutesWeather[id]);
      
      const distinctIds = [...new Set(boundRouteIds)];
      if (distinctIds.length === 0) return;

      const newWeather = { ...scheduledRoutesWeather };
      let updated = false;

      for (const rid of distinctIds) {
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
                route.bikeType || "Hybrid", 
                route.speed || 18
              );
              coords = decodePolyline6(routeData.shape);
              dist = routeData.distance;
              segments = calculateRouteSegments(coords);
            }
            
            const wData = await fetchRouteWeather(coords, dist);
            newWeather[rid] = {
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
        setScheduledRoutesWeather(newWeather);
      }
    };

    fetchScheduledWeather();
  }, [weeklySchedule, savedRoutes, scheduledRoutesWeather]);

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
      return {
        coordinates: boundWeatherEntry.coordinates,
        segments: boundWeatherEntry.segments,
        weatherResults: boundWeatherEntry.weather,
        startLocation: boundRoute.start,
        endLocation: boundRoute.end,
        speed: boundRoute.speed || 18,
        name: boundRoute.name
      };
    }

    return {
      coordinates: routeCoordinates,
      segments: routeSegments,
      weatherResults: weatherResults,
      startLocation: draftStart,
      endLocation: draftEnd,
      speed: newSpeed,
      name: "Active Route"
    };
  };

  const activeRouteData = getActiveRouteData();

  // Dynamic Weather-Adaptive Packing List Core Logic
  const compileDynamicPackingList = (dayOffset, activeHour) => {
    const activeRoute = getActiveRouteData();
    if (activeRoute.weatherResults.length === 0) return;
    
    const hourIdx = dayOffset * 24 + activeHour;
    const midIdx = Math.floor(activeRoute.weatherResults.length / 2);
    const midHourly = activeRoute.weatherResults[midIdx]?.hourly;

    const temp = midHourly?.temperature_2m?.[hourIdx] ?? 20;
    const isRaining = (midHourly?.precipitation?.[hourIdx] ?? 0) > 0.1;
    const uvIndex = midHourly?.uv_index?.[hourIdx] ?? 0;
    const isSunset = activeHour > 18 || activeHour < 7;
    const totalDist = activeRoute.segments.reduce((sum, seg) => sum + seg.distance, 0);

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
        advice: `Long distance (${formatDistance(totalDist)}). Self-rescue capacity required.`
      });
    }

    setPackingList(checklist);
  };

  // Keep packing checklist automatically sync'd in real-time
  useEffect(() => {
    if (isPackingOpen) {
      compileDynamicPackingList(selectedDayOffset, selectedHour);
    }
  }, [selectedDayOffset, selectedHour, isPackingOpen, weeklySchedule, scheduledRoutesWeather]);

  // Toggle checklist open/closed with mutual exclusion
  const togglePackingList = () => {
    if (!isPackingOpen) {
      setIsWeeklyPlannerOpen(false);
      setIsSavedHubOpen(false);
    }
    setIsPackingOpen(!isPackingOpen);
  };

  const toggleWeeklyPlanner = () => {
    if (!isWeeklyPlannerOpen) {
      setIsPackingOpen(false);
      setIsSavedHubOpen(false);
    }
    setIsWeeklyPlannerOpen(!isWeeklyPlannerOpen);
  };

  const toggleSavedHub = () => {
    if (!isSavedHubOpen) {
      setIsWeeklyPlannerOpen(false);
      setIsPackingOpen(false);
    }
    setIsSavedHubOpen(!isSavedHubOpen);
  };

  // Get active forecast details for Top HUD bubbles
  const getActiveForecast = () => {
    if (activeRouteData.weatherResults.length === 0) return null;
    const hourIdx = selectedDayOffset * 24 + selectedHour;
    
    // Average scores across segments
    return calculateCommuteScore(
      hourIdx, 
      activeRouteData.segments, 
      activeRouteData.speed, 
      activeRouteData.weatherResults
    );
  };

  const activeForecast = getActiveForecast();

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
    const ampm = hours >= 12 ? "PM" : "AM";
    const displayH = hours % 12 || 12;
    const displayM = minutes.toString().padStart(2, "0");
    return `${displayH}:${displayM} ${ampm}`;
  };

  // Calculate 7-day commute tracks data for Double-Sided Ribbon
  const get7DayCommuteData = () => {
    if (weatherResults.length === 0 && Object.keys(scheduledRoutesWeather).length === 0) return [];
    
    const isAnyDayScheduled = Object.values(weeklySchedule).some(sched => sched.routeId !== null);
    
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

      if (boundRoute && boundWeatherEntry) {
        activeCoords = boundWeatherEntry.coordinates;
        activeSegs = boundWeatherEntry.segments;
        activeWeather = boundWeatherEntry.weather;
        activeSpeed = boundRoute.speed || 18;
      } else if (!isAnyDayScheduled) {
        // Fall back to active draft route only if there are no days scheduled in the Weekly Commute Planner
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
          activeWeather
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
            arrival: formatTimeAMPM(outboundTargetDate)
          },
          return: {
            score: returnResult.score,
            duration: returnResult.duration,
            departure: formatTimeAMPM(returnTargetDate),
            arrival: formatTimeAMPM(arrivalTimeDate)
          },
          routeId: boundRouteId,
          routeName: boundRoute ? boundRoute.name : "Active Route"
        });
      } else {
        ribbonDays.push({
          offset,
          label: getRollingDayLabel(offset),
          outbound: { score: 100, duration: 0, departure: null, arrival: null },
          return: { score: 100, duration: 0, departure: null, arrival: null },
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
    <div style={{ position: "relative", width: "100vw", height: "100vh", overflow: "hidden", background: "#0b0f19" }}>
      
      {/* 
        -------------------------------------------------------------
        CORE MAP VIEWPORT (100% VISIBLE CANVAS BACKDROP)
        ------------------------------------------------------------- 
      */}
      <div style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", zIndex: 1 }}>
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
      
      {/* Top Left: Unified Navigation & Controls Hub */}
      <div style={{ position: "absolute", top: "20px", left: "20px", zIndex: 9999, display: "flex", gap: "10px" }} className="hud-slide-top hud-top-left">
        
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

        {/* State 2 & 3: Active Route Score bubble */}
        {(hudState === 2 || hudState === 3) && activeForecast && (
          <div className="hud-bubble" style={{ pointerEvents: "auto", border: "1px solid rgba(255,255,255,0.15)" }}>
            <div 
              style={{
                width: "10px",
                height: "10px",
                borderRadius: "50%",
                background: activeForecast.score >= 85 ? "var(--color-emerald)" : activeForecast.score >= 50 ? "var(--color-amber)" : "var(--color-ruby)",
                boxShadow: `0 0 10px ${activeForecast.score >= 85 ? "var(--color-emerald-glow)" : activeForecast.score >= 50 ? "var(--color-amber-glow)" : "var(--color-ruby-glow)"}`,
                display: "inline-block",
                marginRight: "4px"
              }} 
              className={activeForecast.score >= 85 ? "hud-pulse-emerald" : activeForecast.score >= 50 ? "hud-pulse-amber" : "hud-pulse-ruby"}
            />
            <span style={{ fontSize: "0.88rem", fontWeight: "700" }}>
              <span className="mobile-hide">Score: </span>{activeForecast.score}% • {activeForecast.wmoEmoji} <span className="mobile-hide">{activeForecast.wmoDesc}</span>
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
                localStorage.removeItem("hud_active_view_state"); // Clear cached route state on manual reset
              }} 
              style={{ background: "none", border: "none", color: "var(--hud-text-secondary)", cursor: "pointer", display: "flex", alignItems: "center", marginLeft: "8px" }}
              title="Clear Route"
            >
              <X size={14} />
            </button>
          </div>
        )}

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

        {/* Saved Routes Hub Trigger (Permanently Available in States 0, 2, 3) */}
        {(hudState === 0 || hudState === 2 || hudState === 3) && (
          <button 
            className="hud-bubble" 
            onClick={toggleSavedHub}
            style={{ 
              cursor: "pointer", 
              border: isSavedHubOpen ? "1.5px solid var(--color-emerald)" : "1px solid var(--hud-border)",
              pointerEvents: "auto",
              display: "flex",
              alignItems: "center",
              gap: "6px"
            }}
            title="Saved Routes Library"
          >
            <Bookmark size={16} style={{ color: isSavedHubOpen ? "var(--color-emerald)" : "var(--hud-text-primary)" }} />
            <span className="mobile-hide" style={{ fontSize: "0.78rem", fontWeight: "800", color: isSavedHubOpen ? "var(--color-emerald)" : "var(--hud-text-primary)" }}>
              SAVED
            </span>
          </button>
        )}

        {/* Weekly Schedule Planner Trigger (Permanently Available in States 0, 2, 3) */}
        {(hudState === 0 || hudState === 2 || hudState === 3) && (
          <button 
            className="hud-bubble" 
            onClick={toggleWeeklyPlanner}
            style={{ 
              cursor: "pointer", 
              border: isWeeklyPlannerOpen ? "1.5px solid var(--color-emerald)" : "1px solid var(--hud-border)",
              pointerEvents: "auto",
              display: "flex",
              alignItems: "center",
              gap: "6px"
            }}
            title="Weekly Schedule Planner"
          >
            <Calendar size={16} style={{ color: isWeeklyPlannerOpen ? "var(--color-emerald)" : "var(--hud-text-primary)" }} />
            <span style={{ fontSize: "0.78rem", fontWeight: "800", color: isWeeklyPlannerOpen ? "var(--color-emerald)" : "var(--hud-text-primary)" }}>
              WEEKLY<span className="mobile-hide"> PLANNER</span>
            </span>
          </button>
        )}

        {/* Saved Routes Dropdown overlay */}
        {isSavedHubOpen && (hudState === 0 || hudState === 2 || hudState === 3) && (
          <div className="hud-card hud-card-responsive" style={{ position: "absolute", top: "54px", left: 0, width: "280px", zIndex: 99999, display: "flex", flexDirection: "column", gap: "12px", maxHeight: "300px", overflowY: "auto", pointerEvents: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--hud-border)", paddingBottom: "6px" }}>
              <h4 style={{ fontFamily: "var(--font-heading)", fontSize: "0.95rem", color: "var(--hud-text-secondary)", display: "flex", alignItems: "center", gap: "6px" }}>🔖 Saved Routes</h4>
              <button onClick={() => setIsSavedHubOpen(false)} style={{ background: "none", border: "none", color: "var(--hud-text-secondary)", cursor: "pointer" }}><X size={14} /></button>
            </div>
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

      {/* Top Right: Unit Toggle, Ambient Weather & Gear Check HUD */}
      <div style={{ position: "absolute", top: "20px", right: "20px", zIndex: 9999, display: "flex", gap: "10px", alignItems: "center" }} className="hud-slide-top hud-top-right">
        
        {/* Metric / Imperial Toggling Bubble */}
        <button 
          className="hud-bubble" 
          onClick={() => setUnitSystem(unitSystem === "metric" ? "imperial" : "metric")}
          style={{ padding: "10px 14px", fontSize: "0.78rem", fontWeight: "800", cursor: "pointer", background: "rgba(15,23,42,0.85)", pointerEvents: "auto" }}
          title="Switch Units"
        >
          📐 <span className="mobile-hide">{unitSystem === "metric" ? "METRIC" : "IMPERIAL"}</span>
        </button>

        {ambientWeather && (
          <div className="hud-bubble" style={{ pointerEvents: "none" }}>
            <SunDim size={16} style={{ color: "var(--color-amber)", animation: "spin 12s linear infinite" }} />
            <span style={{ fontSize: "0.82rem", fontWeight: "600" }}>
              {formatTemp(ambientWeather.temp)}
              <span className="mobile-hide"> • {formatWind(ambientWeather.windSpeed)} {ambientWeather.windDir}</span>
            </span>
          </div>
        )}

        {(hudState === 2 || hudState === 3) && activeForecast && (
          <>
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
                className="hud-card hud-card-responsive" 
                style={{ 
                  position: "absolute", 
                  top: "54px", 
                  right: 0, 
                  width: "290px", 
                  display: "flex", 
                  flexDirection: "column", 
                  gap: "12px", 
                  maxHeight: "360px", 
                  overflowY: "auto",
                  border: "1px solid var(--hud-border)",
                  pointerEvents: "auto"
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
          </>
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
          <div style={{ position: "absolute", top: "20px", left: "50%", transform: "translateX(-50%)", width: "420px", maxWidth: "calc(100% - 40px)", display: "flex", flexDirection: "column", gap: "8px" }} className="hud-slide-top hud-search-container">
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
          <div style={{ position: "absolute", bottom: "30px", right: "20px", width: "320px" }} className="hud-slide-bottom hud-config-card">
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
                  <span>{unitSystem === "imperial" ? `${Math.round(newSpeed * 0.621371)} mph` : `${newSpeed} km/h`}</span>
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
        STATES 2 & 3: COMMUTE 7-DAY OUTLOOK RIBBO      {/* 7-Day Biking Commute Forecast Ribbon (Always Visible in States 0, 2, 3) */}
      {(hudState === 0 || hudState === 2 || hudState === 3) && ribbonDaysData.length > 0 && (
        <div 
          style={{ 
            position: "absolute", 
            bottom: "20px", 
            left: "20px", 
            right: "20px", 
            width: "calc(100% - 40px)", 
            display: "flex", 
            flexDirection: "column", 
            gap: "8px",
            pointerEvents: "none",
            zIndex: 9999
          }} 
          className="hud-slide-bottom"
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", padding: "0 6px" }}>
            <span style={{ fontSize: "0.74rem", fontWeight: "800", color: "var(--hud-text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              🚴 7-Day Commuter Biking Forecast
            </span>
          </div>

          <div 
            className="hud-card ribbon-container" 
            style={{ 
              padding: "12px", 
              display: "flex", 
              justifyContent: "space-between", 
              alignItems: "center", 
              gap: "8px", 
              width: "100%",
              background: "rgba(15, 23, 42, 0.85)",
              pointerEvents: "auto"
            }}
          >
            {ribbonDaysData.map((day) => {
              const isSelected = hudState === 3 && selectedDayOffset === day.offset;
              const hasOutbound = day.outbound && day.outbound.departure !== null;
              const hasReturn = day.return && day.return.departure !== null;
              
              return (
                <div 
                  key={day.offset} 
                  className={`ribbon-item ${isSelected ? "selected" : ""}`}
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
                    } else {
                      // Helpfully prompt route setup
                      setHudState(1);
                    }
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
                    gap: "8px",
                    transition: "all var(--duration-fluid) var(--ease-premium)"
                  }}
                >
                  <span style={{ fontSize: "0.74rem", fontWeight: "700", color: isSelected ? "var(--hud-text-primary)" : "var(--hud-text-secondary)" }}>
                    {day.label}
                  </span>

                  {/* DUAL RIDE TRACKS (Top: Outbound AM, Bottom: Return PM) */}
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px", width: "100%" }}>
                    
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
                        } else {
                          setHudState(1);
                        }
                      }}
                      style={{ display: "flex", flexDirection: "column", gap: "2px", width: "100%", alignItems: "center", background: "rgba(255,255,255,0.03)", padding: "6px", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.05)", cursor: "pointer" }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", width: "100%", alignItems: "center", fontSize: "0.68rem", fontWeight: "700" }}>
                        <span style={{ color: "var(--hud-text-secondary)", fontSize: "0.6rem" }}>🌅 AM</span>
                        {hasOutbound ? (
                          <span style={{ 
                            background: day.outbound.score >= 85 ? "rgba(16,185,129,0.15)" : day.outbound.score >= 50 ? "rgba(245,158,11,0.15)" : "rgba(239,68,68,0.15)",
                            color: day.outbound.score >= 85 ? "var(--color-emerald)" : day.outbound.score >= 50 ? "var(--color-amber)" : "var(--color-ruby)",
                            padding: "1px 5px",
                            borderRadius: "5px",
                            fontSize: "0.64rem",
                            fontWeight: "800"
                          }}>
                            {day.outbound.score}%
                          </span>
                        ) : (
                          <span style={{ color: "var(--hud-text-secondary)", fontSize: "0.6rem" }}>--</span>
                        )}
                      </div>
                      {hasOutbound ? (
                        <>
                          <div style={{ fontSize: "0.62rem", fontWeight: "700", color: "var(--hud-text-primary)", marginTop: "2px" }}>
                            {day.outbound.departure.replace(" AM", "a").replace(" PM", "p")}
                            <span className="mobile-hide"> → {day.outbound.arrival.replace(" AM", "a").replace(" PM", "p")}</span>
                          </div>
                          <div style={{ fontSize: "0.58rem", color: "var(--hud-text-secondary)" }}>
                            {day.outbound.duration} min ride
                          </div>
                        </>
                      ) : (
                        <div style={{ fontSize: "0.58rem", color: "var(--hud-text-secondary)", fontStyle: "italic", marginTop: "2px" }}>No Route</div>
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
                        } else {
                          setHudState(1);
                        }
                      }}
                      style={{ display: "flex", flexDirection: "column", gap: "2px", width: "100%", alignItems: "center", background: "rgba(255,255,255,0.03)", padding: "6px", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.05)", cursor: "pointer" }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", width: "100%", alignItems: "center", fontSize: "0.68rem", fontWeight: "700" }}>
                        <span style={{ color: "var(--hud-text-secondary)", fontSize: "0.6rem" }}>🌇 PM</span>
                        {hasReturn ? (
                          <span style={{ 
                            background: day.return.score >= 85 ? "rgba(16,185,129,0.15)" : day.return.score >= 50 ? "rgba(245,158,11,0.15)" : "rgba(239,68,68,0.15)",
                            color: day.return.score >= 85 ? "var(--color-emerald)" : day.return.score >= 50 ? "var(--color-amber)" : "var(--color-ruby)",
                            padding: "1px 5px",
                            borderRadius: "5px",
                            fontSize: "0.64rem",
                            fontWeight: "800"
                          }}>
                            {day.return.score}%
                          </span>
                        ) : (
                          <span style={{ color: "var(--hud-text-secondary)", fontSize: "0.6rem" }}>--</span>
                        )}
                      </div>
                      {hasReturn ? (
                        <>
                          <div style={{ fontSize: "0.62rem", fontWeight: "700", color: "var(--hud-text-primary)", marginTop: "2px" }}>
                            {day.return.departure.replace(" AM", "a").replace(" PM", "p")}
                            <span className="mobile-hide"> → {day.return.arrival.replace(" AM", "a").replace(" PM", "p")}</span>
                          </div>
                          <div style={{ fontSize: "0.58rem", color: "var(--hud-text-secondary)" }}>
                            {day.return.duration} min ride
                          </div>
                        </>
                      ) : (
                        <div style={{ fontSize: "0.58rem", color: "var(--hud-text-secondary)", fontStyle: "italic", marginTop: "2px" }}>No Route</div>
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
              className="hud-card timeline-scrubber-container" 
              style={{ 
                padding: "10px 16px", 
                display: "flex", 
                alignItems: "center", 
                justifyContent: "space-between",
                gap: "16px", 
                width: "100%", 
                background: "rgba(15, 23, 42, 0.9)",
                pointerEvents: "auto"
              }}
            >
              {/* Timeline Scrubber */}
              <div style={{ display: "flex", alignItems: "center", gap: "10px", flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>
                  <Clock size={14} style={{ color: "var(--hud-text-secondary)" }} />
                  <span style={{ fontSize: "0.78rem", fontWeight: "700", width: "64px" }}>
                    {selectedHour.toString().padStart(2, "0")}:00 {selectedHour >= 12 ? "PM" : "AM"}
                  </span>
                </div>

                {/* Outbound / Return Quick Snapper Toggle */}
                <div style={{ 
                  display: "flex", 
                  background: "rgba(255,255,255,0.05)", 
                  padding: "2px", 
                  borderRadius: "8px", 
                  border: "1px solid var(--hud-border)",
                  flexShrink: 0
                }}>
                  <button 
                    onClick={() => {
                      const daySched = weeklySchedule[currentDayOfWeek] || { outbound: "08:00", return: "17:30" };
                      const outboundHour = parseInt(daySched.outbound.split(":")[0]);
                      setSelectedHour(outboundHour);
                    }}
                    style={{ 
                      background: selectedHour === parseInt((weeklySchedule[currentDayOfWeek]?.outbound || "08:00").split(":")[0]) ? "var(--color-emerald)" : "transparent",
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
                    🌅 AM
                  </button>
                  <button 
                    onClick={() => {
                      const daySched = weeklySchedule[currentDayOfWeek] || { outbound: "08:00", return: "17:30" };
                      const returnHour = parseInt(daySched.return.split(":")[0]);
                      setSelectedHour(returnHour);
                    }}
                    style={{ 
                      background: selectedHour === parseInt((weeklySchedule[currentDayOfWeek]?.return || "17:30").split(":")[0]) ? "var(--color-emerald)" : "transparent",
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
                    🌇 PM
                  </button>
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
              </div>

              {/* Independent Day Schedule Config Inputs */}
              <div className="time-inputs-group" style={{ display: "flex", alignItems: "center", gap: "8px", borderLeft: "1px solid var(--hud-border)", paddingLeft: "12px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                  <span style={{ fontSize: "0.68rem", color: "var(--hud-text-secondary)" }}>Outbound:</span>
                  <input 
                    type="time" 
                    value={weeklySchedule[currentDayOfWeek]?.outbound || "08:00"}
                    onChange={(e) => updateDailySchedule(selectedDayOffset, 'outbound', e.target.value)}
                    style={{ 
                      background: "rgba(255,255,255,0.06)", 
                      border: "1px solid var(--hud-border)", 
                      borderRadius: "6px", 
                      color: "var(--hud-text-primary)", 
                      fontSize: "0.72rem", 
                      padding: "2px 4px", 
                      outline: "none" 
                    }} 
                  />
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                  <span style={{ fontSize: "0.68rem", color: "var(--hud-text-secondary)" }}>Return:</span>
                  <input 
                    type="time" 
                    value={weeklySchedule[currentDayOfWeek]?.return || "17:30"}
                    onChange={(e) => updateDailySchedule(selectedDayOffset, 'return', e.target.value)}
                    style={{ 
                      background: "rgba(255,255,255,0.06)", 
                      border: "1px solid var(--hud-border)", 
                      borderRadius: "6px", 
                      color: "var(--hud-text-primary)", 
                      fontSize: "0.72rem", 
                      padding: "2px 4px", 
                      outline: "none" 
                    }} 
                  />
                </div>
              </div>

              {/* Exit day focus button */}
              <button 
                onClick={() => setHudState(2)} // Return to Week-wide ambient outlook
                className="hud-btn exit-scrub-btn" 
                style={{ padding: "4px 10px", marginLeft: "10px" }}
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
            className="hud-card hud-card-responsive" 
            style={{ 
              position: "absolute", 
              top: "74px", 
              left: "20px", 
              width: "310px", 
              zIndex: 99999, 
              display: "flex", 
              flexDirection: "column", 
              gap: "16px", 
              maxHeight: "80vh", 
              overflowY: "auto", 
              border: "1px solid var(--hud-border)",
              pointerEvents: "auto"
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--hud-border)", paddingBottom: "10px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <Calendar size={18} style={{ color: "var(--color-emerald)" }} />
                <h4 style={{ fontFamily: "var(--font-heading)", fontSize: "1rem", fontWeight: "800" }}>📅 Weekly Commute Planner</h4>
              </div>
              <button onClick={() => setIsWeeklyPlannerOpen(false)} style={{ background: "none", border: "none", color: "var(--hud-text-secondary)", cursor: "pointer" }}><X size={16} /></button>
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
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <span style={{ fontSize: "0.66rem", color: "var(--hud-text-secondary)" }}>Route</span>
                <select
                  className="hud-input"
                  value={bulkRouteId}
                  onChange={(e) => setBulkRouteId(e.target.value)}
                  style={{ background: "#111827", border: "1px solid var(--hud-border)", fontSize: "0.72rem", padding: "6px" }}
                >
                  <option value="">🗺️ Follow Active / Default Route</option>
                  {savedRoutes.map(r => (
                    <option key={r.id} value={r.id}>🔖 {r.name}</option>
                  ))}
                </select>
              </div>

              {/* Bulk Times */}
              <div style={{ display: "flex", gap: "8px" }}>
                <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "4px" }}>
                  <span style={{ fontSize: "0.66rem", color: "var(--hud-text-secondary)" }}>Arrive by (AM)</span>
                  <input
                    type="time"
                    value={bulkOutbound}
                    onChange={(e) => setBulkOutbound(e.target.value)}
                    style={{
                      background: "rgba(255,255,255,0.06)",
                      border: "1px solid var(--hud-border)",
                      borderRadius: "6px",
                      color: "var(--hud-text-primary)",
                      fontSize: "0.72rem",
                      padding: "4px 6px",
                      outline: "none"
                    }}
                  />
                </div>
                 <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "4px" }}>
                  <span style={{ fontSize: "0.66rem", color: "var(--hud-text-secondary)" }}>Leave at (PM)</span>
                  <input
                    type="time"
                    value={bulkReturn}
                    onChange={(e) => setBulkReturn(e.target.value)}
                    style={{
                      background: "rgba(255,255,255,0.06)",
                      border: "1px solid var(--hud-border)",
                      borderRadius: "6px",
                      color: "var(--hud-text-primary)",
                      fontSize: "0.72rem",
                      padding: "4px 6px",
                      outline: "none"
                    }}
                  />
                </div>
              </div>

              {/* Day Selection Checkboxes (Sleek rows of pills) */}
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <span style={{ fontSize: "0.66rem", color: "var(--hud-text-secondary)" }}>Days to Assign</span>
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
                        style={{
                          background: isActive ? "var(--color-emerald)" : "rgba(255,255,255,0.06)",
                          border: isActive ? "1px solid var(--color-emerald)" : "1px solid var(--hud-border)",
                          borderRadius: "8px",
                          width: "32px",
                          height: "32px",
                          fontSize: "0.72rem",
                          fontWeight: "700",
                          color: "var(--hud-text-primary)",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          transition: "all 0.2s"
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
            <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "4px" }}>
              <span style={{ fontSize: "0.82rem", fontWeight: "800", color: "var(--hud-text-secondary)" }}>
                📅 Scheduled Commutes
              </span>

              {groupedSchedules.length === 0 ? (
                <div style={{
                  padding: "16px",
                  borderRadius: "14px",
                  background: "rgba(255,255,255,0.02)",
                  border: "1px dashed var(--hud-border)",
                  textAlign: "center",
                  fontSize: "0.74rem",
                  color: "var(--hud-text-secondary)",
                  lineHeight: "1.45"
                }}>
                  💨 No scheduled commutes yet. Select a route, outbound/return times, choose your days, and press "Add to Schedule" above!
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
                    <div 
                      key={index} 
                      style={{ 
                        background: "rgba(255,255,255,0.03)", 
                        padding: "12px", 
                        borderRadius: "14px", 
                        border: "1px solid rgba(255,255,255,0.06)", 
                        display: "flex", 
                        flexDirection: "column", 
                        gap: "6px" 
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "10px" }}>
                        <span style={{ fontSize: "0.82rem", fontWeight: "800", color: "var(--hud-text-primary)", overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
                          🔖 {group.routeName}
                        </span>
                        <button
                          onClick={() => deleteGroupSchedule(group.days)}
                          style={{ background: "none", border: "none", color: "var(--color-ruby)", cursor: "pointer", display: "flex", alignItems: "center", padding: "2px" }}
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
                      <div style={{ display: "flex", flexDirection: "column", gap: "6px", borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: "6px", marginTop: "2px" }}>
                        <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                          <span style={{ fontSize: "0.7rem", color: "var(--hud-text-secondary)" }}>
                            🌅 Arrive by: <strong>{formatTimeToAMPM(group.outbound)}</strong>
                          </span>
                          <span style={{ fontSize: "0.7rem", color: "var(--hud-text-primary)", paddingLeft: "14px" }}>
                            👉 Leave by: <strong style={{ color: "var(--color-emerald)" }}>{formatTimeToAMPM(outboundDep.timeStr)}</strong> ({outboundDep.duration} min commute)
                          </span>
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
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

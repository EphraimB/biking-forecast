"use client";

import { useState, useEffect, useRef, useCallback } from "react";
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
  const [weeklySchedule, setWeeklySchedule] = useState(() => {
    if (typeof window !== "undefined") {
      const savedWeeklySchedule = localStorage.getItem("hud_weekly_schedule");
      if (savedWeeklySchedule) {
        try {
          return JSON.parse(savedWeeklySchedule);
        } catch (e) {
          console.error("Error loading weekly schedule:", e);
        }
      }
    }
    return {
      1: { routeId: null, outbound: "08:00", return: "17:30" }, // Monday
      2: { routeId: null, outbound: "08:00", return: "17:30" }, // Tuesday
      3: { routeId: null, outbound: "08:00", return: "17:30" }, // Wednesday
      4: { routeId: null, outbound: "08:00", return: "17:30" }, // Thursday
      5: { routeId: null, outbound: "08:00", return: "17:30" }, // Friday
      6: { routeId: null, outbound: "08:00", return: "17:30" }, // Saturday
      0: { routeId: null, outbound: "08:00", return: "17:30" }  // Sunday
    };
  });

  const [isWeeklyPlannerOpen, setIsWeeklyPlannerOpen] = useState(false);
  const [scheduledRoutesWeather, setScheduledRoutesWeather] = useState({});

  // Bulk Scheduling States
  const [bulkRouteId, setBulkRouteId] = useState("");
  const [bulkOutbound, setBulkOutbound] = useState("08:00");
  const [bulkReturn, setBulkReturn] = useState("17:30");
  const [bulkSelectedDays, setBulkSelectedDays] = useState([]);

  // Saved Routes Hub (🔖 Persistence)
  const [savedRoutes, setSavedRoutes] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("hud_saved_routes");
      if (saved) {
        try {
          return JSON.parse(saved);
        } catch (e) {
          console.error("Error loading saved routes:", e);
        }
      }
    }
    return [];
  });
  const [isSavedHubOpen, setIsSavedHubOpen] = useState(false);

  // Time & Timeline Scrub Scopes (State 3)
  const [selectedDayOffset, setSelectedDayOffset] = useState(0); // 0 (Today) to 6 (Day + 6)
  const [selectedHour, setSelectedHour] = useState(8); // 6:00 AM to 8:00 PM (commuter scrubber scale)
  const [isReturnTripMode, setIsReturnTripMode] = useState(false);


  // Dynamic Packing Drawer Scope (🎒 checklist toggle)
  const [isPackingOpen, setIsPackingOpen] = useState(false);
  const [isRiderConfigOpen, setIsRiderConfigOpen] = useState(false);

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
  const [baseWeatherLocationName, setBaseWeatherLocationName] = useState("Resolving GPS...");
  const [ambientWeather, setAmbientWeather] = useState(null);
  const [ambientWeatherForecast, setAmbientWeatherForecast] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const geocodeTimeoutRef = useRef(null);

  // Derived state: weatherLocationName represents active route's starting city or fallback base location
  const weatherLocationName = (draftStart && draftStart.label && baseWeatherLocationName !== "Map Viewport")
    ? (draftStart.label.split(",")[0] || "Route Start")
    : baseWeatherLocationName;

  // Memoized callback triggers to satisfy strict react-hooks rules and avoid hoisting issues
  const fetchAmbientWeather = useCallback(async (lat, lon) => {
    try {
      const dummyCoords = [[lat, lon]];
      const weather = await fetchRouteWeather(dummyCoords, 1);
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
  }, []);

  const loadRouteDetails = useCallback(async (start, end, bikeType, speed, overrideState = null) => {
    setIsLoading(true);
    setError(null);
    try {
      const routeData = await fetchBicycleRoute(start.lat, start.lon, end.lat, end.lon, bikeType, speed);
      const decodedCoords = decodePolyline6(routeData.shape);
      setRouteCoordinates(decodedCoords);

      const segments = calculateRouteSegments(decodedCoords);
      setRouteSegments(segments);

      const weatherData = await fetchRouteWeather(decodedCoords, routeData.distance);
      setWeatherResults(weatherData);

      setHudState(overrideState !== null ? overrideState : 2);
    } catch (err) {
      console.error(err);
      setError(err.message || "Route validation pipeline failed.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  const triggerGeocode = useCallback((query, isStart) => {
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
  }, []);

  // 1. Initial Mount: Restore Active View State
  useEffect(() => {
    const handle = setTimeout(() => {
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
          if (state.isReturnTripMode !== undefined) setIsReturnTripMode(state.isReturnTripMode);
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

      if (!restoredHour) {
        const currentHour = new Date().getHours();
        setSelectedHour(Math.max(6, Math.min(20, currentHour)));
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
    }, 0);

    return () => clearTimeout(handle);
  }, [fetchAmbientWeather, loadRouteDetails]);

  // 2. Global View State Cache Synchronizer
  useEffect(() => {
    const activeState = {
      draftStart,
      draftEnd,
      selectedDayOffset,
      selectedHour,
      isReturnTripMode,
      newBikeType,
      newSpeed,
      unitSystem,
      hudState
    };
    localStorage.setItem("hud_active_view_state", JSON.stringify(activeState));
  }, [draftStart, draftEnd, selectedDayOffset, selectedHour, isReturnTripMode, newBikeType, newSpeed, unitSystem, hudState]);

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
    
    if (route.coordinates && route.segments) {
      setRouteCoordinates(route.coordinates);
      setRouteSegments(route.segments);
      fetchRouteWeather(route.coordinates, route.distance || 10).then(weatherData => {
        setWeatherResults(weatherData);
      }).catch(e => console.error("Error fetching weather for loaded route:", e));
      setHudState(2);
    } else {
      loadRouteDetails(route.start, route.end, newBikeType, newSpeed);
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
                newBikeType, 
                newSpeed
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
  }, [weeklySchedule, savedRoutes, scheduledRoutesWeather, newBikeType, newSpeed]);

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
        startLocation: draftEnd,
        endLocation: draftStart,
        speed: newSpeed,
        name: "Active Route (Return)"
      };
    }

    return {
      coordinates: routeCoordinates,
      segments: routeSegments,
      weatherResults: activeWeatherResults,
      startLocation: draftStart,
      endLocation: draftEnd,
      speed: newSpeed,
      name: "Active Route"
    };
  };

  const activeRouteData = getActiveRouteData();

  // Debounced map viewport move callback for panning updates
  const handleMapMove = useCallback((coord) => {
    if (isLoading) return;

    if (geocodeTimeoutRef.current) {
      clearTimeout(geocodeTimeoutRef.current);
    }

    geocodeTimeoutRef.current = setTimeout(async () => {
      setBaseWeatherLocationName("Map Viewport");
      fetchAmbientWeather(coord.lat, coord.lon);
    }, 500); // 500ms panning debounce
  }, [fetchAmbientWeather, isLoading]);



  // Get active forecast details for Top HUD bubbles (declared before accessed by packing logic)
  const getActiveForecast = () => {
    if (!activeRouteData || !activeRouteData.segments || activeRouteData.segments.length === 0 || !activeRouteData.weatherResults || activeRouteData.weatherResults.length === 0) return null;
    
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

  const activeForecast = getActiveForecast();

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

      let destinationName = "Destination";
      if (boundRoute) {
        destinationName = boundRoute.end.label.split(",")[0] || "Destination";
      } else if (draftEnd) {
        destinationName = draftEnd.label.split(",")[0] || "Destination";
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
          userLocation={userLocation}
          ambientWeatherForecast={ambientWeatherForecast}
          onMapMove={handleMapMove}
        />
      </div>

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

          {/* State 2 & 3: Active Route Score bubble */}
          {(hudState === 2 || hudState === 3) && activeForecast && (
            <div className={`hud-bubble ${styles.weatherBubble}`}>
              <div 
                className={`${styles.pulseDot} ${activeForecast.score >= 85 ? "hud-pulse-emerald" : activeForecast.score >= 50 ? "hud-pulse-amber" : "hud-pulse-ruby"}`}
                style={{
                  background: activeForecast.score >= 85 ? "var(--color-emerald)" : activeForecast.score >= 50 ? "var(--color-amber)" : "var(--color-ruby)",
                  boxShadow: `0 0 10px ${activeForecast.score >= 85 ? "var(--color-emerald-glow)" : activeForecast.score >= 50 ? "var(--color-amber-glow)" : "var(--color-ruby-glow)"}`
                }} 
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
                className={styles.clearRouteBtn}
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
              className={`hud-bubble ${styles.hubBtn}`}
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
          )}

          {/* Weekly Schedule Planner Trigger (Permanently Available in States 0, 2, 3) */}
          {(hudState === 0 || hudState === 2 || hudState === 3) && (
            <button 
              className={`hud-bubble ${styles.hubBtn}`}
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

          {/* Saved Routes Dropdown overlay */}
          {isSavedHubOpen && (hudState === 0 || hudState === 2 || hudState === 3) && (
            <div className={`${styles.savedRoutesHubDropdown} hud-card hud-card-responsive`}>
              <div className={styles.hubDropdownHeader}>
                <h4 className={styles.hubDropdownTitle}>🔖 Saved Routes</h4>
                <button onClick={() => setIsSavedHubOpen(false)} className={styles.closeBtn}><X size={14} /></button>
              </div>
              {savedRoutes.length === 0 ? (
                <p className={styles.emptyMsg}>No saved routes yet. Plan a route and save it to display here.</p>
              ) : (
                savedRoutes.map((route) => (
                  <div 
                    key={route.id} 
                    className={`hud-btn ${styles.savedRouteItem}`} 
                    onClick={() => handleLoadSavedRoute(route)}
                  >
                    <span className={styles.savedRouteText}>{route.name}</span>
                    <button 
                      onClick={(e) => handleDeleteSavedRoute(route.id, e)} 
                      className={styles.deleteRouteBtn}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* Right Side: Unit Toggle, Ambient Weather & Gear Check HUD */}
        <div className={`hud-top-right ${styles.topRightControls}`}>
          
          {/* Rider Configuration Bubble */}
          <button 
            className={`hud-bubble ${styles.riderConfigBtn}`} 
            onClick={toggleRiderConfig}
            style={{ border: isRiderConfigOpen ? "1.5px solid var(--color-emerald)" : "1px solid var(--hud-border)" }}
            title="Rider Profile Configurations"
          >
            <span>🚴</span> <span className="mobile-hide">RIDER PROFILE</span>
          </button>

          {/* Expanded Rider Configurations Glass Card */}
          {isRiderConfigOpen && (
            <div className={`${styles.riderConfigDropdown} hud-card hud-card-responsive`}>
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

          {/* Metric / Imperial Toggling Bubble */}
          <button 
            className={`hud-bubble ${styles.unitsBtn}`} 
            onClick={() => setUnitSystem(unitSystem === "metric" ? "imperial" : "metric")}
            title="Switch Units"
          >
            📐 <span className="mobile-hide">{unitSystem === "metric" ? "METRIC" : "IMPERIAL"}</span>
          </button>

          {dynamicAmbientWeather && (
            <div className={`hud-bubble ${styles.weatherBubble}`} title={`Location: ${dynamicAmbientWeather.desc}`}>
              <SunDim size={16} className={styles.sunDimIcon} style={{ animation: "spin 12s linear infinite" }} />
              <span className={styles.weatherText}>
                <span style={{ color: "var(--color-emerald)", fontWeight: "800", marginRight: "4px" }}>
                  {dynamicAmbientWeather.desc}:
                </span>
                {formatTemp(dynamicAmbientWeather.temp)}
                <span className="mobile-hide"> • {formatWind(dynamicAmbientWeather.windSpeed)} {dynamicAmbientWeather.windDir}</span>
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
                <div className={`${styles.packingDropdown} hud-card hud-card-responsive`}>
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
            </>
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
          <div className={`${styles.setupSearchContainer} hud-zoom-center`}>
            <div className={`hud-card ${styles.setupCard}`}>
              
              <div className={styles.setupHeader}>
                <span className={styles.setupTitle}>Plan Custom Route</span>
                <button onClick={() => setHudState(0)} className={styles.closeBtn}><X size={16} /></button>
              </div>

              {/* Start input */}
              <div className={styles.relativeWrapper}>
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
                  <div className={`${styles.setupDropBox} hud-card`}>
                    {startResults.map((loc, idx) => (
                      <div 
                        key={idx} 
                        className={`hud-btn ${styles.setupDropItem}`} 
                        onClick={() => {
                          setDraftStart(loc);
                          setStartQuery(loc.label);
                          setStartResults([]);
                        }}
                      >
                        {loc.label}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* End input */}
              <div className={styles.relativeWrapper}>
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
                  <div className={`${styles.setupDropBox} hud-card`}>
                    {endResults.map((loc, idx) => (
                      <div 
                        key={idx} 
                        className={`hud-btn ${styles.setupDropItem}`} 
                        onClick={() => {
                          setDraftEnd(loc);
                          setEndQuery(loc.label);
                          setEndResults([]);
                        }}
                      >
                        {loc.label}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Save Route Persistence Toggle */}
              <div className={styles.saveToggleRow}>
                <label className={styles.checkboxLabel}>
                  <input 
                    type="checkbox" 
                    checked={shouldSaveRoute} 
                    onChange={(e) => setShouldSaveRoute(e.target.checked)}
                    className={styles.checkboxInput}
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
                className={`${styles.confirmBtn} hud-btn active`}
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

          <div className={`${styles.ribbonBox} hud-card`}>
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
            <div className={`${styles.scrubberContainer} hud-card timeline-scrubber-container`}>
              {/* Timeline Scrubber */}
              <div style={{ display: "flex", alignItems: "center", gap: "10px", flex: 1, flexWrap: "wrap" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>
                  <Clock size={14} style={{ color: "var(--hud-text-secondary)" }} />
                  <span style={{ fontSize: "0.78rem", fontWeight: "700", width: "64px" }}>
                    {selectedHour.toString().padStart(2, "0")}:00 {selectedHour >= 12 ? "PM" : "AM"}
                  </span>
                </div>

                {/* Active Direction Badge */}
                {activeRouteData.endLocation && (
                  <span style={{ 
                    fontSize: "0.72rem", 
                    fontWeight: "600", 
                    color: isReturnTripMode ? "var(--color-amber)" : "var(--color-emerald)",
                    background: isReturnTripMode ? "rgba(245,158,11,0.12)" : "rgba(16,185,129,0.12)",
                    border: isReturnTripMode ? "1px solid rgba(245,158,11,0.2)" : "1px solid rgba(16,185,129,0.2)",
                    padding: "2px 8px",
                    borderRadius: "12px",
                    display: "flex",
                    alignItems: "center",
                    gap: "4px",
                    whiteSpace: "nowrap",
                    flexShrink: 0
                  }}>
                    {isReturnTripMode ? "🌇 Inbound" : "🌅 Outbound"}
                  </span>
                )}

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
                  <input 
                    type="time" 
                    value={weeklySchedule[currentDayOfWeek]?.outbound || "08:00"}
                    onChange={(e) => updateDailySchedule(selectedDayOffset, 'outbound', e.target.value)}
                    className={styles.timeFieldInput}
                  />
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                  <span style={{ fontSize: "0.68rem", color: "var(--hud-text-secondary)" }}>Return:</span>
                  <input 
                    type="time" 
                    value={weeklySchedule[currentDayOfWeek]?.return || "17:30"}
                    onChange={(e) => updateDailySchedule(selectedDayOffset, 'return', e.target.value)}
                    className={styles.timeFieldInput}
                  />
                </div>
              </div>

              {/* Exit day focus button */}
              <button 
                onClick={() => setHudState(2)} // Return to Week-wide ambient outlook
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
        <div className={`${styles.weeklyPlannerPanel} hud-card hud-card-responsive`}>
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
                  <option key={r.id} value={r.id}>🔖 {r.name}</option>
                ))}
              </select>
            </div>

            {/* Bulk Times */}
            <div style={{ display: "flex", gap: "8px" }}>
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "4px" }}>
                <span style={{ fontSize: "0.66rem", color: "var(--hud-text-secondary)" }}>Arrive by</span>
                <input
                  type="time"
                  value={bulkOutbound}
                  onChange={(e) => setBulkOutbound(e.target.value)}
                  className={styles.bulkTimeFieldInput}
                />
              </div>
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "4px" }}>
                <span style={{ fontSize: "0.66rem", color: "var(--hud-text-secondary)" }}>Leave at</span>
                <input
                  type="time"
                  value={bulkReturn}
                  onChange={(e) => setBulkReturn(e.target.value)}
                  className={styles.bulkTimeFieldInput}
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
                        {group.routeName}
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

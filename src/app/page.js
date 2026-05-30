"use client";

import { useState, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import { 
  Bike, Plus, Trash2, Calendar, Clock, MapPin, Navigation, 
  Search, ShieldAlert, Sparkles, Sun, Compass, Play, 
  Check, ChevronRight, X, ArrowLeftRight, HelpCircle
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
      background: "#f8fafc",
      color: "var(--slate-500)",
      fontSize: "0.95rem",
      fontWeight: "500"
    }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "10px" }}>
        <Bike size={36} style={{ color: "var(--primary)", animation: "pulse 2s infinite" }} />
        <span>Powering Biking Forecast Environment...</span>
      </div>
    </div>
  )
});

// Beautiful floating widgets
import ScoreMetric from "@/components/ScoreMetric";
import WeatherDetails from "@/components/WeatherDetails";

const INITIAL_SCHEDULE = {
  commutes: {
    1: { enabled: false, bikeType: "Hybrid", customSpeed: 18, outbound: null, return: null },
    2: { enabled: false, bikeType: "Hybrid", customSpeed: 18, outbound: null, return: null },
    3: { enabled: false, bikeType: "Hybrid", customSpeed: 18, outbound: null, return: null },
    4: { enabled: false, bikeType: "Hybrid", customSpeed: 18, outbound: null, return: null },
    5: { enabled: false, bikeType: "Hybrid", customSpeed: 18, outbound: null, return: null },
    6: { enabled: false, bikeType: "Hybrid", customSpeed: 18, outbound: null, return: null },
    0: { enabled: false, bikeType: "Hybrid", customSpeed: 18, outbound: null, return: null }
  },
  oneTimeRides: [],
  leisureRides: []
};

const BIKE_TYPES = [
  { id: "Road", name: "Road Bike", speed: 24, icon: "🚴" },
  { id: "Hybrid", name: "Hybrid / Commuter", speed: 18, icon: "🚲" },
  { id: "Mountain", name: "Mountain Bike", speed: 16, icon: "🚵" },
  { id: "Cargo", name: "Cargo / Heavy", speed: 14, icon: "🚲" },
  { id: "E-Bike", name: "Electric Bike", speed: 25, icon: "⚡" }
];

const WEEKDAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAYS_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export default function Home() {
  // Time state (seamless time zoom level)
  const [timeZoom, setTimeZoom] = useState("Now"); // "Now" | "Today" | "Week"
  const [selectedDay, setSelectedDay] = useState(0); // 0 (Today) to 6 (Day+6)
  const [selectedHour, setSelectedHour] = useState(8); // 0 to 23

  // Core schedules storage
  const [weeklySchedule, setWeeklySchedule] = useState(INITIAL_SCHEDULE);

  // Active highlighted ride selection
  const [activeRideType, setActiveRideType] = useState("commute"); // "commute" | "oneTime" | "leisure"
  const [activeCommuteDay, setActiveCommuteDay] = useState(1); // Default to Monday
  const [commuteDirection, setCommuteDirection] = useState("outbound"); // "outbound" | "return"
  const [activeOneTimeId, setActiveOneTimeId] = useState(null);
  const [activeLeisureId, setActiveLeisureId] = useState(null);

  // Map drawing / trip adder overlay state
  const [isAddingTrip, setIsAddingTrip] = useState(false);
  const [newTripType, setNewTripType] = useState("commute"); // "commute" | "oneTime" | "leisure"
  const [startQuery, setStartQuery] = useState("");
  const [endQuery, setEndQuery] = useState("");
  const [startResults, setStartResults] = useState([]);
  const [endResults, setEndResults] = useState([]);
  const [isSearchingStart, setIsSearchingStart] = useState(false);
  const [isSearchingEnd, setIsSearchingEnd] = useState(false);

  // Draft route points
  const [draftStart, setDraftStart] = useState(null);
  const [draftEnd, setDraftEnd] = useState(null);

  // Form details for new trip behaviors
  const [newCommuteDays, setNewCommuteDays] = useState({ 1: true, 2: true, 3: true, 4: true, 5: true, 6: false, 0: false });
  const [newOutboundTime, setNewOutboundTime] = useState("08:30");
  const [newReturnTime, setNewReturnTime] = useState("17:30");
  const [newCustomReturn, setNewCustomReturn] = useState(false);
  const [newOneTimeDate, setNewOneTimeDate] = useState("");
  const [newOneTimeTime, setNewOneTimeTime] = useState("12:00");
  const [newLeisureName, setNewLeisureName] = useState("Park Loop");
  const [newBikeType, setNewBikeType] = useState("Hybrid");
  const [newSpeed, setNewSpeed] = useState(18);

  // API loading & results
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [routeCoordinates, setRouteCoordinates] = useState([]);
  const [routeSegments, setRouteSegments] = useState([]);
  const [weatherResults, setWeatherResults] = useState([]);
  const [sampledCoords, setSampledCoords] = useState([]);

  // Client-side ambient weather for "Now" location geocode
  const [userLocation, setUserLocation] = useState(null);
  const [unitSystem, setUnitSystem] = useState("metric"); // "metric" | "imperial"
  const geocodeTimeoutRef = useRef(null);

  // Responsive & collapsible panel state variables
  const [isMobileView, setIsMobileView] = useState(false);
  const [isLeftCollapsed, setIsLeftCollapsed] = useState(false);
  const [isRightCollapsed, setIsRightCollapsed] = useState(false);
  const [hasMounted, setHasMounted] = useState(false);

  useEffect(() => {
    setHasMounted(true);
  }, []);

  // Geolocation lookup on boot
  useEffect(() => {
    // Load weeklySchedule from localStorage
    const saved = localStorage.getItem("biking_forecast_data");
    if (saved) {
      try {
        setWeeklySchedule(JSON.parse(saved));
      } catch (e) {
        console.error("Error loading localStorage:", e);
      }
    }

    // Capture user coordinates
    if (typeof window !== "undefined" && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const loc = { lat: position.coords.latitude, lon: position.coords.longitude, label: "My Coordinates" };
          setUserLocation(loc);
          fetchAmbientWeather(loc.lat, loc.lon);
        },
        () => {
          // Default to Central Park NY
          const fallback = { lat: 40.7851, lon: -73.9682, label: "New York City" };
          setUserLocation(fallback);
          fetchAmbientWeather(fallback.lat, fallback.lon);
        }
      );
    } else {
      // Insecure context (HTTP local IP) or unsupported browser - Fallback to Central Park NY
      const fallback = { lat: 40.7851, lon: -73.9682, label: "New York City" };
      setUserLocation(fallback);
      fetchAmbientWeather(fallback.lat, fallback.lon);
    }
    
    // Set default selected hour to current browser hour
    const currHour = new Date().getHours();
    setSelectedHour(currHour);
  }, []);

  // Responsive mobile size listener
  useEffect(() => {
    const handleResize = () => {
      const isMobile = window.innerWidth < 768;
      setIsMobileView(isMobile);
      // Auto-collapse sidebars on mobile, expand on desktop
      setIsLeftCollapsed(isMobile);
      setIsRightCollapsed(isMobile);
    };
    
    handleResize(); // Initial sizing
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Helper to get 0-6 day offset from today for a given weekday (1 = Monday, ..., 0 = Sunday)
  const getDayOffsetFromDayOfWeek = (targetDayOfWeek) => {
    const todayDayOfWeek = new Date().getDay(); // 0 is Sunday, 1 is Monday, etc.
    let offset = targetDayOfWeek - todayDayOfWeek;
    if (offset < 0) {
      offset += 7;
    }
    return offset;
  };

  // Helper to compile scheduled day & hour parameters for active selections
  const getScheduledDayAndHour = () => {
    let dayOffset = null;
    let hour = null;
    let label = "";

    if (activeRideType === "commute") {
      const dayConfig = weeklySchedule.commutes[activeCommuteDay];
      if (dayConfig && dayConfig.enabled) {
        dayOffset = getDayOffsetFromDayOfWeek(activeCommuteDay);
        const timeStr = commuteDirection === "outbound" 
          ? dayConfig.outbound?.time 
          : dayConfig.return?.time;
        if (timeStr) {
          hour = parseInt(timeStr.split(":")[0]);
        }
        label = `${WEEKDAYS_FULL[activeCommuteDay]} Commute (${commuteDirection === "outbound" ? "Morning Leg" : "Evening Leg"} - ${timeStr || "N/A"})`;
      }
    } else if (activeRideType === "oneTime") {
      const ride = weeklySchedule.oneTimeRides.find(r => r.id === activeOneTimeId);
      if (ride) {
        try {
          const rideDate = new Date(ride.date + "T00:00:00");
          const todayDate = new Date();
          todayDate.setHours(0, 0, 0, 0);
          const diffTime = rideDate - todayDate;
          const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
          dayOffset = Math.max(0, Math.min(6, diffDays));
        } catch (e) {
          dayOffset = 0;
        }
        const timeStr = ride.time;
        if (timeStr) {
          hour = parseInt(timeStr.split(":")[0]);
        }
        label = `One-Time Ride (${ride.date} at ${timeStr || "N/A"})`;
      }
    } else if (activeRideType === "leisure") {
      const ride = weeklySchedule.leisureRides.find(r => r.id === activeLeisureId);
      if (ride) {
        label = `Leisure: ${ride.name}`;
      }
    }

    return { dayOffset, hour, label };
  };

  // Snapping Ref and Effect to sync temporal sliders when active ride changes
  const lastActiveRideRef = useRef({ type: null, day: null, dir: null, oneTimeId: null, leisureId: null });
  
  useEffect(() => {
    const currentRide = {
      type: activeRideType,
      day: activeCommuteDay,
      dir: commuteDirection,
      oneTimeId: activeOneTimeId,
      leisureId: activeLeisureId
    };
    
    const hasRideChanged = 
      currentRide.type !== lastActiveRideRef.current.type ||
      currentRide.day !== lastActiveRideRef.current.day ||
      currentRide.dir !== lastActiveRideRef.current.dir ||
      currentRide.oneTimeId !== lastActiveRideRef.current.oneTimeId ||
      currentRide.leisureId !== lastActiveRideRef.current.leisureId;
      
    if (hasRideChanged) {
      const { dayOffset, hour } = getScheduledDayAndHour();
      if (dayOffset !== null) {
        setSelectedDay(dayOffset);
      }
      if (hour !== null) {
        setSelectedHour(hour);
        setTimeZoom("Today"); // Automatically snap into Today view to show scrubber directly
      }
      lastActiveRideRef.current = currentRide;
    }
  }, [activeRideType, activeCommuteDay, commuteDirection, activeOneTimeId, activeLeisureId, weeklySchedule]);

  // Fetch single-point weather when no route is planned to animate the ambient HUD
  const fetchAmbientWeather = async (lat, lon) => {
    try {
      const dummyCoords = [[lat, lon]];
      const weather = await fetchRouteWeather(dummyCoords, 1);
      setWeatherResults(weather);
      setSampledCoords([[lat, lon]]);
    } catch (err) {
      console.error("Error fetching ambient weather:", err);
    }
  };

  // Dynamically query API whenever active ride or time details shift
  useEffect(() => {
    loadForecastForActiveRide();
  }, [
    activeRideType, 
    activeCommuteDay, 
    commuteDirection, 
    activeOneTimeId, 
    activeLeisureId, 
    weeklySchedule, 
    timeZoom, 
    selectedDay
  ]);

  const loadForecastForActiveRide = async () => {
    setError(null);
    let startLoc = null;
    let endLoc = null;
    let bikeType = "Hybrid";
    let speed = 18;

    if (activeRideType === "commute") {
      const dayConfig = weeklySchedule.commutes[activeCommuteDay];
      if (dayConfig && dayConfig.enabled) {
        bikeType = dayConfig.bikeType;
        speed = dayConfig.customSpeed;
        if (commuteDirection === "outbound" && dayConfig.outbound) {
          startLoc = dayConfig.outbound.start;
          endLoc = dayConfig.outbound.end;
        } else if (commuteDirection === "return" && dayConfig.return) {
          startLoc = dayConfig.return.start;
          endLoc = dayConfig.return.end;
        }
      }
    } else if (activeRideType === "oneTime") {
      const ride = weeklySchedule.oneTimeRides.find(r => r.id === activeOneTimeId);
      if (ride) {
        startLoc = ride.start;
        endLoc = ride.end;
        bikeType = ride.bikeType;
        speed = ride.customSpeed;
      }
    } else if (activeRideType === "leisure") {
      const ride = weeklySchedule.leisureRides.find(r => r.id === activeLeisureId);
      if (ride) {
        startLoc = ride.start;
        endLoc = ride.end;
        bikeType = ride.bikeType;
        speed = ride.customSpeed;
      }
    }

    if (!startLoc || !endLoc) {
      // Clear route rendering, fallback to ambient overlays at map center
      setRouteCoordinates([]);
      setRouteSegments([]);
      if (userLocation) {
        fetchAmbientWeather(userLocation.lat, userLocation.lon);
      }
      return;
    }

    setIsLoading(true);
    try {
      // 1. Fetch bicycle route from Valhalla
      const routeData = await fetchBicycleRoute(startLoc.lat, startLoc.lon, endLoc.lat, endLoc.lon, bikeType, speed);
      const decodedCoords = decodePolyline6(routeData.shape);
      setRouteCoordinates(decodedCoords);

      // 2. Compute segments
      const segments = calculateRouteSegments(decodedCoords);
      setRouteSegments(segments);

      // 3. Fetch Open-Meteo weather
      const weatherData = await fetchRouteWeather(decodedCoords, routeData.distance);
      setWeatherResults(weatherData);
      
      const numSamples = weatherData.length;
      setSampledCoords(sampleCoordinates(decodedCoords, numSamples));
    } catch (err) {
      console.error(err);
      setError(err.message || "Routing pipeline calculations failed.");
    } finally {
      setIsLoading(false);
    }
  };

  // Sync state writes back to localStorage
  const saveWeeklySchedule = (newSchedule) => {
    setWeeklySchedule(newSchedule);
    localStorage.setItem("biking_forecast_data", JSON.stringify(newSchedule));
  };

  // Location Geocoding queries with hybrid instant & debounced triggers (CORS/Rate-limit resilient)
  const triggerGeocode = (query, isStart, forceInstant = false) => {
    if (!query || query.trim().length < 3) {
      if (isStart) setStartResults([]);
      else setEndResults([]);
      return;
    }

    if (geocodeTimeoutRef.current) {
      clearTimeout(geocodeTimeoutRef.current);
    }

    const runQuery = async () => {
      if (isStart) {
        setIsSearchingStart(true);
        const res = await geocodeAddress(query);
        setStartResults(res);
        setIsSearchingStart(false);
      } else {
        setIsSearchingEnd(true);
        const res = await geocodeAddress(query);
        setEndResults(res);
        setIsSearchingEnd(false);
      }
    };

    if (forceInstant) {
      runQuery();
    } else {
      // Debounce for 800ms to strictly comply with Nominatim/Komoot rate limits
      geocodeTimeoutRef.current = setTimeout(runQuery, 800);
    }
  };

  const handleSelectAutocomplete = (loc, isStart) => {
    if (isStart) {
      setDraftStart(loc);
      setStartQuery(loc.label);
      setStartResults([]);
    } else {
      setDraftEnd(loc);
      setEndQuery(loc.label);
      setEndResults([]);
    }
  };

  // Direct map tapping listener fallback (wired to RouteMap callback)
  const handleMapClick = (coord) => {
    if (!isAddingTrip) return;
    const mockLabel = `Coord (${coord.lat.toFixed(4)}, ${coord.lon.toFixed(4)})`;
    const loc = { lat: coord.lat, lon: coord.lon, label: mockLabel };
    if (!draftStart) {
      setDraftStart(loc);
      setStartQuery(mockLabel);
    } else if (!draftEnd) {
      setDraftEnd(loc);
      setEndQuery(mockLabel);
    }
  };

  const handleUseCurrentLocation = () => {
    if (typeof window !== "undefined" && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const mockLabel = `My Location (${position.coords.latitude.toFixed(4)}, ${position.coords.longitude.toFixed(4)})`;
          const loc = { lat: position.coords.latitude, lon: position.coords.longitude, label: mockLabel };
          setDraftStart(loc);
          setStartQuery(mockLabel);
        },
        (error) => {
          alert("Geolocation failed or permission denied. Note: Modern browsers require a secure connection (HTTPS) or localhost to access current location. Please manually enter a starting address.");
        }
      );
    } else {
      alert("Geolocation is unavailable on this connection. Modern mobile browsers block geolocation on insecure connections (HTTP). Please manually enter a starting address.");
    }
  };

  // Complete adding trip & register behavior intent overlay
  const handleAddTrip = () => {
    if (!draftStart || !draftEnd) {
      alert("Please specify a starting location and destination.");
      return;
    }

    const updated = { ...weeklySchedule };

    if (newTripType === "commute") {
      // Save for each selected day
      Object.keys(newCommuteDays).forEach(dayIdx => {
        if (newCommuteDays[dayIdx]) {
          updated.commutes[dayIdx] = {
            enabled: true,
            bikeType: newBikeType,
            customSpeed: newSpeed,
            outbound: {
              start: draftStart,
              end: draftEnd,
              time: newOutboundTime
            },
            return: {
              start: draftEnd,
              end: draftStart,
              time: newReturnTime,
              useCustom: false
            }
          };
        }
      });
      // Active newly added commute day
      const firstActiveDay = Object.keys(newCommuteDays).find(k => newCommuteDays[k] === true) || 1;
      setActiveCommuteDay(parseInt(firstActiveDay));
      setActiveRideType("commute");
      setCommuteDirection("outbound");
    } else if (newTripType === "oneTime") {
      const newRide = {
        id: Date.now().toString(),
        date: newOneTimeDate || new Date().toISOString().split("T")[0],
        time: newOneTimeTime,
        start: draftStart,
        end: draftEnd,
        bikeType: newBikeType,
        customSpeed: newSpeed
      };
      updated.oneTimeRides.push(newRide);
      setActiveOneTimeId(newRide.id);
      setActiveRideType("oneTime");
    } else if (newTripType === "leisure") {
      const newRide = {
        id: Date.now().toString(),
        name: newLeisureName,
        start: draftStart,
        end: draftEnd,
        bikeType: newBikeType,
        customSpeed: newSpeed
      };
      updated.leisureRides.push(newRide);
      setActiveLeisureId(newRide.id);
      setActiveRideType("leisure");
    }

    saveWeeklySchedule(updated);
    setIsAddingTrip(false);
    
    // Clear search form
    setDraftStart(null);
    setDraftEnd(null);
    setStartQuery("");
    setEndQuery("");
  };

  const handleDeleteRide = (type, idKey, e) => {
    e.stopPropagation();
    const updated = { ...weeklySchedule };
    
    if (type === "commute") {
      updated.commutes[idKey] = { enabled: false, outbound: null, return: null, bikeType: "Hybrid", customSpeed: 18 };
      // Resolve switch
      const nextActive = Object.keys(updated.commutes).find(k => updated.commutes[k].enabled);
      if (nextActive) {
        setActiveCommuteDay(parseInt(nextActive));
      } else {
        setActiveRideType("leisure");
      }
    } else if (type === "oneTime") {
      updated.oneTimeRides = updated.oneTimeRides.filter(r => r.id !== idKey);
      if (updated.oneTimeRides.length > 0) {
        setActiveOneTimeId(updated.oneTimeRides[0].id);
      } else {
        setActiveRideType("commute");
      }
    } else if (type === "leisure") {
      updated.leisureRides = updated.leisureRides.filter(r => r.id !== idKey);
      if (updated.leisureRides.length > 0) {
        setActiveLeisureId(updated.leisureRides[0].id);
      } else {
        setActiveRideType("commute");
      }
    }

    saveWeeklySchedule(updated);
  };

  // Compile suitability forecast details for active selections
  const currentHourIdx = selectedDay * 24 + selectedHour;
  const currentForecast = (weatherResults.length > 0 && routeSegments.length > 0)
    ? calculateCommuteScore(currentHourIdx, routeSegments, newSpeed, weatherResults)
    : null;

  return (
    <div style={{
      position: "relative",
      width: "100vw",
      height: "100vh",
      overflow: "hidden",
      background: "#ffffff"
    }}>
      
      {/* 2. CORE INTERACTIVE LEAFLET ENVIRONMENT (ABSOLUTE MAP BACKDROP) */}
      <div style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", zIndex: "1" }}>
        <RouteMap
          coordinates={routeCoordinates}
          startLocation={
            activeRideType === "commute"
              ? (commuteDirection === "outbound" ? weeklySchedule.commutes[activeCommuteDay]?.outbound?.start : weeklySchedule.commutes[activeCommuteDay]?.return?.start)
              : (activeRideType === "oneTime" ? weeklySchedule.oneTimeRides.find(r => r.id === activeOneTimeId)?.start : weeklySchedule.leisureRides.find(r => r.id === activeLeisureId)?.start)
          }
          endLocation={
            activeRideType === "commute"
              ? (commuteDirection === "outbound" ? weeklySchedule.commutes[activeCommuteDay]?.outbound?.end : weeklySchedule.commutes[activeCommuteDay]?.return?.end)
              : (activeRideType === "oneTime" ? weeklySchedule.oneTimeRides.find(r => r.id === activeOneTimeId)?.end : weeklySchedule.leisureRides.find(r => r.id === activeLeisureId)?.end)
          }
          routeSegments={routeSegments}
          weatherResults={weatherResults}
          selectedDay={selectedDay}
          selectedHour={selectedHour}
          customSpeed={newSpeed}
          isDrawingMode={isAddingTrip}
          onMapClick={handleMapClick}
          unitSystem={unitSystem}
        />
      </div>

      {/* 1. PERSISTENT HEADER HUD BRANDING */}
      {hasMounted && (
        <>
          <header className="main-header" style={{
            position: "absolute",
            top: isMobileView ? "60px" : "20px",
            left: isMobileView ? "10px" : "20px",
            right: isMobileView ? "10px" : "auto",
            width: isMobileView ? "calc(100% - 20px)" : "auto",
            zIndex: "9999", // Elevate to sit reliably on top of all Leaflet internal pane stacks
            transform: "translate3d(0, 0, 0)", // Promote to compositing layer to clear WebKit/iOS Leaflet overlay bugs
            display: "flex",
            alignItems: "center",
            gap: isMobileView ? "8px" : "16px",
            pointerEvents: "auto"
          }}>
        <div className="header-logo" style={{
          background: "linear-gradient(135deg, var(--primary), var(--primary-hover))",
          width: "44px",
          height: "44px",
          borderRadius: "14px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "0 8px 20px rgba(79, 70, 229, 0.35)"
        }}>
          <Bike size={24} style={{ color: "white" }} />
        </div>
        <div className="glass-panel glass-panel-header" style={{
          padding: isMobileView ? "6px 12px" : "8px 18px",
          display: "flex",
          alignItems: "center",
          gap: isMobileView ? "8px" : "16px",
          flexGrow: isMobileView ? 1 : 0,
          flexShrink: 1,
          minWidth: 0,
          justifyContent: "space-between",
          width: "100%"
        }}>
          <div style={{ minWidth: 0, flexShrink: 1, marginRight: "4px" }}>
            <h1 style={{ 
              fontSize: isMobileView ? "0.9rem" : "1.2rem", 
              fontWeight: "800", 
              letterSpacing: "-0.02em", 
              color: "var(--slate-900)",
              whiteSpace: "nowrap",
              textOverflow: "ellipsis",
              overflow: "hidden"
            }}>
              Biking Forecast
            </h1>
            <p className="header-subtitle" style={{ fontSize: "0.68rem", color: "var(--slate-500)", fontWeight: "600" }}>
              Living Map-based HUD
            </p>
          </div>

          {/* Unit Toggle in Header: Only render on desktop to save space on mobile */}
          <div className="header-unit-toggle" style={{
            display: "flex",
            background: "#f1f5f9",
            padding: "2px",
            borderRadius: "8px",
            border: "1px solid rgba(226, 232, 240, 0.8)",
            boxShadow: "inset 0 1px 2px rgba(0,0,0,0.03)"
          }}>
            <button
              onClick={() => setUnitSystem("metric")}
              style={{
                padding: "4px 10px",
                borderRadius: "6px",
                border: "none",
                background: unitSystem === "metric" ? "#ffffff" : "transparent",
                color: unitSystem === "metric" ? "var(--primary)" : "var(--slate-500)",
                fontSize: "0.68rem",
                fontWeight: "800",
                cursor: "pointer",
                boxShadow: unitSystem === "metric" ? "0 1px 3px rgba(0,0,0,0.06)" : "none",
                transition: "all 0.15s ease"
              }}
            >
              Metric
            </button>
            <button
              onClick={() => setUnitSystem("imperial")}
              style={{
                padding: "4px 10px",
                borderRadius: "6px",
                border: "none",
                background: unitSystem === "imperial" ? "#ffffff" : "transparent",
                color: unitSystem === "imperial" ? "var(--primary)" : "var(--slate-500)",
                fontSize: "0.68rem",
                fontWeight: "800",
                cursor: "pointer",
                boxShadow: unitSystem === "imperial" ? "0 1px 3px rgba(0,0,0,0.06)" : "none",
                transition: "all 0.15s ease"
              }}
            >
              Imperial
            </button>
          </div>

          <button 
            onClick={() => {
              setIsAddingTrip(true);
              setIsLeftCollapsed(true);
              setIsRightCollapsed(true);
            }}
            style={{
              padding: isMobileView ? "5px 10px" : "6px 12px",
              background: "var(--primary)",
              color: "white",
              border: "none",
              borderRadius: "8px",
              fontSize: isMobileView ? "0.72rem" : "0.78rem",
              fontWeight: "700",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: isMobileView ? "4px" : "6px",
              boxShadow: "0 4px 10px rgba(79, 70, 229, 0.25)",
              flexShrink: 0 // Prevents flex layout from squishing button to 0px width on narrow mobile viewports
            }}
          >
            <Plus size={isMobileView ? 12 : 14} /> 
            <span>Add Trip</span>
          </button>
        </div>
      </header>

      {/* --- TEMPORAL STATUS HUD BANNER (SCRUBBER LENS) --- */}
      {hasMounted && (() => {
        const { dayOffset: schedDay, hour: schedHour, label: schedLabel } = getScheduledDayAndHour();
        if (!schedLabel) return null;
        const isScrubbedAway = schedDay !== null && schedHour !== null && (selectedDay !== schedDay || selectedHour !== schedHour);
        
        return (
          <div className="scrubber-lens-container" style={{
            position: "absolute",
            top: isMobileView ? "118px" : "84px",
            left: "50%",
            transform: "translate3d(-50%, 0, 0)", // 3D center and hardware promote
            zIndex: "9999", // Ensure it sits cleanly above Leaflet overlay tiles
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            pointerEvents: "auto",
            width: "max-content",
            maxWidth: "calc(100% - 20px)"
          }}>
            <div className="glass-panel" style={{
              padding: "6px 14px",
              display: "flex",
              alignItems: "center",
              gap: "8px",
              boxShadow: "0 10px 30px rgba(0,0,0,0.06)",
              borderRadius: "20px",
              border: isScrubbedAway ? "1px solid rgba(217, 119, 6, 0.3)" : "1px solid rgba(16, 185, 129, 0.3)",
              background: "var(--card-bg)"
            }}>
              <span style={{
                width: "8px",
                height: "8px",
                borderRadius: "50%",
                background: isScrubbedAway ? "var(--amber)" : "var(--emerald)",
                display: "inline-block",
                boxShadow: isScrubbedAway ? "none" : "0 0 8px var(--emerald)",
                animation: isScrubbedAway ? "none" : "pulse-grow 2s infinite"
              }}></span>
              <span style={{ fontSize: "0.72rem", fontWeight: "800", color: "var(--slate-800)" }}>
                {isScrubbedAway ? "Free Scrubbing Mode" : "Viewing Scheduled Ride"}
              </span>
              <span style={{ fontSize: "0.68rem", color: "var(--slate-500)", fontWeight: "500" }}>
                ({schedLabel})
              </span>
              {isScrubbedAway && (
                <button
                  onClick={() => {
                    if (schedDay !== null) setSelectedDay(schedDay);
                    if (schedHour !== null) setSelectedHour(schedHour);
                    setTimeZoom("Today");
                  }}
                  style={{
                    padding: "3px 10px",
                    background: "var(--primary)",
                    color: "white",
                    border: "none",
                    borderRadius: "12px",
                    fontSize: "0.65rem",
                    fontWeight: "800",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: "4px",
                    boxShadow: "0 2px 6px rgba(79, 70, 229, 0.2)",
                    marginLeft: "4px"
                  }}
                >
                  🔄 Snap to Schedule
                </button>
              )}
            </div>
          </div>
        );
      })()}

      {/* 3. "ADD TRIP" SEARCH & ROUTE BEHAVIOR CARD OVERLAY */}
      {isAddingTrip && (
        <div style={{
          position: "absolute",
          top: "0",
          left: "0",
          width: "100%",
          height: "100%",
          background: "rgba(15, 23, 42, 0.15)",
          backdropFilter: "blur(4px)",
          zIndex: "10000", // Elevate above all sidebars and map widgets
          transform: "translate3d(0, 0, 0)", // Promote to compositing layer to clear WebKit/iOS Leaflet overlay bugs
          display: "flex",
          justifyContent: "center",
          alignItems: "center"
        }}>
          <div 
            className="glass-panel animate-fade-in" 
            style={{ 
              width: "90%", 
              maxWidth: "500px", 
              maxHeight: "90vh",
              overflowY: "auto",
              padding: "24px",
              display: "flex", 
              flexDirection: "column", 
              gap: "18px",
              boxShadow: "0 25px 50px -12px rgba(15, 23, 42, 0.25)"
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h2 style={{ fontSize: "1.1rem", fontWeight: "800", color: "var(--slate-900)" }}>Plan a New Route</h2>
              <button 
                onClick={() => setIsAddingTrip(false)}
                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--slate-400)" }}
              >
                <X size={20} />
              </button>
            </div>

            {/* A. Search inputs */}
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              
              {/* Start Input */}
              <div style={{ display: "flex", flexDirection: "column", gap: "6px", position: "relative" }}>
                <span style={{ fontSize: "0.75rem", fontWeight: "700", color: "var(--slate-500)" }}>🟢 Start Location</span>
                <div style={{ display: "flex", gap: "6px" }}>
                  <div style={{ position: "relative", flexGrow: "1" }}>
                    <input
                      type="text"
                      className="hud-input"
                      value={startQuery}
                      onChange={(e) => {
                        setStartQuery(e.target.value);
                        triggerGeocode(e.target.value, true, false); // Debounced search!
                      }}
                      onKeyDown={(e) => e.key === "Enter" && triggerGeocode(startQuery, true, true)} // Instant Enter!
                      placeholder="Type start address..."
                    />
                    <button
                      onClick={() => triggerGeocode(startQuery, true, true)}
                      style={{ position: "absolute", right: "12px", top: "12px", background: "none", border: "none", cursor: "pointer", color: "var(--primary)" }}
                    >
                      <Search size={16} />
                    </button>
                  </div>
                  <button 
                    onClick={handleUseCurrentLocation}
                    style={{
                      padding: "10px",
                      background: "rgba(79, 70, 229, 0.08)",
                      border: "1px solid rgba(79, 70, 229, 0.15)",
                      borderRadius: "10px",
                      color: "var(--primary)",
                      cursor: "pointer"
                    }}
                    title="Use current location"
                  >
                    <Navigation size={18} />
                  </button>
                </div>

                {/* Autocomplete dropdown */}
                {startResults.length > 0 && (
                  <div style={{
                    position: "absolute", top: "62px", left: "0", right: "0", background: "white", 
                    border: "1px solid var(--card-border)", borderRadius: "10px", zIndex: "999", 
                    maxHeight: "150px", overflowY: "auto", boxShadow: "0 10px 20px rgba(0,0,0,0.05)"
                  }}>
                    {startResults.map((res, i) => (
                      <div
                        key={i}
                        onClick={() => handleSelectAutocomplete(res, true)}
                        style={{ padding: "8px 12px", cursor: "pointer", fontSize: "0.8rem", borderBottom: "1px solid #f1f5f9" }}
                        onMouseEnter={(e) => e.target.style.background = "#f8fafc"}
                        onMouseLeave={(e) => e.target.style.background = "transparent"}
                      >
                        {res.label}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* End Input */}
              <div style={{ display: "flex", flexDirection: "column", gap: "6px", position: "relative" }}>
                <span style={{ fontSize: "0.75rem", fontWeight: "700", color: "var(--slate-500)" }}>🔴 Destination</span>
                <div style={{ position: "relative" }}>
                  <input
                    type="text"
                    className="hud-input"
                    value={endQuery}
                    onChange={(e) => {
                      setEndQuery(e.target.value);
                      triggerGeocode(e.target.value, false, false); // Debounced search!
                    }}
                    onKeyDown={(e) => e.key === "Enter" && triggerGeocode(endQuery, false, true)} // Instant Enter!
                    placeholder="Type destination address..."
                  />
                  <button
                    onClick={() => triggerGeocode(endQuery, false, true)}
                    style={{ position: "absolute", right: "12px", top: "12px", background: "none", border: "none", cursor: "pointer", color: "var(--rose)" }}
                  >
                    <Search size={16} />
                  </button>
                </div>

                {/* Autocomplete dropdown */}
                {endResults.length > 0 && (
                  <div style={{
                    position: "absolute", top: "62px", left: "0", right: "0", background: "white", 
                    border: "1px solid var(--card-border)", borderRadius: "10px", zIndex: "999", 
                    maxHeight: "150px", overflowY: "auto", boxShadow: "0 10px 20px rgba(0,0,0,0.05)"
                  }}>
                    {endResults.map((res, i) => (
                      <div
                        key={i}
                        onClick={() => handleSelectAutocomplete(res, false)}
                        style={{ padding: "8px 12px", cursor: "pointer", fontSize: "0.8rem", borderBottom: "1px solid #f1f5f9" }}
                        onMouseEnter={(e) => e.target.style.background = "#f8fafc"}
                        onMouseLeave={(e) => e.target.style.background = "transparent"}
                      >
                        {res.label}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <p style={{ fontSize: "0.7rem", color: "var(--slate-400)", textAlign: "center" }}>
                💡 Tip: You can also tap two points directly on the map behind this overlay to select locations!
              </p>
            </div>

            {/* B. Choose behavior context layer */}
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <span style={{ fontSize: "0.75rem", fontWeight: "700", color: "var(--slate-500)" }}>Behavior Context Layer</span>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "8px" }}>
                {["commute", "oneTime", "leisure"].map(type => (
                  <button
                    key={type}
                    onClick={() => setNewTripType(type)}
                    style={{
                      padding: "8px",
                      borderRadius: "8px",
                      border: "1px solid",
                      borderColor: newTripType === type ? "var(--primary)" : "rgba(226, 232, 240, 0.9)",
                      background: newTripType === type ? "rgba(79, 70, 229, 0.08)" : "#ffffff",
                      color: newTripType === type ? "var(--primary)" : "var(--slate-600)",
                      fontSize: "0.78rem",
                      fontWeight: "700",
                      cursor: "pointer",
                      textTransform: "capitalize"
                    }}
                  >
                    {type === "oneTime" ? "One-time" : type}
                  </button>
                ))}
              </div>
            </div>

            {/* C. Dynamic configurations according to behavior context */}
            <div className="glass-card" style={{ display: "flex", flexDirection: "column", gap: "12px", padding: "14px" }}>
              {newTripType === "commute" && (
                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    <span style={{ fontSize: "0.7rem", color: "var(--slate-500)", fontWeight: "700" }}>COMMUTE DAYS</span>
                    <div style={{ display: "flex", gap: "4px" }}>
                      {[1, 2, 3, 4, 5, 6, 0].map(day => (
                        <button
                          key={day}
                          onClick={() => setNewCommuteDays(prev => ({ ...prev, [day]: !prev[day] }))}
                          style={{
                            flex: "1",
                            padding: "6px 0",
                            borderRadius: "6px",
                            border: "1px solid",
                            borderColor: newCommuteDays[day] ? "var(--emerald)" : "rgba(226, 232, 240, 0.9)",
                            background: newCommuteDays[day] ? "rgba(16, 185, 129, 0.08)" : "#ffffff",
                            color: newCommuteDays[day] ? "var(--emerald)" : "var(--slate-600)",
                            fontSize: "0.72rem",
                            fontWeight: "700",
                            cursor: "pointer"
                          }}
                        >
                          {WEEKDAYS_SHORT[day]}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                      <span style={{ fontSize: "0.7rem", color: "var(--slate-500)", fontWeight: "700" }}>🌅 MORNING DEPARTURE</span>
                      <input 
                        type="time" 
                        value={newOutboundTime} 
                        onChange={(e) => setNewOutboundTime(e.target.value)}
                        style={{ padding: "6px 10px", borderRadius: "8px", border: "1px solid rgba(226, 232, 240, 0.9)", outline: "none", fontSize: "0.8rem" }}
                      />
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                      <span style={{ fontSize: "0.7rem", color: "var(--slate-500)", fontWeight: "700" }}>🌇 EVENING RETURN</span>
                      <input 
                        type="time" 
                        value={newReturnTime} 
                        onChange={(e) => setNewReturnTime(e.target.value)}
                        style={{ padding: "6px 10px", borderRadius: "8px", border: "1px solid rgba(226, 232, 240, 0.9)", outline: "none", fontSize: "0.8rem" }}
                      />
                    </div>
                  </div>
                </div>
              )}

              {newTripType === "oneTime" && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                    <span style={{ fontSize: "0.7rem", color: "var(--slate-500)", fontWeight: "700" }}>CALENDAR DATE</span>
                    <input 
                      type="date" 
                      value={newOneTimeDate} 
                      onChange={(e) => setNewOneTimeDate(e.target.value)}
                      style={{ padding: "6px 10px", borderRadius: "8px", border: "1px solid rgba(226, 232, 240, 0.9)", outline: "none", fontSize: "0.8rem" }}
                    />
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                    <span style={{ fontSize: "0.7rem", color: "var(--slate-500)", fontWeight: "700" }}>TARGET TIME</span>
                    <input 
                      type="time" 
                      value={newOneTimeTime} 
                      onChange={(e) => setNewOneTimeTime(e.target.value)}
                      style={{ padding: "6px 10px", borderRadius: "8px", border: "1px solid rgba(226, 232, 240, 0.9)", outline: "none", fontSize: "0.8rem" }}
                    />
                  </div>
                </div>
              )}

              {newTripType === "leisure" && (
                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  <span style={{ fontSize: "0.7rem", color: "var(--slate-500)", fontWeight: "700" }}>ROUTE NAME</span>
                  <input 
                    type="text" 
                    value={newLeisureName} 
                    onChange={(e) => setNewLeisureName(e.target.value)}
                    style={{ padding: "6px 10px", borderRadius: "8px", border: "1px solid rgba(226, 232, 240, 0.9)", outline: "none", fontSize: "0.8rem" }}
                    placeholder="e.g. Riverbank Scenic Loop"
                  />
                </div>
              )}

              {/* Rider profiles */}
              <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: "4px" }}>
                <span style={{ fontSize: "0.7rem", color: "var(--slate-500)", fontWeight: "700" }}>CYCLING PREFERENCE</span>
                <div style={{ display: "flex", gap: "4px" }}>
                  {BIKE_TYPES.map(b => (
                    <button
                      key={b.id}
                      onClick={() => {
                        setNewBikeType(b.id);
                        setNewSpeed(b.speed);
                      }}
                      style={{
                        flex: "1",
                        padding: "6px 0",
                        borderRadius: "6px",
                        border: "1px solid",
                        borderColor: newBikeType === b.id ? "var(--primary)" : "rgba(226, 232, 240, 0.9)",
                        background: newBikeType === b.id ? "rgba(79, 70, 229, 0.08)" : "#ffffff",
                        color: newBikeType === b.id ? "var(--primary)" : "var(--slate-600)",
                        fontSize: "0.68rem",
                        fontWeight: "700",
                        cursor: "pointer"
                      }}
                    >
                      {b.icon} {b.name.split(" ")[0]}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* D. Action triggers */}
            <div style={{ display: "flex", gap: "10px", marginTop: "6px" }}>
              <button
                onClick={() => setIsAddingTrip(false)}
                style={{
                  flex: "1",
                  padding: "12px",
                  border: "1px solid rgba(226, 232, 240, 0.9)",
                  background: "#ffffff",
                  color: "var(--slate-600)",
                  borderRadius: "10px",
                  fontSize: "0.85rem",
                  fontWeight: "600",
                  cursor: "pointer"
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleAddTrip}
                disabled={!draftStart || !draftEnd}
                style={{
                  flex: "2",
                  padding: "12px",
                  background: (!draftStart || !draftEnd) ? "var(--slate-300)" : "var(--primary)",
                  color: "white",
                  border: "none",
                  borderRadius: "10px",
                  fontSize: "0.85rem",
                  fontWeight: "700",
                  cursor: (!draftStart || !draftEnd) ? "not-allowed" : "pointer",
                  boxShadow: (!draftStart || !draftEnd) ? "none" : "0 8px 20px rgba(79, 70, 229, 0.3)"
                }}
              >
                Activate Route
              </button>
            </div>

          </div>
        </div>
      )}

      {/* 4. LEFT HUD CONTROL PANEL: MY ROUTES (COLLAPSIBLE DRAWER) */}
      {!isLeftCollapsed ? (
        <section style={{
          position: "absolute",
          top: isMobileView ? "176px" : "84px",
          left: isMobileView ? "10px" : "20px",
          right: isMobileView ? "10px" : "auto",
          width: isMobileView ? "auto" : "320px",
          maxHeight: isMobileView ? "calc(100vh - 330px)" : "calc(100vh - 240px)",
          overflowY: "auto",
          zIndex: "9999", // Ensure it sits cleanly above Leaflet overlay tiles
          transform: "translate3d(0, 0, 0)", // Promote to compositing layer to clear WebKit/iOS Leaflet overlay bugs
          display: "flex",
          flexDirection: "column",
          gap: "12px",
          pointerEvents: "auto"
        }} className="animate-fade-in">
          
          {/* Active rides lists */}
          <div className="glass-panel" style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ fontSize: "0.88rem", fontWeight: "800", color: "var(--slate-700)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                My Active Routes
              </h3>
              <button 
                onClick={() => setIsLeftCollapsed(true)}
                style={{ 
                  background: "rgba(15, 23, 42, 0.05)", 
                  border: "none", 
                  borderRadius: "50%",
                  cursor: "pointer", 
                  color: "var(--slate-500)",
                  width: "32px",
                  height: "32px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  transition: "all 0.15s ease"
                }}
                title="Collapse Panel"
              >
                <X size={16} />
              </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              
              {/* COMMUTES LIST */}
              <div>
                <div style={{ fontSize: "0.72rem", color: "var(--slate-400)", fontWeight: "700", marginBottom: "4px" }}>RECURRING COMMUTES</div>
                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  {Object.keys(weeklySchedule.commutes).filter(k => weeklySchedule.commutes[k].enabled).map(dayIdx => {
                    const dayConfig = weeklySchedule.commutes[dayIdx];
                    const isActive = activeRideType === "commute" && activeCommuteDay === parseInt(dayIdx);
                    return (
                      <div
                        key={dayIdx}
                        onClick={() => {
                          setActiveRideType("commute");
                          setActiveCommuteDay(parseInt(dayIdx));
                        }}
                        style={{
                          padding: "8px 10px",
                          borderRadius: "8px",
                          border: "1px solid",
                          borderColor: isActive ? "var(--primary)" : "rgba(226, 232, 240, 0.8)",
                          background: isActive ? "rgba(79, 70, 229, 0.05)" : "#ffffff",
                          cursor: "pointer",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center"
                        }}
                      >
                        <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                          <span style={{ fontSize: "0.78rem", fontWeight: "700", color: "var(--slate-800)" }}>
                            {WEEKDAYS_FULL[dayIdx]} Commute
                          </span>
                          <span style={{ fontSize: "0.65rem", color: "var(--slate-400)", textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap", width: isMobileView ? "140px" : "200px" }}>
                            {dayConfig.outbound?.start?.label.split(",")[0]} ➔ {dayConfig.outbound?.end?.label.split(",")[0]}
                          </span>
                        </div>
                        <button 
                          onClick={(e) => handleDeleteRide("commute", dayIdx, e)}
                          style={{ background: "none", border: "none", cursor: "pointer", color: "var(--rose)" }}
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* ONE-TIME RIDES */}
              {weeklySchedule.oneTimeRides.length > 0 && (
                <div>
                  <div style={{ fontSize: "0.72rem", color: "var(--slate-400)", fontWeight: "700", marginBottom: "4px" }}>ONE-TIME RIDES</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                    {weeklySchedule.oneTimeRides.map(ride => {
                      const isActive = activeRideType === "oneTime" && activeOneTimeId === ride.id;
                      return (
                        <div
                          key={ride.id}
                          onClick={() => {
                            setActiveRideType("oneTime");
                            setActiveOneTimeId(ride.id);
                          }}
                          style={{
                            padding: "8px 10px",
                            borderRadius: "8px",
                            border: "1px solid",
                            borderColor: isActive ? "var(--primary)" : "rgba(226, 232, 240, 0.8)",
                            background: isActive ? "rgba(79, 70, 229, 0.05)" : "#ffffff",
                            cursor: "pointer",
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center"
                          }}
                        >
                          <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                            <span style={{ fontSize: "0.78rem", fontWeight: "700", color: "var(--slate-800)" }}>
                              Errand / Ride ({ride.date.split("-")[1]}/{ride.date.split("-")[2]})
                            </span>
                            <span style={{ fontSize: "0.65rem", color: "var(--slate-400)", textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap", width: isMobileView ? "140px" : "200px" }}>
                              {ride.start?.label.split(",")[0]} ➔ {ride.end?.label.split(",")[0]}
                            </span>
                          </div>
                          <button 
                            onClick={(e) => handleDeleteRide("oneTime", ride.id, e)}
                            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--rose)" }}
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* LEISURE PATHS */}
              {weeklySchedule.leisureRides.length > 0 && (
                <div>
                  <div style={{ fontSize: "0.72rem", color: "var(--slate-400)", fontWeight: "700", marginBottom: "4px" }}>LEISURE PATHS</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                    {weeklySchedule.leisureRides.map(ride => {
                      const isActive = activeRideType === "leisure" && activeLeisureId === ride.id;
                      return (
                        <div
                          key={ride.id}
                          onClick={() => {
                            setActiveRideType("leisure");
                            setActiveLeisureId(ride.id);
                          }}
                          style={{
                            padding: "8px 10px",
                            borderRadius: "8px",
                            border: "1px solid",
                            borderColor: isActive ? "var(--primary)" : "rgba(226, 232, 240, 0.8)",
                            background: isActive ? "rgba(79, 70, 229, 0.05)" : "#ffffff",
                            cursor: "pointer",
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center"
                          }}
                        >
                          <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                            <span style={{ fontSize: "0.78rem", fontWeight: "700", color: "var(--slate-800)" }}>
                              {ride.name}
                            </span>
                            <span style={{ fontSize: "0.65rem", color: "var(--slate-400)", textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap", width: isMobileView ? "140px" : "200px" }}>
                              {ride.start?.label.split(",")[0]} ➔ {ride.end?.label.split(",")[0]}
                            </span>
                          </div>
                          <button 
                            onClick={(e) => handleDeleteRide("leisure", ride.id, e)}
                            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--rose)" }}
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

            </div>

            {/* Outbound vs. Return commute leg toggler if commute active */}
            {activeRideType === "commute" && (
              <div style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "4px",
                background: "#f1f5f9",
                padding: "4px",
                borderRadius: "10px",
                marginTop: "4px"
              }}>
                <button
                  onClick={() => setCommuteDirection("outbound")}
                  style={{
                    padding: "6px 0",
                    borderRadius: "8px",
                    border: "none",
                    background: commuteDirection === "outbound" ? "#ffffff" : "transparent",
                    color: commuteDirection === "outbound" ? "var(--primary)" : "var(--slate-500)",
                    fontSize: "0.75rem",
                    fontWeight: "700",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "4px",
                    boxShadow: commuteDirection === "outbound" ? "0 2px 5px rgba(0,0,0,0.05)" : "none"
                  }}
                >
                  🌅 Morning Leg
                </button>
                <button
                  onClick={() => setCommuteDirection("return")}
                  style={{
                    padding: "6px 0",
                    borderRadius: "8px",
                    border: "none",
                    background: commuteDirection === "return" ? "#ffffff" : "transparent",
                    color: commuteDirection === "return" ? "var(--primary)" : "var(--slate-500)",
                    fontSize: "0.75rem",
                    fontWeight: "700",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "4px",
                    boxShadow: commuteDirection === "return" ? "0 2px 5px rgba(0,0,0,0.05)" : "none"
                  }}
                >
                  🌇 Evening Leg
                </button>
              </div>
            )}

          </div>
        </section>
      ) : (
        // Only render the collapsed toggle button if the opposite panel isn't open on mobile, and not in planning mode
        !isAddingTrip && (!isMobileView || isRightCollapsed) && (
          <button
            onClick={() => {
              setIsLeftCollapsed(false);
              if (isMobileView) {
                setIsRightCollapsed(true); // Close right drawer to avoid overlapping on mobile
              }
            }}
            className="glass-panel"
            style={{
              position: "absolute",
              top: isMobileView ? "176px" : "84px",
              left: isMobileView ? "10px" : "20px",
              zIndex: "9999", // Ensure it sits cleanly above Leaflet overlay tiles
              transform: "translate3d(0, 0, 0)", // Promote to compositing layer to clear WebKit/iOS Leaflet overlay bugs
              width: "40px",
              height: "40px",
              borderRadius: "12px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              border: "1px solid var(--card-border)",
              color: "var(--primary)",
              padding: 0,
              pointerEvents: "auto",
              boxShadow: "0 4px 12px rgba(0,0,0,0.05)"
            }}
            title="Show Routes"
          >
            <ChevronRight size={20} />
          </button>
        )
      )}

      {/* 5. RIGHT HUD PANEL: SUITABILITY SCORE GAUGE & METRICS (COLLAPSIBLE DRAWER) */}
      {!isRightCollapsed ? (
        <section style={{
          position: "absolute",
          top: isMobileView ? "176px" : "84px",
          right: isMobileView ? "10px" : "20px",
          left: isMobileView ? "10px" : "auto",
          width: isMobileView ? "auto" : "360px",
          maxHeight: isMobileView ? "calc(100vh - 330px)" : "calc(100vh - 240px)",
          overflowY: "auto",
          zIndex: "9999", // Ensure it sits cleanly above Leaflet overlay tiles
          transform: "translate3d(0, 0, 0)", // Promote to compositing layer to clear WebKit/iOS Leaflet overlay bugs
          display: "flex",
          flexDirection: "column",
          gap: "16px",
          pointerEvents: "auto"
        }} className="animate-fade-in">
          
          <div className="glass-panel" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 16px" }}>
            <span style={{ fontSize: "0.78rem", fontWeight: "800", color: "var(--slate-700)", textTransform: "uppercase", letterSpacing: "0.04em", display: "flex", alignItems: "center", gap: "6px" }}>
              📊 Stats & Suitability
            </span>
            <button 
              onClick={() => setIsRightCollapsed(true)}
              style={{ 
                background: "rgba(15, 23, 42, 0.05)", 
                border: "none", 
                borderRadius: "50%",
                cursor: "pointer", 
                color: "var(--slate-500)",
                width: "32px",
                height: "32px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                transition: "all 0.15s ease"
              }}
              title="Collapse Panel"
            >
              <X size={16} />
            </button>
          </div>

          {isLoading ? (
            <div className="glass-panel" style={{ textAlign: "center", padding: "30px", color: "var(--slate-500)" }}>
              <Bike size={24} style={{ color: "var(--primary)", animation: "spin 2s linear infinite", margin: "0 auto 10px auto" }} />
              <span style={{ fontSize: "0.85rem", fontWeight: "600" }}>Recalculating routing segments & winds...</span>
            </div>
          ) : error ? (
            <div className="glass-panel" style={{ display: "flex", gap: "10px", background: "rgba(225, 29, 72, 0.05)", borderColor: "rgba(225, 29, 72, 0.2)", color: "var(--rose)", fontSize: "0.82rem" }}>
              <ShieldAlert size={18} style={{ flexShrink: "0" }} />
              <div>
                <strong style={{ display: "block", marginBottom: "4px" }}>Routing pipeline anomaly</strong>
                {error}
              </div>
            </div>
          ) : currentForecast ? (
            <>
              <ScoreMetric forecast={currentForecast} unitSystem={unitSystem} />
              
              <WeatherDetails
                weatherResults={weatherResults}
                hourIndex={currentHourIdx}
                startLocation={
                  activeRideType === "commute"
                    ? (commuteDirection === "outbound" ? weeklySchedule.commutes[activeCommuteDay]?.outbound?.start : weeklySchedule.commutes[activeCommuteDay]?.return?.start)
                    : (activeRideType === "oneTime" ? weeklySchedule.oneTimeRides.find(r => r.id === activeOneTimeId)?.start : weeklySchedule.leisureRides.find(r => r.id === activeLeisureId)?.start)
                }
                endLocation={
                  activeRideType === "commute"
                    ? (commuteDirection === "outbound" ? weeklySchedule.commutes[activeCommuteDay]?.outbound?.end : weeklySchedule.commutes[activeCommuteDay]?.return?.end)
                    : (activeRideType === "oneTime" ? weeklySchedule.oneTimeRides.find(r => r.id === activeOneTimeId)?.end : weeklySchedule.leisureRides.find(r => r.id === activeLeisureId)?.end)
                }
                unitSystem={unitSystem}
              />
            </>
          ) : (
            /* Ambient Local Weather Card (no active route selected) */
            <div className="glass-panel" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <h3 style={{ fontSize: "0.88rem", fontWeight: "800", color: "var(--slate-700)", textTransform: "uppercase", letterSpacing: "0.04em", display: "flex", alignItems: "center", gap: "6px" }}>
                <Sparkles size={16} style={{ color: "var(--primary)" }} /> Ambient Local Weather
              </h3>
              <p style={{ fontSize: "0.78rem", color: "var(--slate-500)", lineHeight: "1.4" }}>
                Map is centered on your current location. Adjust temporal scrubber below to see how regional winds flow.
              </p>
              {weatherResults.length > 0 && (() => {
                const rawTemp = weatherResults[0]?.hourly?.temperature_2m?.[currentHourIdx] ?? 20;
                const rawWind = weatherResults[0]?.hourly?.wind_speed_10m?.[currentHourIdx] ?? 10;
                const isImperial = unitSystem === "imperial";
                return (
                  <div className="glass-card" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", padding: "12px" }}>
                    <div>
                      <div style={{ fontSize: "0.68rem", color: "var(--slate-400)", fontWeight: "600" }}>TEMPERATURE</div>
                      <div style={{ fontSize: "1.1rem", fontWeight: "800", color: "var(--slate-800)" }}>
                        {isImperial ? `${(rawTemp * 1.8 + 32).toFixed(1)}°F` : `${rawTemp.toFixed(1)}°C`}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: "0.68rem", color: "var(--slate-400)", fontWeight: "600" }}>WIND VELOCITY</div>
                      <div style={{ fontSize: "1.1rem", fontWeight: "800", color: "var(--slate-800)", display: "flex", alignItems: "center", gap: "4px" }}>
                        💨 {isImperial ? `${(rawWind * 0.621371).toFixed(1)}` : `${rawWind.toFixed(1)}`} <span style={{ fontSize: "0.7rem", fontWeight: "normal" }}>{isImperial ? "mph" : "km/h"}</span>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
        </section>
      ) : (
        // Only render the collapsed toggle button if the opposite panel isn't open on mobile, and not in planning mode
        !isAddingTrip && (!isMobileView || isLeftCollapsed) && (
          <button
            onClick={() => {
              setIsRightCollapsed(false);
              if (isMobileView) {
                setIsLeftCollapsed(true); // Close left drawer to avoid overlapping on mobile
              }
            }}
            className="glass-panel"
            style={{
              position: "absolute",
              top: isMobileView ? "176px" : "84px",
              right: isMobileView ? "10px" : "20px",
              zIndex: "9999", // Ensure it sits cleanly above Leaflet overlay tiles
              transform: "translate3d(0, 0, 0)", // Promote to compositing layer to clear WebKit/iOS Leaflet overlay bugs
              width: "40px",
              height: "40px",
              borderRadius: "12px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              border: "1px solid var(--card-border)",
              color: "var(--primary)",
              padding: 0,
              pointerEvents: "auto",
              boxShadow: "0 4px 12px rgba(0,0,0,0.05)"
            }}
            title="Show Weather Details"
          >
            <Sparkles size={20} />
          </button>
        )
      )}

      {/* 6. BOTTOM HUD: TIME ZOOM PRISM SCRUBBER ("Now" | "Today" | "Week") */}
      <footer style={{
        position: "absolute",
        bottom: isMobileView ? "10px" : "20px",
        left: isMobileView ? "10px" : "20px",
        right: isMobileView ? "10px" : "20px",
        zIndex: "9999", // Ensure it sits cleanly above Leaflet overlay tiles
        transform: "translate3d(0, 0, 0)", // Promote to compositing layer to clear WebKit/iOS Leaflet overlay bugs
        display: "flex",
        flexDirection: "column",
        gap: "12px",
        pointerEvents: "auto"
      }} className="animate-fade-in">
        
        <div className="glass-panel" style={{
          display: "flex",
          flexDirection: "column",
          gap: isMobileView ? "10px" : "14px",
          padding: isMobileView ? "10px 14px" : "16px 20px"
        }}>
          {/* Header row: time options pills */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <Clock size={16} style={{ color: "var(--primary)" }} />
              <span style={{ fontSize: "0.8rem", fontWeight: "800", color: "var(--slate-700)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                Prism of Time
              </span>
            </div>

            {/* Mobile-only Unit Selector placed next to the timeline description */}
            {isMobileView && (
              <div style={{
                display: "flex",
                background: "#f1f5f9",
                padding: "2px",
                borderRadius: "8px",
                border: "1px solid rgba(226, 232, 240, 0.8)",
                boxShadow: "inset 0 1px 2px rgba(0,0,0,0.03)"
              }}>
                <button
                  onClick={() => setUnitSystem("metric")}
                  style={{
                    padding: "3px 8px",
                    borderRadius: "6px",
                    border: "none",
                    background: unitSystem === "metric" ? "#ffffff" : "transparent",
                    color: unitSystem === "metric" ? "var(--primary)" : "var(--slate-500)",
                    fontSize: "0.6rem",
                    fontWeight: "800",
                    cursor: "pointer",
                    transition: "all 0.15s ease"
                  }}
                >
                  Metric
                </button>
                <button
                  onClick={() => setUnitSystem("imperial")}
                  style={{
                    padding: "3px 8px",
                    borderRadius: "6px",
                    border: "none",
                    background: unitSystem === "imperial" ? "#ffffff" : "transparent",
                    color: unitSystem === "imperial" ? "var(--primary)" : "var(--slate-500)",
                    fontSize: "0.6rem",
                    fontWeight: "800",
                    cursor: "pointer",
                    transition: "all 0.15s ease"
                  }}
                >
                  Imperial
                </button>
              </div>
            )}

            {/* Toggle Pills */}
            <div style={{
              display: "flex",
              background: "#f1f5f9",
              padding: "2px",
              borderRadius: "8px"
            }}>
              {["Now", "Today", "Week"].map(zoom => (
                <button
                  key={zoom}
                  onClick={() => {
                    setTimeZoom(zoom);
                    if (zoom === "Now") {
                      setSelectedDay(0);
                      const curr = new Date().getHours();
                      setSelectedHour(curr);
                    } else if (zoom === "Today") {
                      setSelectedDay(0);
                    }
                  }}
                  style={{
                    padding: isMobileView ? "4px 8px" : "6px 14px",
                    borderRadius: "6px",
                    border: "none",
                    background: timeZoom === zoom ? "#ffffff" : "transparent",
                    color: timeZoom === zoom ? "var(--primary)" : "var(--slate-500)",
                    fontSize: isMobileView ? "0.7rem" : "0.78rem",
                    fontWeight: "800",
                    cursor: "pointer",
                    boxShadow: timeZoom === zoom ? "0 2px 5px rgba(0,0,0,0.05)" : "none",
                    transition: "all 0.15s ease"
                  }}
                >
                  {zoom}
                </button>
              ))}
            </div>
          </div>

          {/* Temporal Scrubber Dial displays */}
          {timeZoom === "Now" && (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.78rem", color: "var(--slate-500)" }}>
              <span>🕒 Ambient environment representing real-time conditions.</span>
              <span style={{ color: "var(--primary)", fontWeight: "700" }}>Live Flow HUD</span>
            </div>
          )}

          {timeZoom === "Today" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {/* Dial slider */}
              <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
                <span style={{ fontSize: "0.8rem", fontWeight: "800", color: "var(--slate-700)", width: "70px" }}>
                  {selectedHour === 0 ? "12 AM" : selectedHour === 12 ? "12 PM" : selectedHour > 12 ? `${selectedHour - 12} PM` : `${selectedHour} AM`}
                </span>
                <input
                  type="range"
                  min="0"
                  max="23"
                  value={selectedHour}
                  onChange={(e) => setSelectedHour(parseInt(e.target.value))}
                  style={{
                    flexGrow: "1",
                    height: "6px",
                    borderRadius: "3px",
                    outline: "none",
                    cursor: "pointer",
                    accentColor: "var(--primary)"
                  }}
                />
                <span style={{ fontSize: "0.72rem", color: "var(--slate-400)" }}>24h scrub</span>
              </div>
              <p style={{ fontSize: "0.7rem", color: "var(--slate-400)" }}>
                💡 Slide to scrub through hourly forecasts. The map's ambient wind directions and rain streams will morph instantly.
              </p>
            </div>
          )}

          {hasMounted && timeZoom === "Week" && (
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(7, 1fr)",
              gap: isMobileView ? "4px" : "8px"
            }}>
              {Array.from({ length: 7 }).map((_, idx) => {
                const date = new Date();
                date.setDate(date.getDate() + idx);
                const dayName = WEEKDAYS_SHORT[date.getDay()];
                const dateStr = date.toLocaleDateString([], { month: "short", day: "numeric" });
                const isActive = selectedDay === idx;
                
                return (
                  <div
                    key={idx}
                    onClick={() => {
                      setSelectedDay(idx);
                    }}
                    style={{
                      background: isActive ? "rgba(79, 70, 229, 0.05)" : "#ffffff",
                      border: "1px solid",
                      borderColor: isActive ? "var(--primary)" : "rgba(226, 232, 240, 0.9)",
                      borderRadius: "10px",
                      padding: isMobileView ? "4px 2px" : "8px 4px",
                      textAlign: "center",
                      cursor: "pointer",
                      display: "flex",
                      flexDirection: "column",
                      gap: "4px",
                      transition: "all 0.18s ease"
                    }}
                  >
                    <span style={{ fontSize: isMobileView ? "0.62rem" : "0.75rem", fontWeight: "800", color: isActive ? "var(--primary)" : "var(--slate-600)" }}>
                      {idx === 0 ? "Today" : dayName}
                    </span>
                    <span style={{ fontSize: isMobileView ? "0.5rem" : "0.62rem", color: "var(--slate-400)" }}>
                      {dateStr}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

        </div>
      </footer>
      </>
      )}

    </div>
  );
}

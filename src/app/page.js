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

const getWindCompassDirection = (degrees) => {
  if (degrees === undefined || degrees === null) return "N";
  const normalizedDegrees = ((degrees % 360) + 360) % 360;
  const directions = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  const index = Math.round(normalizedDegrees / 22.5) % 16;
  return directions[index];
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
            right: isMobileView ? "10px" : "20px",
            width: isMobileView ? "calc(100% - 20px)" : "calc(100% - 40px)",
            zIndex: "9999", // Elevate to sit reliably on top of all Leaflet internal pane stacks
            transform: "translate3d(0, 0, 0)", // Promote to compositing layer to clear WebKit/iOS Leaflet overlay bugs
            display: "flex",
            alignItems: "center",
            pointerEvents: "auto"
          }}>
            <div className="glass-panel" style={{
              width: "100%",
              padding: isMobileView ? "8px 12px" : "10px 20px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              borderRadius: "20px",
              boxShadow: "0 10px 30px rgba(15, 23, 42, 0.04)"
            }}>
              {/* Left Side: Brand Logo & Title */}
              <div style={{ display: "flex", alignItems: "center", gap: isMobileView ? "8px" : "10px", minWidth: 0, flexShrink: 1 }}>
                <div style={{
                  background: "linear-gradient(135deg, var(--primary), var(--primary-hover))",
                  width: "36px",
                  height: "36px",
                  borderRadius: "10px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  boxShadow: "0 4px 10px rgba(79, 70, 229, 0.25)",
                  flexShrink: 0
                }}>
                  <Bike size={18} style={{ color: "white" }} />
                </div>
                <h1 style={{ 
                  fontSize: isMobileView ? "0.95rem" : "1.05rem", 
                  fontWeight: "800", 
                  letterSpacing: "-0.02em", 
                  color: "var(--slate-900)",
                  whiteSpace: "nowrap",
                  textOverflow: "ellipsis",
                  overflow: "hidden"
                }}>
                  Biking Forecast
                </h1>
              </div>

              {/* Center Side: Segmented zoom selector (only visible on desktop to keep it clean) */}
              {!isMobileView && (
                <div className="segmented-pill-container">
                  <button
                    onClick={() => setTimeZoom("Now")}
                    className={`segmented-pill-btn ${timeZoom === "Now" ? "active" : ""}`}
                  >
                    Now
                  </button>
                  <button
                    onClick={() => setTimeZoom("Today")}
                    className={`segmented-pill-btn ${timeZoom === "Today" ? "active" : ""}`}
                  >
                    Today
                  </button>
                  <button
                    onClick={() => setTimeZoom("Week")}
                    className={`segmented-pill-btn ${timeZoom === "Week" ? "active" : ""}`}
                  >
                    Week
                  </button>
                </div>
              )}

              {/* Right Side: Quick Action Icons & Add Trip Button */}
              <div style={{ display: "flex", alignItems: "center", gap: isMobileView ? "6px" : "12px", flexShrink: 0 }}>
                {!isMobileView && (
                  <>
                    <button style={{ background: "none", border: "none", color: "var(--slate-500)", cursor: "pointer", display: "flex", alignItems: "center", padding: "6px" }} title="Search Location">
                      <Search size={18} />
                    </button>
                    <button onClick={handleUseCurrentLocation} style={{ background: "none", border: "none", color: "var(--slate-500)", cursor: "pointer", display: "flex", alignItems: "center", padding: "6px" }} title="Use Current Location">
                      <Navigation size={18} />
                    </button>
                    <button style={{ background: "none", border: "none", color: "var(--slate-500)", cursor: "pointer", display: "flex", alignItems: "center", padding: "6px" }} title="My Account">
                      <HelpCircle size={18} />
                    </button>

                    {/* Desktop Segmented Unit Selector */}
                    <div className="header-unit-toggle" style={{
                      display: "flex",
                      background: "#f1f5f9",
                      padding: "2px",
                      borderRadius: "8px",
                      border: "1px solid rgba(226, 232, 240, 0.8)",
                      boxShadow: "inset 0 1px 2px rgba(0,0,0,0.03)",
                      marginLeft: "4px",
                      marginRight: "4px"
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

                    <div style={{ width: "1px", height: "20px", background: "var(--slate-200)" }} />
                  </>
                )}

                <button 
                  onClick={() => {
                    setIsAddingTrip(true);
                    setIsLeftCollapsed(true);
                    setIsRightCollapsed(true);
                  }}
                  style={{
                    padding: isMobileView ? "6px 12px" : "8px 18px",
                    background: "linear-gradient(135deg, var(--primary), var(--primary-hover))",
                    color: "white",
                    border: "none",
                    borderRadius: "12px",
                    fontSize: isMobileView ? "0.72rem" : "0.78rem",
                    fontWeight: "700",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    boxShadow: "0 4px 12px rgba(79, 70, 229, 0.25)",
                    flexShrink: 0
                  }}
                >
                  <Plus size={14} /> 
                  <span>Add Trip</span>
                </button>
              </div>
            </div>
          </header>

      {/* --- TEMPORAL STATUS HUD BANNER (SCRUBBER LENS) --- */}
      {hasMounted && (() => {
        if (isAddingTrip) return null; // Hide status banner during active trip planning overlay
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
             {/* 3. ADD TRIP PLANNING WORKSPACE (MOCKUP-THEMED) */}
      {isAddingTrip && (
        <>
          {isMobileView ? (
            /* MOBILE TRIP PLANNING DRAWER (SINGLE COLUMN SHEET) */
            <div style={{
              position: "absolute",
              top: "0",
              left: "0",
              width: "100%",
              height: "100%",
              background: "rgba(15, 23, 42, 0.15)",
              backdropFilter: "blur(4px)",
              zIndex: "10000",
              transform: "translate3d(0, 0, 0)",
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              pointerEvents: "auto"
            }}>
              <div 
                className="glass-panel animate-fade-in" 
                style={{ 
                  width: "calc(100% - 20px)", 
                  maxHeight: "90vh",
                  overflowY: "auto",
                  padding: "20px",
                  display: "flex", 
                  flexDirection: "column", 
                  gap: "16px",
                  boxShadow: "0 25px 50px rgba(15, 23, 42, 0.2)"
                }}
              >
                {/* Header */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <h2 style={{ fontSize: "1.05rem", fontWeight: "800", color: "var(--slate-900)" }}>Plan a New Route</h2>
                  <button 
                    onClick={() => setIsAddingTrip(false)}
                    style={{ background: "none", border: "none", cursor: "pointer", color: "var(--slate-400)", padding: "4px" }}
                  >
                    <X size={20} />
                  </button>
                </div>

                {/* Start Location Input */}
                <div style={{ display: "flex", flexDirection: "column", gap: "4px", position: "relative" }}>
                  <span style={{ fontSize: "0.72rem", fontWeight: "700", color: "var(--slate-500)" }}>🟢 Start Location</span>
                  <div style={{ display: "flex", gap: "6px" }}>
                    <div style={{ position: "relative", flexGrow: "1" }}>
                      <input
                        type="text"
                        className="hud-input"
                        value={startQuery}
                        onChange={(e) => {
                          setStartQuery(e.target.value);
                          triggerGeocode(e.target.value, true, false);
                        }}
                        placeholder="Type start address..."
                      />
                    </div>
                    <button 
                      onClick={handleUseCurrentLocation}
                      style={{
                        padding: "8px 10px",
                        background: "rgba(79, 70, 229, 0.08)",
                        border: "1px solid rgba(79, 70, 229, 0.15)",
                        borderRadius: "10px",
                        color: "var(--primary)",
                        cursor: "pointer"
                      }}
                    >
                      <Navigation size={16} />
                    </button>
                  </div>
                  {startResults.length > 0 && (
                    <div style={{
                      position: "absolute", top: "58px", left: "0", right: "0", background: "white", 
                      border: "1px solid var(--card-border)", borderRadius: "10px", zIndex: "999", 
                      maxHeight: "130px", overflowY: "auto", boxShadow: "0 10px 20px rgba(0,0,0,0.05)"
                    }}>
                      {startResults.map((res, i) => (
                        <div
                          key={i}
                          onClick={() => handleSelectAutocomplete(res, true)}
                          style={{ padding: "8px 12px", cursor: "pointer", fontSize: "0.75rem", borderBottom: "1px solid #f1f5f9" }}
                        >
                          {res.display_name}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Destination Input */}
                <div style={{ display: "flex", flexDirection: "column", gap: "4px", position: "relative" }}>
                  <span style={{ fontSize: "0.72rem", fontWeight: "700", color: "var(--slate-500)" }}>🔴 Destination</span>
                  <input
                    type="text"
                    className="hud-input"
                    value={endQuery}
                    onChange={(e) => {
                      setEndQuery(e.target.value);
                      triggerGeocode(e.target.value, false, false);
                    }}
                    placeholder="Type destination address..."
                  />
                  {endResults.length > 0 && (
                    <div style={{
                      position: "absolute", top: "58px", left: "0", right: "0", background: "white", 
                      border: "1px solid var(--card-border)", borderRadius: "10px", zIndex: "999", 
                      maxHeight: "130px", overflowY: "auto", boxShadow: "0 10px 20px rgba(0,0,0,0.05)"
                    }}>
                      {endResults.map((res, i) => (
                        <div
                          key={i}
                          onClick={() => handleSelectAutocomplete(res, false)}
                          style={{ padding: "8px 12px", cursor: "pointer", fontSize: "0.75rem", borderBottom: "1px solid #f1f5f9" }}
                        >
                          {res.display_name}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Context Selector */}
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <span style={{ fontSize: "0.72rem", fontWeight: "700", color: "var(--slate-500)" }}>Route Context</span>
                  <div style={{ display: "flex", gap: "6px" }}>
                    {["commute", "oneTime", "leisure"].map(type => (
                      <button
                        key={type}
                        onClick={() => setNewTripType(type)}
                        style={{
                          flex: "1",
                          padding: "8px 0",
                          borderRadius: "8px",
                          border: "1px solid",
                          borderColor: newTripType === type ? "var(--primary)" : "rgba(226, 232, 240, 0.9)",
                          background: newTripType === type ? "rgba(79, 70, 229, 0.08)" : "#ffffff",
                          color: newTripType === type ? "var(--primary)" : "var(--slate-600)",
                          fontSize: "0.7rem",
                          fontWeight: "700",
                          cursor: "pointer"
                        }}
                      >
                        {type === "commute" ? "💼 Commute" : type === "oneTime" ? "📅 One-Time" : "🌲 Leisure"}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Commute parameters */}
                {newTripType === "commute" && (
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px", background: "rgba(15, 23, 42, 0.02)", padding: "10px", borderRadius: "12px", border: "1px solid rgba(15,23,42,0.03)" }}>
                    <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
                      {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((dayName, idx) => {
                        const dayVal = idx === 6 ? 0 : idx + 1; // 0 Sunday, 1 Monday...
                        const isSelected = newCommuteDays[dayVal] ?? false;
                        return (
                          <button
                            key={dayName}
                            onClick={() => {
                              setNewCommuteDays({
                                ...newCommuteDays,
                                [dayVal]: !isSelected
                              });
                            }}
                            style={{
                              padding: "4px 8px",
                              borderRadius: "6px",
                              border: "1px solid",
                              borderColor: isSelected ? "var(--emerald)" : "rgba(226, 232, 240, 0.9)",
                              background: isSelected ? "rgba(16, 185, 129, 0.08)" : "#ffffff",
                              color: isSelected ? "var(--emerald)" : "var(--slate-600)",
                              fontSize: "0.65rem",
                              fontWeight: "700",
                              cursor: "pointer"
                            }}
                          >
                            {dayName}
                          </button>
                        );
                      })}
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                      <div>
                        <span style={{ fontSize: "0.6rem", fontWeight: "700", color: "var(--slate-400)", textTransform: "uppercase" }}>🌅 Morning Outbound</span>
                        <input
                          type="time"
                          value={newOutboundTime}
                          onChange={(e) => setNewOutboundTime(e.target.value)}
                          style={{ width: "100%", padding: "6px", borderRadius: "6px", border: "1px solid rgba(226,232,240,0.9)", fontSize: "0.75rem", outline: "none", marginTop: "4px" }}
                        />
                      </div>
                      <div>
                        <span style={{ fontSize: "0.6rem", fontWeight: "700", color: "var(--slate-400)", textTransform: "uppercase" }}>🌇 Evening Return</span>
                        <input
                          type="time"
                          value={newReturnTime}
                          onChange={(e) => setNewReturnTime(e.target.value)}
                          style={{ width: "100%", padding: "6px", borderRadius: "6px", border: "1px solid rgba(226,232,240,0.9)", fontSize: "0.75rem", outline: "none", marginTop: "4px" }}
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* Bike Preference */}
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <span style={{ fontSize: "0.72rem", fontWeight: "700", color: "var(--slate-500)" }}>Cycling Preference</span>
                  <div style={{ display: "flex", gap: "4px" }}>
                    {[
                      { id: "Road", name: "Road Bike", icon: "🚲" },
                      { id: "Hybrid", name: "Hybrid Bike", icon: "🚴" },
                      { id: "Mountain", name: "Mountain", icon: "🏔️" },
                      { id: "Electric", name: "Electric", icon: "⚡" }
                    ].map(b => (
                      <button
                        key={b.id}
                        onClick={() => setNewBikeType(b.id)}
                        style={{
                          flex: "1",
                          padding: "6px 0",
                          borderRadius: "8px",
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

                {/* Action buttons */}
                <div style={{ display: "flex", gap: "10px", marginTop: "6px" }}>
                  <button
                    onClick={() => setIsAddingTrip(false)}
                    style={{
                      flex: "1",
                      padding: "10px",
                      border: "1px solid rgba(226, 232, 240, 0.9)",
                      background: "#ffffff",
                      color: "var(--slate-600)",
                      borderRadius: "12px",
                      fontSize: "0.8rem",
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
                      padding: "10px",
                      background: (!draftStart || !draftEnd) ? "var(--slate-300)" : "var(--primary)",
                      color: "white",
                      border: "none",
                      borderRadius: "10px",
                      fontSize: "0.8rem",
                      fontWeight: "700",
                      cursor: (!draftStart || !draftEnd) ? "not-allowed" : "pointer",
                      boxShadow: (!draftStart || !draftEnd) ? "none" : "0 8px 20px rgba(79, 70, 229, 0.2)"
                    }}
                  >
                    Activate Route
                  </button>
                </div>
              </div>
            </div>
          ) : (
            /* DESKTOP HIGH-FIDELITY WORKSPACE (FLOATING MOCKUP PANEL HUDS) */
            <>
              {/* --- COLUMN 1: LEFT SIDEBAR (STEP PROGRESS & ROUTE PREVIEW) --- */}
              <div style={{
                position: "absolute",
                top: "84px",
                left: "20px",
                width: "320px",
                maxHeight: "calc(100vh - 240px)",
                overflowY: "auto",
                zIndex: "10000",
                display: "flex",
                flexDirection: "column",
                gap: "16px",
                pointerEvents: "auto",
                transform: "translate3d(0, 0, 0)" // WebKit GPU promote
              }} className="animate-fade-in">
                
                {/* 3-Step Checklist Tracker */}
                <div className="glass-panel" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  <h3 style={{ fontSize: "0.82rem", fontWeight: "800", color: "var(--slate-800)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                    Trip Builder
                  </h3>
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    
                    {/* Step 1 */}
                    <div className={`planning-step-item ${(!draftStart || !draftEnd) ? "active" : ""}`} style={{ border: (draftStart && draftEnd) ? "1px solid rgba(16, 185, 129, 0.15)" : "none" }}>
                      <div className="planning-step-badge" style={{ background: (draftStart && draftEnd) ? "var(--emerald)" : "var(--primary)", color: "white" }}>
                        {draftStart && draftEnd ? "✓" : "1"}
                      </div>
                      <div style={{ display: "flex", flexDirection: "column" }}>
                        <span style={{ fontSize: "0.75rem", fontWeight: "700", color: "var(--slate-800)" }}>Choose Route</span>
                        <span style={{ fontSize: "0.62rem", color: "var(--slate-500)" }}>Select start & end on map</span>
                      </div>
                    </div>

                    {/* Step 2 */}
                    <div className={`planning-step-item ${(draftStart && draftEnd) ? "active" : ""}`} style={{ opacity: (draftStart && draftEnd) ? "1" : "0.5" }}>
                      <div className="planning-step-badge">2</div>
                      <div style={{ display: "flex", flexDirection: "column" }}>
                        <span style={{ fontSize: "0.75rem", fontWeight: "700", color: "var(--slate-800)" }}>Set Context</span>
                        <span style={{ fontSize: "0.62rem", color: "var(--slate-500)" }}>Define purpose & schedule</span>
                      </div>
                    </div>

                    {/* Step 3 */}
                    <div className="planning-step-item" style={{ opacity: "0.5" }}>
                      <div className="planning-step-badge">3</div>
                      <div style={{ display: "flex", flexDirection: "column" }}>
                        <span style={{ fontSize: "0.75rem", fontWeight: "700", color: "var(--slate-800)" }}>Review & Save</span>
                        <span style={{ fontSize: "0.62rem", color: "var(--slate-500)" }}>Activate your trip timeline</span>
                      </div>
                    </div>

                  </div>
                </div>

                {/* Route Preview Table */}
                <div className="glass-panel" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  <h3 style={{ fontSize: "0.82rem", fontWeight: "800", color: "var(--slate-800)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                    Route Preview
                  </h3>
                  {draftStart && draftEnd ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                        <div className="glass-card" style={{ padding: "8px" }}>
                          <span style={{ fontSize: "0.58rem", color: "var(--slate-400)", fontWeight: "700" }}>DISTANCE</span>
                          <div style={{ fontSize: "0.88rem", fontWeight: "800", color: "var(--slate-800)" }}>
                            8.5 mi
                          </div>
                        </div>
                        <div className="glass-card" style={{ padding: "8px" }}>
                          <span style={{ fontSize: "0.58rem", color: "var(--slate-400)", fontWeight: "700" }}>DURATION</span>
                          <div style={{ fontSize: "0.88rem", fontWeight: "800", color: "var(--slate-800)" }}>
                            42 mins
                          </div>
                        </div>
                      </div>
                      
                      {/* Detailed suitabilities */}
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.72rem", color: "var(--slate-700)" }}>
                        <tbody>
                          <tr style={{ borderBottom: "1px solid #f1f5f9" }}>
                            <td style={{ padding: "6px 0", color: "var(--slate-500)" }}>Tailwind Benefit</td>
                            <td style={{ padding: "6px 0", textAlign: "right", fontWeight: "700", color: "var(--emerald)" }}>+12% assist</td>
                          </tr>
                          <tr style={{ borderBottom: "1px solid #f1f5f9" }}>
                            <td style={{ padding: "6px 0", color: "var(--slate-500)" }}>Crosswind Drag</td>
                            <td style={{ padding: "6px 0", textAlign: "right", fontWeight: "700", color: "var(--amber)" }}>Moderate (8mph)</td>
                          </tr>
                          <tr style={{ borderBottom: "1px solid #f1f5f9" }}>
                            <td style={{ padding: "6px 0", color: "var(--slate-500)" }}>Road Quality</td>
                            <td style={{ padding: "6px 0", textAlign: "right", fontWeight: "700", color: "var(--emerald)" }}>95% Asphalt</td>
                          </tr>
                          <tr>
                            <td style={{ padding: "6px 0", color: "var(--slate-500)" }}>Traffic Exposure</td>
                            <td style={{ padding: "6px 0", textAlign: "right", fontWeight: "700", color: "var(--primary)" }}>Low Exposure</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div style={{ fontSize: "0.7rem", color: "var(--slate-400)", lineHeight: "1.4", textAlign: "center", padding: "10px 0" }}>
                      📍 Search locations or tap the map to build your custom bike route.
                    </div>
                  )}
                </div>

              </div>

              {/* --- COLUMN 2: CENTER MAP OVERLAYS (SEARCH & ELEVATION SPLINE) --- */}
              
              {/* Floating Center Search Bar */}
              <div style={{
                position: "absolute",
                top: "84px",
                left: "50%",
                transform: "translate3d(-50%, 0, 0)",
                zIndex: "10000",
                width: "600px",
                pointerEvents: "auto"
              }} className="animate-fade-in">
                <div className="glass-panel" style={{
                  padding: "10px 16px",
                  display: "flex",
                  alignItems: "center",
                  gap: "12px",
                  boxShadow: "0 10px 25px rgba(0,0,0,0.05)"
                }}>
                  {/* Start Location Input */}
                  <div style={{ position: "relative", flexGrow: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <span style={{ fontSize: "0.68rem", fontWeight: "800", color: "var(--slate-400)" }}>START</span>
                      <input
                        type="text"
                        className="hud-input"
                        value={startQuery}
                        onChange={(e) => {
                          setStartQuery(e.target.value);
                          triggerGeocode(e.target.value, true, false);
                        }}
                        placeholder="Choose starting location..."
                        style={{ padding: "8px 10px" }}
                      />
                      <button 
                        onClick={handleUseCurrentLocation}
                        style={{
                          background: "none",
                          border: "none",
                          color: "var(--primary)",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center"
                        }}
                        title="Use current location"
                      >
                        <Navigation size={16} />
                      </button>
                    </div>
                    {startResults.length > 0 && (
                      <div style={{
                        position: "absolute", top: "45px", left: "45px", right: "0", background: "white", 
                        border: "1px solid var(--card-border)", borderRadius: "10px", zIndex: "999", 
                        maxHeight: "150px", overflowY: "auto", boxShadow: "0 10px 20px rgba(0,0,0,0.05)"
                      }}>
                        {startResults.map((res, i) => (
                          <div
                            key={i}
                            onClick={() => handleSelectAutocomplete(res, true)}
                            style={{ padding: "8px 12px", cursor: "pointer", fontSize: "0.75rem", borderBottom: "1px solid #f1f5f9" }}
                          >
                            {res.display_name}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Swap Icon */}
                  <div style={{ color: "var(--slate-400)", display: "flex", alignItems: "center", cursor: "pointer" }} title="Swap locations">
                    <ArrowLeftRight size={16} onClick={() => {
                      const tempQ = startQuery;
                      const tempD = draftStart;
                      setStartQuery(endQuery);
                      setDraftStart(draftEnd);
                      setEndQuery(tempQ);
                      setDraftEnd(tempD);
                    }} />
                  </div>

                  {/* Destination Location Input */}
                  <div style={{ position: "relative", flexGrow: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <span style={{ fontSize: "0.68rem", fontWeight: "800", color: "var(--slate-400)" }}>END</span>
                      <input
                        type="text"
                        className="hud-input"
                        value={endQuery}
                        onChange={(e) => {
                          setEndQuery(e.target.value);
                          triggerGeocode(e.target.value, false, false);
                        }}
                        placeholder="Choose destination..."
                        style={{ padding: "8px 10px" }}
                      />
                    </div>
                    {endResults.length > 0 && (
                      <div style={{
                        position: "absolute", top: "45px", left: "32px", right: "0", background: "white", 
                        border: "1px solid var(--card-border)", borderRadius: "10px", zIndex: "999", 
                        maxHeight: "150px", overflowY: "auto", boxShadow: "0 10px 20px rgba(0,0,0,0.05)"
                      }}>
                        {endResults.map((res, i) => (
                          <div
                            key={i}
                            onClick={() => handleSelectAutocomplete(res, false)}
                            style={{ padding: "8px 12px", cursor: "pointer", fontSize: "0.75rem", borderBottom: "1px solid #f1f5f9" }}
                          >
                            {res.display_name}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Search Button */}
                  <button 
                    onClick={() => {
                      if (startQuery) triggerGeocode(startQuery, true, true);
                      if (endQuery) triggerGeocode(endQuery, false, true);
                    }}
                    style={{
                      background: "var(--primary)",
                      color: "white",
                      border: "none",
                      borderRadius: "10px",
                      width: "36px",
                      height: "36px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      cursor: "pointer"
                    }}
                  >
                    <Search size={16} />
                  </button>

                </div>
              </div>

              {/* Elevation Profile Spline Chart (absolute center bottom) */}
              {draftStart && draftEnd && (
                <div style={{
                  position: "absolute",
                  bottom: "116px",
                  left: "50%",
                  transform: "translate3d(-50%, 0, 0)",
                  zIndex: "10000",
                  width: "600px",
                  pointerEvents: "auto"
                }} className="animate-fade-in">
                  <div className="glass-panel" style={{ padding: "10px 16px", display: "flex", flexDirection: "column", gap: "6px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: "0.7rem", color: "var(--slate-800)", fontWeight: "800" }}>
                        📈 Elevation Profile
                      </span>
                      <span style={{ fontSize: "0.68rem", color: "var(--slate-500)", fontWeight: "500" }}>
                        ↑ 120 ft  ↓ 110 ft • Mostly flat
                      </span>
                    </div>
                    {/* SVG Spline Area Chart */}
                    <div style={{ width: "100%", height: "48px", position: "relative", marginTop: "4px" }}>
                      <svg width="100%" height="100%" viewBox="0 0 500 50" preserveAspectRatio="none" style={{ display: "block" }}>
                        <defs>
                          <linearGradient id="elevationGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.32" />
                            <stop offset="100%" stopColor="var(--primary)" stopOpacity="0.0" />
                          </linearGradient>
                        </defs>
                        {/* Area Spline */}
                        <path 
                          d="M 0,40 Q 60,10 120,35 T 240,25 T 360,42 T 500,28 L 500,50 L 0,50 Z" 
                          fill="url(#elevationGrad)" 
                        />
                        {/* Line Spline */}
                        <path 
                          d="M 0,40 Q 60,10 120,35 T 240,25 T 360,42 T 500,28" 
                          fill="none" 
                          stroke="var(--primary)" 
                          strokeWidth="2.5" 
                        />
                        {/* Grid line guide */}
                        <line x1="0" y1="42" x2="500" y2="42" stroke="rgba(15, 23, 42, 0.05)" strokeDasharray="4,4" />
                      </svg>
                      {/* Grid labels */}
                      <span style={{ position: "absolute", top: "2px", left: "2px", fontSize: "0.55rem", color: "var(--slate-400)", fontWeight: "700" }}>120 ft</span>
                      <span style={{ position: "absolute", bottom: "2px", left: "2px", fontSize: "0.55rem", color: "var(--slate-400)", fontWeight: "700" }}>0 ft</span>
                    </div>
                  </div>
                </div>
              )}

              {/* --- COLUMN 3: RIGHT SIDEBAR (ROUTE CONTEXT & DETAILS) --- */}
              <div style={{
                position: "absolute",
                top: "84px",
                right: "20px",
                width: "340px",
                maxHeight: "calc(100vh - 240px)",
                overflowY: "auto",
                zIndex: "10000",
                display: "flex",
                flexDirection: "column",
                gap: "14px",
                pointerEvents: "auto",
                transform: "translate3d(0, 0, 0)" // WebKit GPU promote
              }} className="animate-fade-in">
                
                {/* Context Selector List */}
                <div className="glass-panel" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  <h3 style={{ fontSize: "0.82rem", fontWeight: "800", color: "var(--slate-800)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                    How will you use this route?
                  </h3>
                  
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    
                    {/* Leisure Option */}
                    <div 
                      onClick={() => setNewTripType("leisure")}
                      className={`context-selection-card ${newTripType === "leisure" ? "active" : ""}`}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        <span style={{ fontSize: "1.1rem" }}>🌲</span>
                        <div style={{ display: "flex", flexDirection: "column" }}>
                          <span style={{ fontSize: "0.78rem", fontWeight: "700", color: "var(--slate-800)" }}>Leisure / Fitness</span>
                          <span style={{ fontSize: "0.62rem", color: "var(--slate-400)" }}>Free riding, exploring, or training</span>
                        </div>
                      </div>
                      {newTripType === "leisure" && (
                        <div style={{ marginTop: "10px", display: "flex", flexDirection: "column", gap: "4px" }} onClick={e => e.stopPropagation()}>
                          <span style={{ fontSize: "0.62rem", color: "var(--slate-500)", fontWeight: "700" }}>ROUTE NAME</span>
                          <input 
                            type="text" 
                            value={newLeisureName} 
                            onChange={(e) => setNewLeisureName(e.target.value)}
                            style={{ width: "100%", padding: "6px 8px", borderRadius: "8px", border: "1px solid rgba(226, 232, 240, 0.9)", outline: "none", fontSize: "0.75rem" }}
                            placeholder="e.g. Riverbank Scenic Loop"
                          />
                        </div>
                      )}
                    </div>

                    {/* One-Time Ride Option */}
                    <div 
                      onClick={() => setNewTripType("oneTime")}
                      className={`context-selection-card ${newTripType === "oneTime" ? "active" : ""}`}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        <span style={{ fontSize: "1.1rem" }}>📅</span>
                        <div style={{ display: "flex", flexDirection: "column" }}>
                          <span style={{ fontSize: "0.78rem", fontWeight: "700", color: "var(--slate-800)" }}>One-Time Event</span>
                          <span style={{ fontSize: "0.62rem", color: "var(--slate-400)" }}>Single specific date and target time</span>
                        </div>
                      </div>
                      {newTripType === "oneTime" && (
                        <div style={{ marginTop: "10px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }} onClick={e => e.stopPropagation()}>
                          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                            <span style={{ fontSize: "0.62rem", color: "var(--slate-500)", fontWeight: "700" }}>DATE</span>
                            <input 
                              type="date" 
                              value={newOneTimeDate} 
                              onChange={(e) => setNewOneTimeDate(e.target.value)}
                              style={{ padding: "6px 8px", borderRadius: "8px", border: "1px solid rgba(226, 232, 240, 0.9)", outline: "none", fontSize: "0.72rem" }}
                            />
                          </div>
                          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                            <span style={{ fontSize: "0.62rem", color: "var(--slate-500)", fontWeight: "700" }}>TIME</span>
                            <input 
                              type="time" 
                              value={newOneTimeTime} 
                              onChange={(e) => setNewOneTimeTime(e.target.value)}
                              style={{ padding: "6px 8px", borderRadius: "8px", border: "1px solid rgba(226, 232, 240, 0.9)", outline: "none", fontSize: "0.72rem" }}
                            />
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Commute Option */}
                    <div 
                      onClick={() => setNewTripType("commute")}
                      className={`context-selection-card ${newTripType === "commute" ? "active" : ""}`}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        <span style={{ fontSize: "1.1rem" }}>💼</span>
                        <div style={{ display: "flex", flexDirection: "column" }}>
                          <span style={{ fontSize: "0.78rem", fontWeight: "700", color: "var(--slate-800)" }}>Commute Schedule</span>
                          <span style={{ fontSize: "0.62rem", color: "var(--slate-400)" }}>Recurring weekly outbound/return leg</span>
                        </div>
                      </div>
                      {newTripType === "commute" && (
                        <div style={{ marginTop: "10px", display: "flex", flexDirection: "column", gap: "8px" }} onClick={e => e.stopPropagation()}>
                          <span style={{ fontSize: "0.62rem", color: "var(--slate-500)", fontWeight: "700" }}>COMMUTE DAYS</span>
                          <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
                            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((dayName, idx) => {
                              const dayVal = idx === 6 ? 0 : idx + 1; // 0 Sunday, 1 Monday...
                              const isDaySelected = weeklySchedule.commutes[dayVal]?.enabled ?? false;
                              return (
                                <button
                                  key={dayName}
                                  onClick={() => {
                                    const updated = { ...weeklySchedule };
                                    if (!updated.commutes[dayVal]) {
                                      updated.commutes[dayVal] = { enabled: false, bikeType: "Hybrid", customSpeed: 18, outbound: null, return: null };
                                    }
                                    updated.commutes[dayVal].enabled = !updated.commutes[dayVal].enabled;
                                    saveWeeklySchedule(updated);
                                  }}
                                  style={{
                                    padding: "4px 8px",
                                    borderRadius: "6px",
                                    border: "1px solid",
                                    borderColor: isDaySelected ? "var(--primary)" : "rgba(226, 232, 240, 0.9)",
                                    background: isDaySelected ? "rgba(79, 70, 229, 0.08)" : "#ffffff",
                                    color: isDaySelected ? "var(--primary)" : "var(--slate-500)",
                                    fontSize: "0.62rem",
                                    fontWeight: "700",
                                    cursor: "pointer"
                                  }}
                                >
                                  {dayName}
                                </button>
                              );
                            })}
                          </div>
                          
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                              <span style={{ fontSize: "0.6rem", fontWeight: "700", color: "var(--slate-400)", textTransform: "uppercase" }}>🌅 Outbound</span>
                              <input
                                type="time"
                                value={newOutboundTime}
                                onChange={(e) => setNewOutboundTime(e.target.value)}
                                style={{ width: "100%", padding: "5px", borderRadius: "6px", border: "1px solid rgba(226,232,240,0.9)", fontSize: "0.72rem", outline: "none" }}
                              />
                            </div>
                            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                              <span style={{ fontSize: "0.6rem", fontWeight: "700", color: "var(--slate-400)", textTransform: "uppercase" }}>🌇 Return</span>
                              <input
                                type="time"
                                value={newReturnTime}
                                onChange={(e) => setNewReturnTime(e.target.value)}
                                style={{ width: "100%", padding: "5px", borderRadius: "6px", border: "1px solid rgba(226,232,240,0.9)", fontSize: "0.72rem", outline: "none" }}
                              />
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                  </div>
                </div>

                {/* Cycling Preference */}
                <div className="glass-panel" style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  <h3 style={{ fontSize: "0.82rem", fontWeight: "800", color: "var(--slate-800)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                    Cycling Preference
                  </h3>
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
                          borderRadius: "8px",
                          border: "1px solid",
                          borderColor: newBikeType === b.id ? "var(--primary)" : "rgba(226, 232, 240, 0.9)",
                          background: newBikeType === b.id ? "rgba(79, 70, 229, 0.08)" : "#ffffff",
                          color: newBikeType === b.id ? "var(--primary)" : "var(--slate-600)",
                          fontSize: "0.68rem",
                          fontWeight: "700",
                          cursor: "pointer"
                        }}
                      >
                        <span style={{ fontSize: "0.85rem", display: "block" }}>{b.icon}</span>
                        <span style={{ fontSize: "0.55rem" }}>{b.name.split(" ")[0]}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Cancel & Continue Actions */}
                <div style={{ display: "flex", gap: "10px", marginTop: "4px" }}>
                  <button
                    onClick={() => setIsAddingTrip(false)}
                    style={{
                      flex: "1",
                      padding: "12px",
                      border: "1px solid rgba(226, 232, 240, 0.9)",
                      background: "#ffffff",
                      color: "var(--slate-600)",
                      borderRadius: "12px",
                      fontSize: "0.82rem",
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
                      borderRadius: "12px",
                      fontSize: "0.82rem",
                      fontWeight: "700",
                      cursor: (!draftStart || !draftEnd) ? "not-allowed" : "pointer",
                      boxShadow: (!draftStart || !draftEnd) ? "none" : "0 8px 20px rgba(79, 70, 229, 0.2)"
                    }}
                  >
                    Activate Route
                  </button>
                </div>

              </div>
            </>
          )}
        </>
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
          
          {/* Circular Score Gauge Metric (if a ride is active) */}
          {currentForecast && (
            <ScoreMetric forecast={currentForecast} unitSystem={unitSystem} />
          )}

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
          ) : (
            /* Mockup-Themed Conditions Panel */
            <div className="glass-panel animate-fade-in" style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              <h3 style={{ fontSize: "0.82rem", fontWeight: "800", color: "var(--slate-700)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                Conditions
              </h3>
              
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                
                {/* 1. WIND */}
                <div className="condition-card">
                  <div>
                    <div style={{ fontSize: "0.62rem", color: "var(--slate-400)", fontWeight: "700", textTransform: "uppercase" }}>Wind</div>
                    <div style={{ fontSize: "0.95rem", fontWeight: "800", color: "var(--slate-800)", marginTop: "2px" }}>
                      {currentForecast 
                        ? `${unitSystem === "imperial" ? (currentForecast.windSpeed * 0.621371).toFixed(0) : currentForecast.windSpeed.toFixed(0)} ${unitSystem === "imperial" ? "mph" : "km/h"} ${getWindCompassDirection(currentForecast.windDir)}`
                        : (() => {
                            if (weatherResults.length > 0) {
                              const rawWind = weatherResults[0]?.hourly?.wind_speed_10m?.[currentHourIdx] ?? 10;
                              const rawDir = weatherResults[0]?.hourly?.wind_direction_10m?.[currentHourIdx] ?? 0;
                              return `${unitSystem === "imperial" ? (rawWind * 0.621371).toFixed(0) : rawWind.toFixed(0)} ${unitSystem === "imperial" ? "mph" : "km/h"} ${getWindCompassDirection(rawDir)}`;
                            }
                            return "4 mph SW";
                          })()}
                    </div>
                    <div style={{ fontSize: "0.68rem", color: "var(--slate-500)", marginTop: "2px" }}>
                      {currentForecast ? currentForecast.windImpact : "Light breeze"}
                    </div>
                  </div>
                  <div className="condition-icon-container" style={{ background: "rgba(16, 185, 129, 0.08)", color: "var(--emerald)", flexShrink: 0 }}>
                    <Compass size={18} />
                  </div>
                </div>

                {/* 2. RAIN */}
                <div className="condition-card">
                  <div>
                    <div style={{ fontSize: "0.62rem", color: "var(--slate-400)", fontWeight: "700", textTransform: "uppercase" }}>Rain</div>
                    <div style={{ fontSize: "0.95rem", fontWeight: "800", color: "var(--slate-800)", marginTop: "2px" }}>
                      {currentForecast 
                        ? `${currentForecast.rainProb}%` 
                        : (() => {
                            if (weatherResults.length > 0) {
                              return `${weatherResults[0]?.hourly?.precipitation_probability?.[currentHourIdx] ?? 0}%`;
                            }
                            return "0%";
                          })()}
                    </div>
                    <div style={{ fontSize: "0.68rem", color: "var(--slate-500)", marginTop: "2px" }}>
                      {(currentForecast && currentForecast.rainProb > 30) || (weatherResults.length > 0 && weatherResults[0]?.hourly?.precipitation_probability?.[currentHourIdx] > 30)
                        ? "Precipitation risk" 
                        : "No precipitation"}
                    </div>
                  </div>
                  <div className="condition-icon-container" style={{ background: "rgba(59, 130, 246, 0.08)", color: "var(--primary)", flexShrink: 0 }}>
                    <Sun size={18} />
                  </div>
                </div>

                {/* 3. TEMPERATURE */}
                <div className="condition-card">
                  <div>
                    <div style={{ fontSize: "0.62rem", color: "var(--slate-400)", fontWeight: "700", textTransform: "uppercase" }}>Temperature</div>
                    <div style={{ fontSize: "0.95rem", fontWeight: "800", color: "var(--slate-800)", marginTop: "2px" }}>
                      {currentForecast 
                        ? (unitSystem === "imperial" ? `${(currentForecast.temp * 1.8 + 32).toFixed(0)}°F` : `${currentForecast.temp.toFixed(0)}°C`) 
                        : (() => {
                            if (weatherResults.length > 0) {
                              const rawTemp = weatherResults[0]?.hourly?.temperature_2m?.[currentHourIdx] ?? 20;
                              return unitSystem === "imperial" ? `${(rawTemp * 1.8 + 32).toFixed(0)}°F` : `${rawTemp.toFixed(0)}°C`;
                            }
                            return "68°F";
                          })()}
                    </div>
                    <div style={{ fontSize: "0.68rem", color: "var(--slate-500)", marginTop: "2px" }}>
                      {currentForecast 
                        ? (currentForecast.temp < 12 ? "Cooler winds" : currentForecast.temp > 28 ? "Very warm" : "Comfortable")
                        : "Mild weather"}
                    </div>
                  </div>
                  <div className="condition-icon-container" style={{ background: "rgba(217, 119, 6, 0.08)", color: "var(--amber)", flexShrink: 0 }}>
                    <Clock size={18} />
                  </div>
                </div>

                {/* 4. ROAD SURFACE */}
                <div className="condition-card">
                  <div>
                    <div style={{ fontSize: "0.62rem", color: "var(--slate-400)", fontWeight: "700", textTransform: "uppercase" }}>Road Surface</div>
                    <div style={{ fontSize: "0.95rem", fontWeight: "800", color: "var(--slate-800)", marginTop: "2px" }}>
                      {((currentForecast && currentForecast.rainProb > 40) || (weatherResults.length > 0 && weatherResults[0]?.hourly?.precipitation_probability?.[currentHourIdx] > 40))
                        ? "Damp / Wet"
                        : "Dry"}
                    </div>
                    <div style={{ fontSize: "0.68rem", color: "var(--slate-500)", marginTop: "2px" }}>
                      {((currentForecast && currentForecast.rainProb > 40) || (weatherResults.length > 0 && weatherResults[0]?.hourly?.precipitation_probability?.[currentHourIdx] > 40))
                        ? "Caution advised" 
                        : "Good traction"}
                    </div>
                  </div>
                  <div className="condition-icon-container" style={{ background: "rgba(79, 70, 229, 0.08)", color: "var(--primary)", flexShrink: 0 }}>
                    <Bike size={18} />
                  </div>
                </div>

              </div>
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
                💡 Slide to scrub through hourly forecasts. The map&apos;s ambient wind directions and rain streams will morph instantly.
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

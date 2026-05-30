"use client";

import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { Bike, Navigation, AlertTriangle, Compass, CloudSun, ShieldAlert } from "lucide-react";
import TripPlanner from "@/components/TripPlanner";
import ScoreMetric from "@/components/ScoreMetric";
import WeatherDetails from "@/components/WeatherDetails";
import WeatherTimeline from "@/components/WeatherTimeline";

import { fetchBicycleRoute, fetchRouteWeather } from "@/utils/api";
import { decodePolyline6, calculateRouteSegments, sampleCoordinates } from "@/utils/routeUtils";
import { calculateCommuteScore, calculateDepartureTimeForArrival } from "@/utils/weatherScoring";

// Dynamic import of RouteMap to completely bypass SSR Leaflet issues
const RouteMap = dynamic(() => import("@/components/RouteMap"), {
  ssr: false,
  loading: () => (
    <div style={{
      display: "flex",
      justifyContent: "center",
      alignItems: "center",
      height: "100%",
      minHeight: "350px",
      background: "#070a13",
      color: "var(--slate-400)",
      borderRadius: "12px",
      border: "1px solid var(--card-border)",
      fontSize: "0.9rem"
    }}>
      <span>Initializing Interactive Leaflet Engine...</span>
    </div>
  )
});

export default function Home() {
  // Route planning state
  const [startLocation, setStartLocation] = useState(null);
  const [endLocation, setEndLocation] = useState(null);
  const [bikeType, setBikeType] = useState("Hybrid");
  const [customSpeed, setCustomSpeed] = useState(18);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  // Computed routing & weather states
  const [routeCoordinates, setRouteCoordinates] = useState([]);
  const [routeSegments, setRouteSegments] = useState([]);
  const [weatherResults, setWeatherResults] = useState([]);
  const [sampledCoords, setSampledCoords] = useState([]);

  // Time & selection states
  const [selectedDay, setSelectedDay] = useState(0);
  const [selectedHour, setSelectedHour] = useState(8); // default to 8 AM commute

  // Arrival Planning Mode states
  const [isArrivalMode, setIsArrivalMode] = useState(false);
  const [arrivalDate, setArrivalDate] = useState("");
  const [arrivalTime, setArrivalTime] = useState("09:00");
  const [arrivalCalculationResult, setArrivalCalculationResult] = useState(null);

  // Initialize arrivalDate to today
  useEffect(() => {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, "0");
    const dd = String(today.getDate()).padStart(2, "0");
    setArrivalDate(`${yyyy}-${mm}-${dd}`);
  }, []);

  const handleCalculateForecast = async () => {
    if (!startLocation || !endLocation) {
      setError("Please specify both a starting location and destination.");
      return;
    }

    setIsLoading(true);
    setError(null);
    setArrivalCalculationResult(null);

    try {
      // 1. Fetch bicycle route from Valhalla
      const routeData = await fetchBicycleRoute(
        startLocation.lat,
        startLocation.lon,
        endLocation.lat,
        endLocation.lon,
        bikeType,
        customSpeed
      );

      // 2. Decode polyline6 shape into coordinates list
      const decodedCoords = decodePolyline6(routeData.shape);
      setRouteCoordinates(decodedCoords);

      // 3. Compute detailed segment lengths & bearings
      const segments = calculateRouteSegments(decodedCoords);
      setRouteSegments(segments);

      // 4. Fetch weather across sampled locations along route
      const weatherData = await fetchRouteWeather(decodedCoords, routeData.distance);
      setWeatherResults(weatherData);
      
      // Keep track of which coordinates were sampled for mapping
      const numSamples = weatherData.length;
      const samples = sampleCoordinates(decodedCoords, numSamples);
      setSampledCoords(samples);

      // 5. If Arrival Mode is active, perform the aerodynamic feedback loop
      if (isArrivalMode && arrivalDate && arrivalTime) {
        const targetDateTime = new Date(`${arrivalDate}T${arrivalTime}`);
        
        const result = calculateDepartureTimeForArrival(
          targetDateTime,
          segments,
          customSpeed,
          weatherData
        );
        
        setArrivalCalculationResult(result);

        // Auto-select the day and hour corresponding to suggested departure
        const firstHourlyTimeStr = weatherData[0]?.hourly?.time?.[0];
        if (firstHourlyTimeStr) {
          const forecastStart = new Date(firstHourlyTimeStr);
          const diffMs = result.departureTime - forecastStart;
          const depHourIdxOverall = Math.max(0, Math.min(167, Math.floor(diffMs / (1000 * 60 * 60))));
          
          setSelectedDay(Math.floor(depHourIdxOverall / 24));
          setSelectedHour(depHourIdxOverall % 24);
        }
      } else {
        // Reset selected hour/day to default daytime biking focus
        setSelectedDay(0);
        setSelectedHour(8);
      }

    } catch (err) {
      console.error(err);
      setError(err.message || "An unexpected error occurred while calculating your forecast.");
    } finally {
      setIsLoading(false);
    }
  };

  // Compile forecast metrics for the currently selected day/hour
  const currentHourIdx = selectedDay * 24 + selectedHour;
  const currentForecast = (weatherResults.length > 0 && routeSegments.length > 0)
    ? calculateCommuteScore(currentHourIdx, routeSegments, customSpeed, weatherResults)
    : null;

  return (
    <div style={{
      minHeight: "100vh",
      background: "radial-gradient(ellipse at top, #0f1830, var(--background))",
      padding: "24px 16px",
      display: "flex",
      flexDirection: "column",
      gap: "24px"
    }}>
      {/* HEADER / NAVIGATION */}
      <header style={{
        maxWidth: "1400px",
        width: "100%",
        margin: "0 auto",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        flexWrap: "wrap",
        gap: "16px",
        paddingBottom: "12px",
        borderBottom: "1px solid rgba(255, 255, 255, 0.05)"
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div style={{
            background: "linear-gradient(135deg, var(--primary), var(--primary-hover))",
            width: "42px",
            height: "42px",
            borderRadius: "10px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 0 20px var(--primary-glow)"
          }}>
            <Bike size={24} style={{ color: "white" }} />
          </div>
          <div>
            <h1 style={{ fontSize: "1.5rem", fontWeight: "800", color: "white", letterSpacing: "-0.02em" }}>
              AERO-BIKE
            </h1>
            <p style={{ fontSize: "0.75rem", color: "var(--slate-400)", fontWeight: "500" }}>
              Dynamic 7-Day Wind-Aware Biking Forecast
            </p>
          </div>
        </div>
        
        <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "0.8rem", color: "var(--slate-400)" }}>
          <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "var(--emerald)", display: "inline-block" }}></span>
          All calculations processed locally client-side
        </div>
      </header>

      {/* DASHBOARD CORE */}
      <main style={{
        maxWidth: "1400px",
        width: "100%",
        margin: "0 auto",
        display: "grid",
        gridTemplateColumns: "minmax(320px, 400px) 1fr",
        gap: "24px",
        flexGrow: "1",
        alignItems: "start"
      }} className="animate-fade-in">
        
        {/* LEFT COLUMN: CONTROLS & TRIP PLANNER */}
        <section style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          <TripPlanner
            startLocation={startLocation}
            setStartLocation={setStartLocation}
            endLocation={endLocation}
            setEndLocation={setEndLocation}
            bikeType={bikeType}
            setBikeType={setBikeType}
            customSpeed={customSpeed}
            setCustomSpeed={setCustomSpeed}
            onCalculate={handleCalculateForecast}
            isLoading={isLoading}
            arrivalDate={arrivalDate}
            setArrivalDate={setArrivalDate}
            arrivalTime={arrivalTime}
            setArrivalTime={setArrivalTime}
            isArrivalMode={isArrivalMode}
            setIsArrivalMode={setIsArrivalMode}
            arrivalCalculationResult={arrivalCalculationResult}
          />

          {error && (
            <div style={{
              background: "rgba(239, 68, 68, 0.1)",
              border: "1px solid rgba(239, 68, 68, 0.2)",
              borderRadius: "12px",
              padding: "16px",
              color: "var(--rose)",
              fontSize: "0.85rem",
              display: "flex",
              alignItems: "flex-start",
              gap: "10px"
            }}>
              <ShieldAlert size={18} style={{ flexShrink: "0" }} />
              <div>
                <strong style={{ display: "block", marginBottom: "4px" }}>Calculation Error</strong>
                {error}
              </div>
            </div>
          )}
        </section>

        {/* RIGHT COLUMN: MAPS, SCORE METRIC & WEATHER TIMELINE */}
        <section style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
          {/* Map & Metric Grid (Horizontal stack) */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "1fr minmax(320px, 400px)",
            gap: "24px",
            alignItems: "stretch"
          }}>
            {/* Interactive Leaflet Map wrapper */}
            <div className="glass-panel" style={{ padding: "0", minHeight: "350px", height: "100%", overflow: "hidden" }}>
              <RouteMap
                coordinates={routeCoordinates}
                startLocation={startLocation}
                endLocation={endLocation}
                sampledCoords={sampledCoords}
              />
            </div>

            {/* Circular score gauge & breakdown */}
            {currentForecast ? (
              <ScoreMetric forecast={currentForecast} />
            ) : (
              <div className="glass-panel" style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--slate-400)",
                textAlign: "center",
                padding: "40px 24px",
                gap: "16px"
              }}>
                <CloudSun size={48} style={{ color: "var(--slate-500)" }} />
                <div>
                  <h4 style={{ color: "white", fontSize: "1rem", fontWeight: "700" }}>Commute Suitability Gauge</h4>
                  <p style={{ fontSize: "0.8rem", color: "var(--slate-500)", marginTop: "4px" }}>
                    Configure your route and hit calculate to evaluate headwind penalties and thermal comfort scores.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Route-Specific weather stations comparison */}
          {weatherResults.length > 0 && (
            <WeatherDetails
              weatherResults={weatherResults}
              hourIndex={currentHourIdx}
              startLocation={startLocation}
              endLocation={endLocation}
            />
          )}

          {/* 7-Day & 24-Hour Biking Timelines */}
          {weatherResults.length > 0 && routeSegments.length > 0 && (
            <div className="glass-panel">
              <WeatherTimeline
                weatherResults={weatherResults}
                routeSegments={routeSegments}
                baseSpeed={customSpeed}
                selectedDay={selectedDay}
                setSelectedDay={setSelectedDay}
                selectedHour={selectedHour}
                setSelectedHour={setSelectedHour}
                preferences={{}}
              />
            </div>
          )}
        </section>

      </main>

      {/* FOOTER */}
      <footer style={{
        maxWidth: "1400px",
        width: "100%",
        margin: "24px auto 0 auto",
        paddingTop: "16px",
        borderTop: "1px solid rgba(255, 255, 255, 0.05)",
        textAlign: "center",
        fontSize: "0.75rem",
        color: "var(--slate-500)",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        flexWrap: "wrap",
        gap: "10px"
      }}>
        <span>AERO-BIKE Commute Forecast © 2026. Made with Open Source APIs.</span>
        <div style={{ display: "flex", gap: "16px" }}>
          <span>Open-Meteo Weather</span>
          <span>Valhalla Routing Engine</span>
          <span>OpenStreetMap (OSM)</span>
          <span>Nominatim Geocoder</span>
        </div>
      </footer>
    </div>
  );
}

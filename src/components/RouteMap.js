"use client";

import { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";

export default function RouteMap({
  coordinates = [],
  startLocation = null,
  endLocation = null,
  routeSegments = [],
  weatherResults = [],
  selectedDay = 0,
  selectedHour = 8,
  customSpeed = 18,
  isDrawingMode = false,
  onMapClick = null,
  unitSystem = "metric"
}) {
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const layersRef = useRef({ polylines: [], markers: [] });
  
  // Real-time environmental overlays state
  const [ambientTemp, setAmbientTemp] = useState(20);
  const [ambientRain, setAmbientRain] = useState(0);
  const [ambientWindSpeed, setAmbientWindSpeed] = useState(10);
  const [ambientWindDir, setAmbientWindDir] = useState(0);

  // 1. Initialize Map Instance and Geolocation
  useEffect(() => {
    let L;
    const initMap = async () => {
      L = await import("leaflet");
      
      // Fix leaflet marker icon issues in dynamic Next.js imports
      delete L.Icon.Default.prototype._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: "https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon-2x.png",
        iconUrl: "https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon.png",
        shadowUrl: "https://unpkg.com/leaflet@1.7.1/dist/images/marker-shadow.png",
      });

      if (!mapContainerRef.current) return;

      if (!mapInstanceRef.current) {
        // Initialize at New York default center, but quickly resolve geolocation
        const map = L.map(mapContainerRef.current, {
          zoomControl: false, // Clean HUD design
          scrollWheelZoom: true,
          attributionControl: false
        }).setView([40.7128, -74.0060], 13);

        // Pristine CartoDB Positron tile layer for modern light theme
        L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
          maxZoom: 20
        }).addTo(map);

        // Add a clean zoom control at the bottom right
        L.control.zoom({
          position: "bottomright"
        }).addTo(map);

        mapInstanceRef.current = map;

        // Try getting user current location to center map smoothly
        if (navigator.geolocation) {
          navigator.geolocation.getCurrentPosition(
            (position) => {
              const { latitude, longitude } = position.coords;
              map.flyTo([latitude, longitude], 13, { duration: 1.5 });
            },
            (err) => console.log("Geolocation centered denied: ", err.message),
            { enableHighAccuracy: true, timeout: 5000 }
          );
        }

        // Handle Map clicks when in drawing mode
        map.on("click", (e) => {
          if (onMapClick) {
            onMapClick({ lat: e.latlng.lat, lon: e.latlng.lng });
          }
        });
      }
    };

    initMap();

    return () => {
      // Clean up maps on unmount
    };
  }, [onMapClick]);

  // 2. Clear and Render Routes & Markers
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    const map = mapInstanceRef.current;
    
    // Clear old layers
    layersRef.current.polylines.forEach(p => p.remove());
    layersRef.current.polylines = [];
    layersRef.current.markers.forEach(m => m.remove());
    layersRef.current.markers = [];

    import("leaflet").then((L) => {
      const currentHourIdx = selectedDay * 24 + selectedHour;
      const numSamples = weatherResults.length;

      // Draw color-coded, motion-encoded polyline segments
      if (routeSegments && routeSegments.length > 0 && weatherResults.length > 0) {
        routeSegments.forEach((seg, idx) => {
          // Find closest weather sample point index for this segment
          const sampleIdx = Math.min(Math.floor((idx / routeSegments.length) * numSamples), numSamples - 1);
          const hourly = weatherResults[sampleIdx]?.hourly;
          
          const windSpeed = hourly?.wind_speed_10m?.[currentHourIdx] ?? 0;
          const windDir = hourly?.wind_direction_10m?.[currentHourIdx] ?? 0;
          
          const angleRad = ((seg.bearing - windDir) * Math.PI) / 180;
          const headwind = windSpeed * Math.cos(angleRad);
          const crosswind = windSpeed * Math.abs(Math.sin(angleRad));
          
          let difficulty = "Neutral";
          let color = "var(--primary)"; // Indigo
          let flowClass = "route-flow-neutral";
          
          if (headwind > 12 || crosswind > 20) {
            difficulty = "Hard (Strong winds)";
            color = "var(--rose)";
            flowClass = "route-flow-hard";
          } else if (headwind > 4 || crosswind > 10) {
            difficulty = "Moderate (Mild winds)";
            color = "var(--amber)";
            flowClass = "route-flow-medium";
          } else if (headwind < -4) {
            difficulty = "Easy (Helpful tailwind)";
            color = "var(--emerald)";
            flowClass = "route-flow-easy";
          }

          const polyCoords = [[seg.lat1, seg.lon1], [seg.lat2, seg.lon2]];

          // Thin background line for outline definition
          const bgLine = L.polyline(polyCoords, {
            color: color,
            weight: 7,
            opacity: 0.15,
            lineJoin: "round"
          }).addTo(map);

          // Flow dash line
          const poly = L.polyline(polyCoords, {
            color: color,
            weight: 4,
            opacity: 0.9,
            lineJoin: "round"
          }).addTo(map);

          // Inject animated styling via Leaflet internal SVG renderer
          if (poly._path) {
            poly._path.classList.add(flowClass);
          }

          const isImperial = unitSystem === "imperial";
          const displayDist = isImperial 
            ? `${Math.round(seg.distance * 1000 * 3.28084)} ft` 
            : `${Math.round(seg.distance * 1000)} m`;
          const displayWind = isImperial 
            ? `${(windSpeed * 0.621371).toFixed(1)} mph` 
            : `${windSpeed.toFixed(1)} km/h`;
          const displayHeadwind = isImperial 
            ? `${headwind > 0 ? "Headwind" : "Tailwind"} ${(Math.abs(headwind) * 0.621371).toFixed(1)} mph` 
            : `${headwind > 0 ? "Headwind" : "Tailwind"} ${Math.abs(headwind).toFixed(1)} km/h`;

          // Tooltip showing exact parameters
          poly.on("mouseover", function() {
            poly.setStyle({ weight: 7 });
            this.bindTooltip(`
              <div style="font-family: 'Plus Jakarta Sans', sans-serif; font-size: 11px; padding: 2px;">
                <strong style="color: ${color}; font-size: 12px;">${difficulty}</strong><br/>
                📏 Distance: <strong>${displayDist}</strong><br/>
                🧭 Bearing: <strong>${Math.round(seg.bearing)}°</strong><br/>
                💨 Wind: <strong>${displayWind}</strong> (${Math.round(windDir)}°)<br/>
                🚴 Wind Resistance: <strong>${displayHeadwind}</strong>
              </div>
            `, { sticky: true }).openTooltip();
          });

          poly.on("mouseout", function() {
            poly.setStyle({ weight: 4 });
          });

          layersRef.current.polylines.push(bgLine);
          layersRef.current.polylines.push(poly);
        });

        // Fit map bounds to frame the route nicely
        const bounds = L.latLngBounds(coordinates);
        map.fitBounds(bounds, { padding: [80, 80] });
      }

      // Draw start location pin (Pulsing emerald ring)
      if (startLocation) {
        const startIcon = L.divIcon({
          className: "",
          html: `
            <div style="position: relative; width: 16px; height: 16px;">
              <div class="marker-ripple" style="width: 16px; height: 16px; background: rgba(16, 185, 129, 0.4);"></div>
              <div class="custom-marker-start" style="width: 16px; height: 16px;"></div>
            </div>
          `,
          iconSize: [16, 16],
          iconAnchor: [8, 8]
        });
        const startMarker = L.marker([startLocation.lat, startLocation.lon], { icon: startIcon }).addTo(map);
        layersRef.current.markers.push(startMarker);
        
        if (!coordinates || coordinates.length === 0) {
          map.setView([startLocation.lat, startLocation.lon], 13);
        }
      }

      // Draw destination location pin (Pulsing rose ring)
      if (endLocation) {
        const endIcon = L.divIcon({
          className: "",
          html: `
            <div style="position: relative; width: 16px; height: 16px;">
              <div class="marker-ripple" style="width: 16px; height: 16px; background: rgba(225, 29, 72, 0.4);"></div>
              <div class="custom-marker-end" style="width: 16px; height: 16px;"></div>
            </div>
          `,
          iconSize: [16, 16],
          iconAnchor: [8, 8]
        });
        const endMarker = L.marker([endLocation.lat, endLocation.lon], { icon: endIcon }).addTo(map);
        layersRef.current.markers.push(endMarker);
      }
    });

  }, [coordinates, startLocation, endLocation, routeSegments, weatherResults, selectedDay, selectedHour, unitSystem]);

  // 3. Extract and animate atmospheric states
  useEffect(() => {
    if (weatherResults.length === 0) return;
    const currentHourIdx = selectedDay * 24 + selectedHour;
    const midIdx = Math.floor(weatherResults.length / 2);
    const midHourly = weatherResults[midIdx]?.hourly;

    if (midHourly) {
      setAmbientTemp(midHourly.temperature_2m?.[currentHourIdx] ?? 20);
      setAmbientRain(midHourly.precipitation_probability?.[currentHourIdx] ?? 0);
      setAmbientWindSpeed(midHourly.wind_speed_10m?.[currentHourIdx] ?? 10);
      setAmbientWindDir(midHourly.wind_direction_10m?.[currentHourIdx] ?? 0);
    }
  }, [weatherResults, selectedDay, selectedHour]);

  // Compute temperature tint color based on ambientTemp
  let tempWashColor = "transparent";
  let tempOpacity = 0;
  if (ambientTemp < 12) {
    // Cold: Icy blue wash
    tempWashColor = "rgba(6, 182, 212, 0.1)";
    tempOpacity = Math.min(0.6, (12 - ambientTemp) / 15);
  } else if (ambientTemp > 25) {
    // Hot: Warm solar wash
    tempWashColor = "rgba(245, 158, 11, 0.08)";
    tempOpacity = Math.min(0.5, (ambientTemp - 25) / 15);
  } else {
    // Ideal perfect weather: golden emerald shimmer
    tempWashColor = "rgba(16, 185, 129, 0.03)";
    tempOpacity = 0.3;
  }

  // Adjust wind flow animation rate based on wind speed
  const windAnimDuration = Math.max(1.8, 12 - (ambientWindSpeed / 4)) + "s";

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden" }}>
      {/* MAP CANVAS */}
      <div 
        ref={mapContainerRef} 
        style={{ width: "100%", height: "100%", background: "#f1f5f9" }} 
      />

      {/* LIVING HUD ENVIRONMENTAL OVERLAYS */}
      <div className="environmental-hud-overlay">
        
        {/* A. TEMPERATURE WASH */}
        <div 
          className="temp-wash-layer" 
          style={{ 
            backgroundColor: tempWashColor,
            opacity: tempOpacity
          }} 
        />

        {/* B. WIND PARTICLE GRID (SVG) - Rotated by current Wind Direction */}
        <svg 
          className="wind-stream-svg" 
          style={{ 
            transform: `rotate(${ambientWindDir}deg)`,
            opacity: weatherResults.length > 0 ? Math.min(0.35, 0.05 + (ambientWindSpeed / 50)) : 0.05
          }}
        >
          <g>
            <path className="wind-stream-line" style={{ animationDuration: windAnimDuration }} d="M -100,100 L 2000,100" />
            <path className="wind-stream-line" style={{ animationDuration: windAnimDuration, animationDelay: "1.5s" }} d="M -100,250 L 2000,250" />
            <path className="wind-stream-line" style={{ animationDuration: windAnimDuration, animationDelay: "3.2s" }} d="M -100,450 L 2000,450" />
            <path className="wind-stream-line" style={{ animationDuration: windAnimDuration, animationDelay: "0.5s" }} d="M -100,600 L 2000,600" />
            <path className="wind-stream-line" style={{ animationDuration: windAnimDuration, animationDelay: "2.1s" }} d="M -100,750 L 2000,750" />
            <path className="wind-stream-line" style={{ animationDuration: windAnimDuration, animationDelay: "4s" }} d="M -100,900 L 2000,900" />
          </g>
        </svg>

        {/* C. CSS FALLING RAIN STREAKS */}
        <div 
          className="rain-overlay-container" 
          style={{ opacity: weatherResults.length > 0 ? ambientRain / 100 : 0 }}
        >
          {/* Render 20 randomized rain streaks */}
          {Array.from({ length: 20 }).map((_, i) => {
            const leftVal = `${(i * 5.5) + (Math.random() * 2)}%`;
            const delayVal = `${Math.random() * 2}s`;
            const durationVal = `${0.8 + Math.random() * 0.6}s`;
            return (
              <div 
                key={i}
                className="rain-streak"
                style={{
                  left: leftVal,
                  top: "-100px",
                  animationDelay: delayVal,
                  animationDuration: durationVal
                }}
              />
            );
          })}
        </div>

      </div>
    </div>
  );
}

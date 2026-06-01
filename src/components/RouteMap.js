"use client";

import { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import { Compass, Navigation } from "lucide-react";

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
  unitSystem = "metric",
  hudState = 0,
  userLocation = null
}) {
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const layersRef = useRef({ polylines: [], markers: [], telemetries: [] });

  const handleJumpToGPS = () => {
    if (mapInstanceRef.current) {
      if (userLocation && userLocation.lat && userLocation.lon) {
        mapInstanceRef.current.setView([userLocation.lat, userLocation.lon], 14, { animate: true });
      } else if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            const coords = [pos.coords.latitude, pos.coords.longitude];
            mapInstanceRef.current.setView(coords, 14, { animate: true });
          },
          () => {
            mapInstanceRef.current.setView([40.7851, -73.9682], 13, { animate: true });
          }
        );
      } else {
        mapInstanceRef.current.setView([40.7851, -73.9682], 13, { animate: true });
      }
    }
  };

  const handleRecenterRoute = () => {
    if (mapInstanceRef.current) {
      if (coordinates.length > 0) {
        mapInstanceRef.current.fitBounds(coordinates, { padding: [50, 50] });
      } else {
        mapInstanceRef.current.setView([40.7851, -73.9682], 12, { animate: true });
      }
    }
  };

  const getCompassDirection = (deg) => {
    const directions = [
      "North (N)", "North-Northeast (NNE)", "Northeast (NE)", "East-Northeast (ENE)", 
      "East (E)", "East-Southeast (ESE)", "Southeast (SE)", "South-Southeast (SSE)", 
      "South (S)", "South-Southwest (SSW)", "Southwest (SW)", "West-Southwest (WSW)", 
      "West (W)", "West-Northwest (WNW)", "Northwest (NW)", "North-Northwest (NNW)"
    ];
    const val = Math.floor((deg / 22.5) + 0.5);
    return directions[val % 16];
  };

  const getWindCompass = (deg) => {
    const directions = [
      "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", 
      "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"
    ];
    const val = Math.floor(((deg % 360 + 360) % 360) / 22.5 + 0.5) % 16;
    return directions[val];
  };

  // Real-time HUD environmental states
  const [ambientTemp, setAmbientTemp] = useState(20);
  const [ambientRain, setAmbientRain] = useState(0);
  const [ambientWindSpeed, setAmbientWindSpeed] = useState(10);
  const [ambientWindDir, setAmbientWindDir] = useState(0);
  const [ambientGusts, setAmbientGusts] = useState(0);

  // 1. Initialize Map Canvas with Performance Dampening Listeners
  useEffect(() => {
    let L;
    const initMap = async () => {
      L = await import("leaflet");
      
      // Fix leaflet marker icon overrides
      delete L.Icon.Default.prototype._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: "https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon-2x.png",
        iconUrl: "https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon.png",
        shadowUrl: "https://unpkg.com/leaflet@1.7.1/dist/images/marker-shadow.png",
      });

      if (!mapContainerRef.current) return;

      if (!mapInstanceRef.current) {
        const map = L.map(mapContainerRef.current, {
          zoomControl: false, // Pill zoom controls added via HUD styles
          scrollWheelZoom: true,
          attributionControl: false
        }).setView([40.7128, -74.0060], 13);

        // Premium CartoDB Dark Matter / Positron spatial canvas tiles (Dark mode matching HUD)
        L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
          maxZoom: 20
        }).addTo(map);

        L.control.zoom({
          position: "bottomright"
        }).addTo(map);

        mapInstanceRef.current = map;

        // Performance guardrails: fade overlays to 10% opacity during pans/zooms to maintain 60fps
        map.on("movestart", () => {
          if (mapContainerRef.current) {
            mapContainerRef.current.classList.add("map-moving");
          }
        });

        map.on("moveend", () => {
          if (mapContainerRef.current) {
            mapContainerRef.current.classList.remove("map-moving");
          }
        });

        if (navigator.geolocation) {
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              const { latitude, longitude } = pos.coords;
              map.flyTo([latitude, longitude], 13, { duration: 1.5 });
            },
            () => console.log("Ambient location default NYC center loaded."),
            { enableHighAccuracy: true, timeout: 5000 }
          );
        }

        map.on("click", (e) => {
          if (onMapClick) {
            onMapClick({ lat: e.latlng.lat, lon: e.latlng.lng });
          }
        });
      }
    };

    initMap();
  }, [onMapClick]);

  // 2. Render Route, Dynamic Markers, and Telemetry Pins (💧, 🍌)
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    const map = mapInstanceRef.current;
    
    // Clear old layers
    layersRef.current.polylines.forEach(p => p.remove());
    layersRef.current.polylines = [];
    layersRef.current.markers.forEach(m => m.remove());
    layersRef.current.markers = [];
    layersRef.current.telemetries.forEach(t => t.remove());
    layersRef.current.telemetries = [];

    import("leaflet").then((L) => {
      let currentHourIdx;
      if (hudState === 3) {
        // If actively scrubbing the timeline in State 3, sync with the scrubber values
        currentHourIdx = selectedDay * 24 + selectedHour;
      } else {
        // If in ambient state (State 0, 1, or 2), display the actual current local hour
        const now = new Date();
        const year = now.getFullYear();
        const month = (now.getMonth() + 1).toString().padStart(2, "0");
        const date = now.getDate().toString().padStart(2, "0");
        const hour = now.getHours().toString().padStart(2, "0");
        const currentHourStr = `${year}-${month}-${date}T${hour}:00`;
        
        // Find hour index in the first weather station's hourly time array
        const firstHourly = weatherResults[0]?.hourly;
        let matchedIdx = firstHourly?.time?.indexOf(currentHourStr);
        if (matchedIdx === -1 || matchedIdx === undefined) {
          matchedIdx = now.getHours(); // Fallback to current local hour index
        }
        currentHourIdx = matchedIdx;
      }

      const numSamples = weatherResults.length;

      if (routeSegments && routeSegments.length > 0 && weatherResults.length > 0) {
        // Track overall route distance to place items appropriately
        let accumulatedDistance = 0;

        routeSegments.forEach((seg, idx) => {
          const sampleIdx = Math.min(Math.floor((idx / routeSegments.length) * numSamples), numSamples - 1);
          const hourly = weatherResults[sampleIdx]?.hourly;
          
          const windSpeed = hourly?.wind_speed_10m?.[currentHourIdx] ?? 0;
          const windDir = hourly?.wind_direction_10m?.[currentHourIdx] ?? 0;
          const tempVal = hourly?.temperature_2m?.[currentHourIdx] ?? 20;
          const isRaining = (hourly?.precipitation?.[currentHourIdx] ?? 0) > 0.1;
          
          const angleRad = ((seg.bearing - windDir) * Math.PI) / 180;
          const headwind = windSpeed * Math.cos(angleRad);
          const crosswind = windSpeed * Math.abs(Math.sin(angleRad));
          
          accumulatedDistance += seg.distance; // seg.distance is in km

          let difficulty = "Neutral";
          let color = "var(--primary)";
          let flowClass = "route-flow-neutral";
          
          if (headwind > 12 || crosswind > 20) {
            difficulty = "Adverse Winds (Heavy effort)";
            color = "var(--color-ruby)";
            flowClass = "route-flow-hard";
          } else if (headwind > 4 || crosswind > 10) {
            difficulty = "Moderate resistance";
            color = "var(--color-amber)";
            flowClass = "route-flow-medium";
          } else if (headwind < -4) {
            difficulty = "Helpful Tailwind";
            color = "var(--color-emerald)";
            flowClass = "route-flow-easy";
          }

          const polyCoords = [[seg.lat1, seg.lon1], [seg.lat2, seg.lon2]];

          // Core polyline shadow boundary
          const bgLine = L.polyline(polyCoords, {
            color: color,
            weight: 8,
            opacity: 0.18,
            lineJoin: "round"
          }).addTo(map);

          // Animated vector flow line
          const poly = L.polyline(polyCoords, {
            color: color,
            weight: 4,
            opacity: 0.85,
            lineJoin: "round"
          }).addTo(map);

          if (poly._path) {
            poly._path.classList.add(flowClass);
          }

          const isImperial = unitSystem === "imperial";
          const displayDist = isImperial 
            ? `${Math.round(seg.distance * 0.621371 * 10) / 10} mi` 
            : `${Math.round(seg.distance * 10) / 10} km`;
          const displayWind = isImperial 
            ? `${(windSpeed * 0.621371).toFixed(1)} mph` 
            : `${windSpeed.toFixed(1)} km/h`;
          const displayHeadwind = isImperial 
            ? `${headwind > 0 ? "Headwind" : "Tailwind"} ${(Math.abs(headwind) * 0.621371).toFixed(1)} mph` 
            : `${headwind > 0 ? "Headwind" : "Tailwind"} ${Math.abs(headwind).toFixed(1)} km/h`;

          // Calculate estimated segment biking speed adjusted for headwind/tailwind
          let adjustedSpeed = customSpeed;
          if (headwind > 0) {
            adjustedSpeed += -0.45 * headwind;
          } else {
            adjustedSpeed += -0.18 * headwind;
          }
          adjustedSpeed = Math.max(6, adjustedSpeed);

          const displaySpeed = isImperial 
            ? `${(adjustedSpeed * 0.621371).toFixed(1)} mph` 
            : `${adjustedSpeed.toFixed(1)} km/h`;

          const maxSpeedScale = 45; // max scale boundary
          const speedPercent = Math.min(100, Math.max(10, (adjustedSpeed / maxSpeedScale) * 100));

          // Broad interactive hover overlay (invisible but makes hover targeting effortless)
          const hoverPoly = L.polyline(polyCoords, {
            color: "transparent",
            weight: 24,
            opacity: 0,
            lineJoin: "round",
            interactive: true
          }).addTo(map);

          // Bind Tooltip once at creation time to the broad invisible overlay with dynamic inline SVGs
          hoverPoly.bindTooltip(`
            <div style="min-width: 220px; color: var(--hud-text-primary); padding: 4px;">
              <div style="border-bottom: 1px solid rgba(255,255,255,0.12); padding-bottom: 6px; margin-bottom: 8px;">
                <span style="font-family: var(--font-heading); font-size: 13px; font-weight: 800; color: ${color};">${difficulty}</span>
              </div>
              
              <!-- 2-Column Telemetry Grid -->
              <div class="tooltip-grid-container">
                
                <!-- Left Column: Speedometer & Distance Stats -->
                <div style="display: flex; flex-direction: column; gap: 6px;">
                  <div class="tooltip-cell">
                    <span class="tooltip-label">DISTANCE</span>
                    <strong class="tooltip-val">${displayDist}</strong>
                  </div>
                  <div class="tooltip-cell">
                    <span class="tooltip-label">BIKER SPEED</span>
                    <strong class="tooltip-val" style="color: ${color};">${displaySpeed}</strong>
                    
                    <!-- Biker Speedometer Bar SVG -->
                    <svg width="100%" height="8" style="margin-top: 4px; overflow: visible;">
                      <rect x="0" y="2" width="100%" height="4" rx="2" fill="rgba(255,255,255,0.1)"/>
                      <rect x="0" y="2" width="${speedPercent}%" height="4" rx="2" fill="${color}"/>
                    </svg>
                  </div>
                </div>
                
                <!-- Right Column: Dual Wind Dial SVG Widget -->
                <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; background: rgba(255,255,255,0.03); padding: 6px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.06);">
                  <span class="tooltip-label" style="margin-bottom: 4px; text-align: center;">WIND ALIGN</span>
                  
                  <svg width="44" height="44" viewBox="0 0 44 44" style="overflow: visible;">
                    <!-- Compass Ring -->
                    <circle cx="22" cy="22" r="19" fill="none" stroke="rgba(255,255,255,0.15)" stroke-width="1"/>
                    <text x="22" y="7" font-size="6" text-anchor="middle" fill="rgba(255,255,255,0.4)" font-weight="700">N</text>
                    
                    <!-- Rider Bearing Vector (Silver dashed line arrow) -->
                    <g transform="rotate(${seg.bearing}, 22, 22)">
                      <line x1="22" y1="22" x2="22" y2="5" stroke="rgba(255,255,255,0.5)" stroke-width="1.5" stroke-dasharray="2,2"/>
                      <polygon points="22,3 25,7 19,7" fill="rgba(255,255,255,0.6)"/>
                    </g>
                    
                    <!-- Wind Vector (Solid arrow pointing in wind direction) -->
                    <g transform="rotate(${windDir}, 22, 22)">
                      <!-- Line showing wind source direction -->
                      <line x1="22" y1="38" x2="22" y2="22" stroke="${color}" stroke-width="2"/>
                      <!-- arrowhead pointing towards center to show direction it is blowing -->
                      <polygon points="22,20 18,25 26,25" fill="${color}" style="filter: drop-shadow(0 0 2px ${color});"/>
                    </g>
                  </svg>
                  <span style="font-size: 8px; font-weight: 700; color: var(--hud-text-primary); margin-top: 4px; text-align: center;">${displayWind} ${getWindCompass(windDir)}</span>
                </div>
              </div>
              
              <div class="tooltip-divider">
                🚴 Resistance: <strong style="color: ${color};">${displayHeadwind}</strong>
              </div>
            </div>
          `, { 
            sticky: true,
            className: "leaflet-tooltip" 
          });

          // Style animations synced to broad hover triggers
          hoverPoly.on("mouseover", function() {
            poly.setStyle({ weight: 7 });
          });

          hoverPoly.on("mouseout", function() {
            poly.setStyle({ weight: 4 });
          });

          layersRef.current.polylines.push(bgLine);
          layersRef.current.polylines.push(poly);
          layersRef.current.polylines.push(hoverPoly);

          // -----------------------------------------------------------
          // WEATHER-ADAPTIVE PHYSICAL TELEMETRY PINS (💧, 🍌)
          // -----------------------------------------------------------
          const isMidPointSegment = idx === Math.floor(routeSegments.length / 2);
          const isQuarterPointSegment = idx === Math.floor(routeSegments.length / 4);
          const isThreeQuarterPointSegment = idx === Math.floor(routeSegments.length * 0.75);

          // A. Hydration Pin (💧)
          // Scale dynamically: Place in hot segments (>27°C / 80°F) or at the quarter point on sunny rides
          const needsHeatHydration = tempVal > 27 && (isQuarterPointSegment || isThreeQuarterPointSegment);
          const needsStandardHydration = isMidPointSegment && accumulatedDistance > 5; // Long commute default

          if (needsHeatHydration || needsStandardHydration) {
            const waterAmount = isImperial ? "12 fl oz" : "350 ml";
            const whyText = tempVal > 27 
              ? `Extreme heat detected (${tempVal.toFixed(1)}°C / ${(tempVal * 1.8 + 32).toFixed(0)}°F). Sweating rates are elevated.`
              : `Commute exertion depletion checkpoint.`;

            const waterIcon = L.divIcon({
              className: "",
              html: `
                <div style="
                  width: 30px; 
                  height: 30px; 
                  background: rgba(15, 23, 42, 0.85); 
                  border: 1.5px solid rgba(59, 130, 246, 0.4); 
                  border-radius: 50%; 
                  display: flex; 
                  align-items: center; 
                  justify-content: center;
                  box-shadow: 0 4px 10px rgba(59, 130, 246, 0.35);
                  cursor: pointer;
                  font-size: 14px;
                " class="hud-pulse-emerald">💧</div>
              `,
              iconSize: [30, 30],
              iconAnchor: [15, 15]
            });

            const hydMarker = L.marker([seg.lat1, seg.lon1], { icon: waterIcon }).addTo(map);
            
            hydMarker.bindPopup(`
              <div style="font-family: var(--font-body); font-size: 12px; color: var(--hud-text-primary); padding: 4px;">
                <h4 style="font-family: var(--font-heading); color: #3b82f6; font-size: 14px; margin-bottom: 6px; display: flex; align-items: center; gap: 4px;">💧 Hydration Alert</h4>
                <p style="margin-bottom: 8px; line-height: 1.45;">${whyText}</p>
                <div style="background: rgba(255,255,255,0.06); padding: 8px; border-radius: 8px; text-align: center;">
                  Drink <strong>${waterAmount}</strong> of fluid at this coordinate.
                </div>
              </div>
            `);

            layersRef.current.telemetries.push(hydMarker);
          }

          // B. Nutrition Pin (🍌)
          // Scale dynamically: Place preceding a steep headwind segment (>15km/h) or at midpoint on long rides (>15km)
          const needsHeadwindFuel = headwind > 12 && isMidPointSegment;
          const needsStandardFuel = isThreeQuarterPointSegment && accumulatedDistance > 12; // Long mileage default

          if (needsHeadwindFuel || needsStandardFuel) {
            const carbAmount = "30g Carbs (120 kcal)";
            const whyText = headwind > 12 
              ? `Heavy wind resistance active (${displayHeadwind}). Energy burning rate is increased by 35%.`
              : `Long-distance muscle glycogen depletion check.`;

            const foodIcon = L.divIcon({
              className: "",
              html: `
                <div style="
                  width: 30px; 
                  height: 30px; 
                  background: rgba(15, 23, 42, 0.85); 
                  border: 1.5px solid rgba(245, 158, 11, 0.4); 
                  border-radius: 50%; 
                  display: flex; 
                  align-items: center; 
                  justify-content: center;
                  box-shadow: 0 4px 10px rgba(245, 158, 11, 0.35);
                  cursor: pointer;
                  font-size: 14px;
                " class="hud-pulse-amber">🍌</div>
              `,
              iconSize: [30, 30],
              iconAnchor: [15, 15]
            });

            const nutMarker = L.marker([seg.lat1, seg.lon1], { icon: foodIcon }).addTo(map);
            
            nutMarker.bindPopup(`
              <div style="font-family: var(--font-body); font-size: 12px; color: var(--hud-text-primary); padding: 4px;">
                <h4 style="font-family: var(--font-heading); color: #f59e0b; font-size: 14px; margin-bottom: 6px; display: flex; align-items: center; gap: 4px;">🍌 Caloric Fuel Alert</h4>
                <p style="margin-bottom: 8px; line-height: 1.45;">${whyText}</p>
                <div style="background: rgba(255,255,255,0.06); padding: 8px; border-radius: 8px; text-align: center;">
                  Consume <strong>${carbAmount}</strong> to fuel through this segment.
                </div>
              </div>
            `);

            layersRef.current.telemetries.push(nutMarker);
          }
        });

        const bounds = L.latLngBounds(coordinates);
        map.fitBounds(bounds, { padding: [80, 80] });
      }

      // Draw start location pin (Pulsing emerald ring)
      if (startLocation) {
        const startIcon = L.divIcon({
          className: "",
          html: `
            <div style="position: relative; width: 18px; height: 18px;">
              <div class="marker-ripple" style="width: 18px; height: 18px; background: var(--color-emerald-glow);"></div>
              <div class="custom-marker-start" style="width: 18px; height: 18px;"></div>
            </div>
          `,
          iconSize: [18, 18],
          iconAnchor: [9, 9]
        });
        const startMarker = L.marker([startLocation.lat, startLocation.lon], { icon: startIcon }).addTo(map);
        layersRef.current.markers.push(startMarker);
        
        if (!coordinates || coordinates.length === 0) {
          map.setView([startLocation.lat, startLocation.lon], 13);
        }
      }

      // Draw destination location pin (Pulsing ruby ring)
      if (endLocation) {
        const endIcon = L.divIcon({
          className: "",
          html: `
            <div style="position: relative; width: 18px; height: 18px;">
              <div class="marker-ripple" style="width: 18px; height: 18px; background: var(--color-ruby-glow);"></div>
              <div class="custom-marker-end" style="width: 18px; height: 18px;"></div>
            </div>
          `,
          iconSize: [18, 18],
          iconAnchor: [9, 9]
        });
        const endMarker = L.marker([endLocation.lat, endLocation.lon], { icon: endIcon }).addTo(map);
        layersRef.current.markers.push(endMarker);
      }
    });

  }, [coordinates, startLocation, endLocation, routeSegments, weatherResults, selectedDay, selectedHour, unitSystem, hudState]);

  // 3. Sync and animate ambient atmospheric weather values
  useEffect(() => {
    if (weatherResults.length === 0) return;
    
    const midIdx = Math.floor(weatherResults.length / 2);
    const midHourly = weatherResults[midIdx]?.hourly;

    if (midHourly) {
      let currentHourIdx;
      if (hudState === 3) {
        // If actively scrubbing the timeline in State 3, sync with the scrubber values
        currentHourIdx = selectedDay * 24 + selectedHour;
      } else {
        // If in ambient state (State 0, 1, or 2), display the actual current local hour
        const now = new Date();
        const year = now.getFullYear();
        const month = (now.getMonth() + 1).toString().padStart(2, "0");
        const date = now.getDate().toString().padStart(2, "0");
        const hour = now.getHours().toString().padStart(2, "0");
        const currentHourStr = `${year}-${month}-${date}T${hour}:00`;
        
        let matchedIdx = midHourly.time?.indexOf(currentHourStr);
        if (matchedIdx === -1 || matchedIdx === undefined) {
          matchedIdx = now.getHours(); // Fallback to current local hour index
        }
        currentHourIdx = matchedIdx;
      }

      setAmbientTemp(midHourly.temperature_2m?.[currentHourIdx] ?? 20);
      setAmbientRain(midHourly.precipitation_probability?.[currentHourIdx] ?? 0);
      setAmbientWindSpeed(midHourly.wind_speed_10m?.[currentHourIdx] ?? 10);
      setAmbientWindDir(midHourly.wind_direction_10m?.[currentHourIdx] ?? 0);
      setAmbientGusts(midHourly.wind_gusts_10m?.[currentHourIdx] ?? 0);
    }
  }, [weatherResults, selectedDay, selectedHour, hudState]);

  // Compute temperature tint color based on ambientTemp
  let tempWashColor = "transparent";
  let tempOpacity = 0;
  if (ambientTemp < 10) {
    // Cold: Icy blue wash
    tempWashColor = "rgba(6, 182, 212, 0.15)";
    tempOpacity = Math.min(0.65, (10 - ambientTemp) / 15);
  } else if (ambientTemp > 28) {
    // Hot: Warm solar wash
    tempWashColor = "rgba(245, 158, 11, 0.1)";
    tempOpacity = Math.min(0.55, (ambientTemp - 28) / 15);
  } else {
    // Ideal perfect weather: subtle golden shimmers
    tempWashColor = "rgba(16, 185, 129, 0.03)";
    tempOpacity = 0.25;
  }

  // Adjust wind flow animation rate based on wind speed
  const windAnimDuration = Math.max(1.5, 10 - (ambientWindSpeed / 4)) + "s";
  const isHighGust = ambientGusts > 30; // 30km/h gust threshold

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden" }} className="leaflet-drag-target">
      {/* MAP CANVAS VIEWPORT */}
      <div 
        ref={mapContainerRef} 
        style={{ width: "100%", height: "100%", background: "#0b0f19" }} 
      />

      {/* LIVING HUD ENVIRONMENTAL CANVAS OVERLAYS */}
      <div className="environmental-hud-overlay">
        
        {/* A. TEMPERATURE GRADIENT WASH */}
        <div 
          className="temp-wash-layer" 
          style={{ 
            backgroundColor: tempWashColor,
            opacity: tempOpacity,
            position: "absolute",
            width: "100%",
            height: "100%",
            pointerEvents: "none",
            mixBlendMode: "color-burn",
            transition: "all 1.5s ease"
          }} 
        />

        {/* B. VELOCITY-SYNCED WIND PARTICLE VECTOR STREAMS (SVG) */}
        <svg 
          className="wind-stream-svg" 
          style={{ 
            position: "absolute",
            width: "100%",
            height: "100%",
            pointerEvents: "none",
            transform: `rotate(${(ambientWindDir + 90) % 360}deg)`,
            opacity: weatherResults.length > 0 ? Math.min(0.40, 0.08 + (ambientWindSpeed / 45)) : 0.08,
            transition: "opacity 1.2s ease, transform 1.2s ease"
          }}
        >
          <g>
            <path className={`wind-stream-line ${isHighGust ? "gusting" : ""}`} style={{ animationDuration: windAnimDuration }} d="M -100,100 L 2000,100" />
            <path className={`wind-stream-line ${isHighGust ? "gusting" : ""}`} style={{ animationDuration: windAnimDuration, animationDelay: "1.5s" }} d="M -100,250 L 2000,250" />
            <path className={`wind-stream-line ${isHighGust ? "gusting" : ""}`} style={{ animationDuration: windAnimDuration, animationDelay: "3.2s" }} d="M -100,450 L 2000,450" />
            <path className={`wind-stream-line ${isHighGust ? "gusting" : ""}`} style={{ animationDuration: windAnimDuration, animationDelay: "0.5s" }} d="M -100,600 L 2000,600" />
            <path className={`wind-stream-line ${isHighGust ? "gusting" : ""}`} style={{ animationDuration: windAnimDuration, animationDelay: "2.1s" }} d="M -100,750 L 2000,750" />
            <path className={`wind-stream-line ${isHighGust ? "gusting" : ""}`} style={{ animationDuration: windAnimDuration, animationDelay: "4s" }} d="M -100,900 L 2000,900" />
          </g>
        </svg>

        {/* C. ATMOSPHERIC CASCADING RAIN SHADERS */}
        <div 
          className="rain-overlay-container" 
          style={{ 
            position: "absolute",
            width: "120%",
            height: "100%",
            pointerEvents: "none",
            opacity: weatherResults.length > 0 ? ambientRain / 100 : 0 
          }}
        >
          {Array.from({ length: 25 }).map((_, i) => {
            const leftVal = `${(i * 4.8) + (Math.random() * 1.5)}%`;
            const delayVal = `${Math.random() * 1.8}s`;
            const durationVal = `${0.7 + Math.random() * 0.5}s`;
            // Calculate precipitation falling tilt angle based on wind speed/direction
            const windTilt = Math.min(25, ambientWindSpeed * 0.8) * (Math.sin(ambientWindDir * Math.PI / 180) > 0 ? -1 : 1);

            return (
              <div 
                key={i}
                className="rain-streak"
                style={{
                  left: leftVal,
                  top: "-100px",
                  animationDelay: delayVal,
                  animationDuration: durationVal,
                  transform: `rotate(${windTilt}deg)`
                }}
              />
            );
          })}
        </div>

        {/* RIGHT SIDEBAR MAP HUD TOOLBAR */}
        <div 
          style={{ 
            position: "absolute", 
            right: "20px", 
            top: "50%", 
            transform: "translateY(-50%)", 
            display: "flex", 
            flexDirection: "column", 
            gap: "12px", 
            zIndex: 9999,
            pointerEvents: "none"
          }}
        >
          {/* A. Location Jump Button */}
          <button
            onClick={handleJumpToGPS}
            className="hud-bubble"
            style={{
              width: "42px",
              height: "42px",
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              padding: 0,
              background: "rgba(15, 23, 42, 0.85)",
              border: "1px solid var(--hud-border)",
              backdropFilter: "blur(10px) saturate(180%)",
              WebkitBackdropFilter: "blur(10px) saturate(180%)",
              boxShadow: "0 8px 32px 0 rgba(0, 0, 0, 0.3)",
              pointerEvents: "auto",
              transition: "all var(--duration-fluid) var(--ease-premium)"
            }}
            title="Recenter to GPS Location"
          >
            <Navigation size={18} style={{ color: "var(--hud-text-primary)" }} />
          </button>

          {/* B. Route Recenter / Wind Compass Rose Button */}
          <button
            onClick={handleRecenterRoute}
            className="hud-bubble"
            style={{
              width: "42px",
              height: "42px",
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              padding: 0,
              background: "rgba(15, 23, 42, 0.85)",
              border: "1px solid var(--hud-border)",
              backdropFilter: "blur(10px) saturate(180%)",
              WebkitBackdropFilter: "blur(10px) saturate(180%)",
              boxShadow: "0 8px 32px 0 rgba(0, 0, 0, 0.3)",
              pointerEvents: "auto",
              position: "relative",
              transition: "all var(--duration-fluid) var(--ease-premium)"
            }}
            title={coordinates.length > 0 ? "Fit Map to Route" : "Re-center Map"}
          >
            <span 
              style={{ 
                position: "absolute", 
                top: "2.5px", 
                left: "50%", 
                transform: "translateX(-50%)", 
                fontSize: "7.5px", 
                fontWeight: "900", 
                color: "var(--color-emerald)", 
                textShadow: "0 0 4px var(--color-emerald-glow)",
                fontFamily: "var(--font-heading)" 
              }}
            >
              N
            </span>
            <Compass 
              size={18} 
              style={{ 
                transform: "rotate(-45deg)", 
                transition: "transform 1.2s var(--ease-premium)", 
                color: "var(--color-emerald)",
                marginTop: "4px"
              }} 
            />
          </button>
        </div>

      </div>
    </div>
  );
}

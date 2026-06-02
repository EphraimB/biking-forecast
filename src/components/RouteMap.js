"use client";

import React, { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import { Compass, Navigation } from "lucide-react";
import { renderToStaticMarkup } from "react-dom/server";
import styles from "./RouteMap.module.css";
import WindStreams from "./svgs/WindStreams";
import RouteMapTooltip from "./RouteMapTooltip";

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
  userLocation = null,
  ambientWeatherForecast = null,
  onMapMove = null
}) {
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const layersRef = useRef({ polylines: [], markers: [], telemetries: [], weatherOverlays: [] });
  const lastFittedRouteRef = useRef("");

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

        if (!L.Browser.touch) {
          L.control.zoom({
            position: "bottomright"
          }).addTo(map);
        }

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

        map.on("moveend", () => {
          const center = map.getCenter();
          if (onMapMove) {
            onMapMove({ lat: center.lat, lon: center.lng });
          }
        });
      }
    };

    initMap();
  }, [onMapClick, onMapMove]);

  // 2. Render Route, Dynamic Markers, and Telemetry Pins (💧, 🍌)
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    const map = mapInstanceRef.current;
    
    if (!coordinates || coordinates.length === 0) {
      lastFittedRouteRef.current = "";
    }
    
    // Clear old layers
    layersRef.current.polylines.forEach(p => p.remove());
    layersRef.current.polylines = [];
    layersRef.current.markers.forEach(m => m.remove());
    layersRef.current.markers = [];
    layersRef.current.telemetries.forEach(t => t.remove());
    layersRef.current.telemetries = [];
    if (layersRef.current.weatherOverlays) {
      layersRef.current.weatherOverlays.forEach(w => w.remove());
    }
    layersRef.current.weatherOverlays = [];

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
        let lastHydrationDistance = 0;
        let lastNutritionDistance = 0;

        routeSegments.forEach((seg, idx) => {
          const sampleIdx = Math.min(Math.floor((idx / routeSegments.length) * numSamples), numSamples - 1);
          const hourly = weatherResults[sampleIdx]?.hourly;
          
          const windSpeed = hourly?.wind_speed_10m?.[currentHourIdx] ?? 0;
          const windDir = hourly?.wind_direction_10m?.[currentHourIdx] ?? 0;
          const tempVal = hourly?.temperature_2m?.[currentHourIdx] ?? 20;
          
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

          // Bind Tooltip: dynamically serialize the RouteMapTooltip React node directly for Leaflet
          const tooltipHtml = renderToStaticMarkup(
            <RouteMapTooltip 
              difficulty={difficulty}
              color={color}
              displayDist={displayDist}
              displaySpeed={displaySpeed}
              speedPercent={speedPercent}
              bearing={seg.bearing}
              windDir={windDir}
              displayWind={displayWind}
              windCompass={getWindCompass(windDir)}
              displayHeadwind={displayHeadwind}
            />
          );

          if (!L.Browser.touch) {
            hoverPoly.bindTooltip(tooltipHtml, { 
              sticky: true,
              className: "leaflet-tooltip" 
            });
          }

          hoverPoly.bindPopup(tooltipHtml, {
            className: "leaflet-popup-segment"
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
          const isThreeQuarterPointSegment = idx === Math.floor(routeSegments.length * 0.75);

          // A. Hydration Pin (💧) - Dynamic intervals matching commute length
          const hydrationInterval = tempVal > 27 ? 5 : 8; // Hot segments: 5km, Standard: 8km
          const meetsHydrationInterval = (accumulatedDistance - lastHydrationDistance >= hydrationInterval);
          const isDefaultMidpointHyd = isMidPointSegment && lastHydrationDistance === 0;

          if (meetsHydrationInterval || isDefaultMidpointHyd) {
            lastHydrationDistance = accumulatedDistance;
            const waterAmount = isImperial ? "12 fl oz" : "350 ml";
            const whyText = tempVal > 27 
              ? `Extreme heat detected (${tempVal.toFixed(1)}°C / ${(tempVal * 1.8 + 32).toFixed(0)}°F). Sweating rates are elevated.`
              : `Commute exertion depletion checkpoint.`;
            const displayCheckpointDist = isImperial 
              ? `${(accumulatedDistance * 0.621371).toFixed(1)} mi` 
              : `${accumulatedDistance.toFixed(1)} km`;

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
                  Drink <strong>${waterAmount}</strong> of fluid at this coordinate (${displayCheckpointDist}).
                </div>
              </div>
            `);

            layersRef.current.telemetries.push(hydMarker);
          }

          // B. Nutrition Pin (🍌) - Dynamic intervals matching commute length
          const nutritionInterval = headwind > 12 ? 12 : 16; // Wind struggle: 12km, Standard: 16km
          const meetsNutritionInterval = (accumulatedDistance - lastNutritionDistance >= nutritionInterval);
          const isDefaultMidpointNut = isThreeQuarterPointSegment && lastNutritionDistance === 0;

          if (meetsNutritionInterval || isDefaultMidpointNut) {
            lastNutritionDistance = accumulatedDistance;
            const carbAmount = "30g Carbs (120 kcal)";
            const whyText = headwind > 12 
              ? `Heavy wind resistance active (${displayHeadwind}). Energy burning rate is increased by 35%.`
              : `Long-distance muscle glycogen depletion check.`;
            const displayCheckpointDist = isImperial 
              ? `${(accumulatedDistance * 0.621371).toFixed(1)} mi` 
              : `${accumulatedDistance.toFixed(1)} km`;

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
                  Consume <strong>${carbAmount}</strong> to fuel through this segment (${displayCheckpointDist}).
                </div>
              </div>
            `);

            layersRef.current.telemetries.push(nutMarker);
          }
        });

        const coordsSerialized = JSON.stringify(coordinates);
        if (lastFittedRouteRef.current !== coordsSerialized) {
          lastFittedRouteRef.current = coordsSerialized;
          const bounds = L.latLngBounds(coordinates);
          map.fitBounds(bounds, { padding: [80, 80] });
        }
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

      // Draw user's current GPS location marker (pulsing blue circle)
      if (userLocation && userLocation.lat && userLocation.lon) {
        const gpsIcon = L.divIcon({
          className: "",
          html: `
            <div style="position: relative; width: 14px; height: 14px;">
              <div class="marker-ripple" style="width: 14px; height: 14px; background: rgba(59, 130, 246, 0.45); box-shadow: 0 0 8px rgba(59, 130, 246, 0.6);"></div>
              <div style="position: absolute; width: 14px; height: 14px; background: #3b82f6; border: 2px solid white; border-radius: 50%; box-shadow: 0 0 10px rgba(59, 130, 246, 0.8); top: 0; left: 0;"></div>
            </div>
          `,
          iconSize: [14, 14],
          iconAnchor: [7, 7]
        });
        const gpsMarker = L.marker([userLocation.lat, userLocation.lon], { icon: gpsIcon }).addTo(map);
        layersRef.current.markers.push(gpsMarker);
      }

    });

  }, [coordinates, startLocation, endLocation, routeSegments, weatherResults, selectedDay, selectedHour, unitSystem, hudState, customSpeed, userLocation]);

  // Synchronously compute derived environmental metrics in render (avoiding useEffect cascading triggers)
  const getAmbientWeatherMetrics = () => {
    if (!ambientWeatherForecast) {
      return { temp: 20, rain: 0, windSpeed: 10, windDir: 0, gusts: 0 };
    }
    const hourly = ambientWeatherForecast.hourly;
    if (!hourly) {
      return { temp: 20, rain: 0, windSpeed: 10, windDir: 0, gusts: 0 };
    }

    let currentHourIdx;
    if (hudState === 3) {
      currentHourIdx = selectedDay * 24 + selectedHour;
    } else {
      const now = new Date();
      const year = now.getFullYear();
      const month = (now.getMonth() + 1).toString().padStart(2, "0");
      const date = now.getDate().toString().padStart(2, "0");
      const hour = now.getHours().toString().padStart(2, "0");
      const currentHourStr = `${year}-${month}-${date}T${hour}:00`;
      
      let matchedIdx = hourly.time?.indexOf(currentHourStr);
      if (matchedIdx === -1 || matchedIdx === undefined) {
        matchedIdx = now.getHours();
      }
      currentHourIdx = matchedIdx;
    }

    return {
      temp: hourly.temperature_2m?.[currentHourIdx] ?? 20,
      rain: hourly.precipitation_probability?.[currentHourIdx] ?? 0,
      windSpeed: hourly.wind_speed_10m?.[currentHourIdx] ?? 10,
      windDir: hourly.wind_direction_10m?.[currentHourIdx] ?? 0,
      gusts: hourly.wind_gusts_10m?.[currentHourIdx] ?? 0
    };
  };

  const metrics = getAmbientWeatherMetrics();
  const ambientTemp = metrics.temp;
  const ambientRain = metrics.rain;
  const ambientWindSpeed = metrics.windSpeed;
  const ambientWindDir = metrics.windDir;
  const ambientGusts = metrics.gusts;

  const showGlobalOverlays = true;

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

  const finalTempOpacity = showGlobalOverlays ? tempOpacity : 0;

  // Adjust wind flow animation rate based on wind speed
  const windAnimDuration = Math.max(1.5, 10 - (ambientWindSpeed / 4)) + "s";
  const isHighGust = ambientGusts > 30; // 30km/h gust threshold

  return (
    <div className={`leaflet-drag-target ${styles.mapContainer}`}>
      {/* MAP CANVAS VIEWPORT */}
      <div 
        ref={mapContainerRef} 
        className={styles.mapCanvas}
      />

      {/* LIVING HUD ENVIRONMENTAL CANVAS OVERLAYS */}
      <div className="environmental-hud-overlay">
        
        {/* A. TEMPERATURE GRADIENT WASH */}
        <div 
          className={styles.tempWashLayer} 
          style={{ 
            backgroundColor: tempWashColor,
            opacity: finalTempOpacity
          }} 
        />

        {/* B. VELOCITY-SYNCED WIND PARTICLE VECTOR STREAMS (SVG component extracted) */}
        <WindStreams 
          ambientWindDir={ambientWindDir}
          ambientWindSpeed={ambientWindSpeed}
          weatherResultsLength={showGlobalOverlays ? weatherResults.length : 0}
          isHighGust={isHighGust}
          windAnimDuration={windAnimDuration}
          svgClassName="wind-stream-svg"
          lineClassName="wind-stream-line"
        />

        {/* C. ATMOSPHERIC CASCADING RAIN SHADERS */}
        <div 
          className="rain-overlay-container" 
          style={{ 
            position: "absolute",
            width: "120%",
            height: "100%",
            pointerEvents: "none",
            opacity: (showGlobalOverlays && weatherResults.length > 0) ? ambientRain / 100 : 0 
          }}
        >
          {Array.from({ length: 25 }).map((_, i) => {
            // Use deterministic index-seeded values to ensure pure rendering and satisfy ESLint purity checks
            const getDeterministicRandom = (index, seed) => {
              const val = Math.sin(index + seed) * 10000;
              return val - Math.floor(val);
            };

            const r1 = getDeterministicRandom(i, 1.5);
            const r2 = getDeterministicRandom(i, 3.8);
            const r3 = getDeterministicRandom(i, 7.2);

            const leftVal = `${(i * 4.8) + (r1 * 1.5)}%`;
            const delayVal = `${r2 * 1.8}s`;
            const durationVal = `${0.7 + r3 * 0.5}s`;
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
        <div className={styles.rightToolbar}>
          {/* A. Location Jump Button */}
          <button
            onClick={handleJumpToGPS}
            className={styles.toolbarBtn}
            title="Recenter to GPS Location"
          >
            <Navigation size={18} style={{ color: "var(--hud-text-primary)" }} />
          </button>

          {/* B. Route Recenter / Wind Compass Rose Button */}
          <button
            onClick={handleRecenterRoute}
            className={styles.toolbarBtn}
            style={{ position: "relative" }}
            title={coordinates.length > 0 ? "Fit Map to Route" : "Re-center Map"}
          >
            <span className={styles.compassNorth}>
              N
            </span>
            <Compass 
              size={18} 
              className={styles.compassIcon}
              style={{ 
                transform: "rotate(-45deg)", 
                transition: "transform 1.2s var(--ease-premium)"
              }} 
            />
          </button>
        </div>

      </div>
    </div>
  );
}

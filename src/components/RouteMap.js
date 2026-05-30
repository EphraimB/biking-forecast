"use client";

import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";

/**
 * Client-side Leaflet component that renders the bike routing and weather points.
 */
export default function RouteMap({ coordinates = [], startLocation = null, endLocation = null, sampledCoords = [] }) {
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const layersRef = useRef({ polylineGroup: null, markers: [] });

  useEffect(() => {
    let L;
    let mapInstance;

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

      // 1. Create Leaflet Map Instance if not already created
      if (!mapInstanceRef.current) {
        mapInstance = L.map(mapContainerRef.current, {
          zoomControl: true,
          scrollWheelZoom: true
        }).setView([40.7128, -74.0060], 12);
        
        // CartoDB Dark Matter tiles provide an ultra-premium dark aesthetic
        L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
          subdomains: "abcd",
          maxZoom: 20
        }).addTo(mapInstance);
        
        mapInstanceRef.current = mapInstance;
      } else {
        mapInstance = mapInstanceRef.current;
      }

      // 2. Clear old layers to prevent overlap
      if (layersRef.current.polylineGroup) {
        layersRef.current.polylineGroup.remove();
        layersRef.current.polylineGroup = null;
      }
      layersRef.current.markers.forEach(m => m.remove());
      layersRef.current.markers = [];

      // 3. Render Route and Markers if coordinates exist
      if (coordinates && coordinates.length > 0) {
        const polyline = L.polyline(coordinates, {
          color: "#6366f1", // Indigo core
          weight: 4,
          opacity: 0.9,
          lineJoin: "round"
        });
        
        const polylineGlow = L.polyline(coordinates, {
          color: "#6366f1", // Indigo outer glow
          weight: 8,
          opacity: 0.25,
          lineJoin: "round"
        });
        
        layersRef.current.polylineGroup = L.layerGroup([polylineGlow, polyline]).addTo(mapInstance);
        
        // Render Start point marker
        if (startLocation && coordinates[0]) {
          const startIcon = L.divIcon({
            className: "custom-marker-start",
            iconSize: [16, 16],
            popupAnchor: [0, -8]
          });
          const startMarker = L.marker(coordinates[0], { icon: startIcon })
            .bindPopup(`<strong>Start Location</strong><br/><span style="font-size:12px;color:#94a3b8;">${startLocation.label}</span>`)
            .addTo(mapInstance);
          layersRef.current.markers.push(startMarker);
        }
        
        // Render End point marker
        if (endLocation && coordinates[coordinates.length - 1]) {
          const endIcon = L.divIcon({
            className: "custom-marker-end",
            iconSize: [16, 16],
            popupAnchor: [0, -8]
          });
          const endMarker = L.marker(coordinates[coordinates.length - 1], { icon: endIcon })
            .bindPopup(`<strong>Destination</strong><br/><span style="font-size:12px;color:#94a3b8;">${endLocation.label}</span>`)
            .addTo(mapInstance);
          layersRef.current.markers.push(endMarker);
        }
        
        // Render dynamic weather sample points (Start, Mid, End, etc.)
        if (sampledCoords && sampledCoords.length > 2) {
          sampledCoords.forEach((coord, idx) => {
            // Skip start and end since they are already covered by large custom markers
            if (idx === 0 || idx === sampledCoords.length - 1) return;
            
            const midIcon = L.divIcon({
              className: "custom-marker-mid",
              iconSize: [12, 12],
              popupAnchor: [0, -6]
            });
            const label = sampledCoords.length === 3 
              ? "Midpoint Weather Station" 
              : `Weather Sample Station #${idx}`;
            
            const midMarker = L.marker(coord, { icon: midIcon })
              .bindPopup(`<strong>${label}</strong><br/><span style="font-size:12px;color:#cbd5e1;">Lat: ${coord[0].toFixed(4)}, Lon: ${coord[1].toFixed(4)}</span>`)
              .addTo(mapInstance);
            layersRef.current.markers.push(midMarker);
          });
        }

        // Fit bounds with padding so the route is nicely framed
        const bounds = L.latLngBounds(coordinates);
        mapInstance.fitBounds(bounds, { padding: [40, 40] });
      } else {
        // Fallback view centered on a nice default if empty (New York)
        mapInstance.setView([40.7128, -74.0060], 11);
      }
    };

    initMap();
    
    // Trigger Map Reflow on render to handle hidden parents
    setTimeout(() => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.invalidateSize();
      }
    }, 100);

    return () => {
      // Keep instance intact across minor updates, but clear layers.
    };
  }, [coordinates, startLocation, endLocation, sampledCoords]);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", minHeight: "350px", overflow: "hidden", borderRadius: "12px" }}>
      <div 
        ref={mapContainerRef} 
        style={{ width: "100%", height: "100%", minHeight: "350px", background: "#070a13" }} 
      />
    </div>
  );
}

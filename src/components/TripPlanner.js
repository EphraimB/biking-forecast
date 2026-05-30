"use client";

import { useState, useEffect } from "react";
import { Search, MapPin, Bike, Calendar, Clock, Plus, Trash2, Navigation, Settings2 } from "lucide-react";
import { geocodeAddress } from "@/utils/api";

const BIKE_TYPES = [
  { id: "Road", name: "Road Bike", speed: 24, icon: "🚴" },
  { id: "Hybrid", name: "Hybrid / Commuter", speed: 18, icon: "🚲" },
  { id: "Mountain", name: "Mountain Bike", speed: 16, icon: "🚵" },
  { id: "Cargo", name: "Cargo / Heavy", speed: 14, icon: "🚲" },
  { id: "E-Bike", name: "Electric Bike", speed: 25, icon: "⚡" }
];

export default function TripPlanner({
  startLocation,
  setStartLocation,
  endLocation,
  setEndLocation,
  bikeType,
  setBikeType,
  customSpeed,
  setCustomSpeed,
  onCalculate,
  isLoading,
  arrivalDate,
  setArrivalDate,
  arrivalTime,
  setArrivalTime,
  isArrivalMode,
  setIsArrivalMode,
  arrivalCalculationResult
}) {
  const [startQuery, setStartQuery] = useState("");
  const [endQuery, setEndQuery] = useState("");
  const [startResults, setStartResults] = useState([]);
  const [endResults, setEndResults] = useState([]);
  const [isSearchingStart, setIsSearchingStart] = useState(false);
  const [isSearchingEnd, setIsSearchingEnd] = useState(false);
  const [savedProfiles, setSavedProfiles] = useState([]);
  const [newProfileName, setNewProfileName] = useState("");
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  // Sync inputs with state on load/update
  useEffect(() => {
    if (startLocation) setStartQuery(startLocation.label);
  }, [startLocation]);

  useEffect(() => {
    if (endLocation) setEndQuery(endLocation.label);
  }, [endLocation]);

  // Load profiles from localStorage
  useEffect(() => {
    const saved = localStorage.getItem("biking_profiles");
    if (saved) {
      try {
        setSavedProfiles(JSON.parse(saved));
      } catch (e) {
        console.error(e);
      }
    }
  }, []);

  const searchLocation = async (query, isStart) => {
    if (isStart) {
      if (query.trim().length < 3) return;
      setIsSearchingStart(true);
      const res = await geocodeAddress(query);
      setStartResults(res);
      setIsSearchingStart(false);
    } else {
      if (query.trim().length < 3) return;
      setIsSearchingEnd(true);
      const res = await geocodeAddress(query);
      setEndResults(res);
      setIsSearchingEnd(false);
    }
  };

  const useCurrentLocation = (isStart) => {
    if (!navigator.geolocation) {
      alert("Geolocation is not supported by your browser");
      return;
    }
    
    const targetSet = isStart ? setIsSearchingStart : setIsSearchingEnd;
    targetSet(true);

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;
        const mockLabel = `Current Location (${latitude.toFixed(4)}, ${longitude.toFixed(4)})`;
        const loc = { lat: latitude, lon: longitude, label: mockLabel };
        
        if (isStart) {
          setStartLocation(loc);
          setStartQuery(mockLabel);
          setStartResults([]);
        } else {
          setEndLocation(loc);
          setEndQuery(mockLabel);
          setEndResults([]);
        }
        targetSet(false);
      },
      (error) => {
        console.error(error);
        alert("Failed to retrieve location: " + error.message);
        targetSet(false);
      }
    );
  };

  const handleSelectLocation = (loc, isStart) => {
    if (isStart) {
      setStartLocation(loc);
      setStartQuery(loc.label);
      setStartResults([]);
    } else {
      setEndLocation(loc);
      setEndQuery(loc.label);
      setEndResults([]);
    }
  };

  const saveProfile = () => {
    if (!startLocation || !endLocation || !newProfileName.trim()) return;

    const newProfile = {
      id: Date.now().toString(),
      name: newProfileName.trim(),
      startLocation,
      endLocation,
      bikeType,
      customSpeed
    };

    const updated = [...savedProfiles, newProfile];
    setSavedProfiles(updated);
    localStorage.setItem("biking_profiles", JSON.stringify(updated));
    setNewProfileName("");
    setShowSaveModal(false);
  };

  const loadProfile = (prof) => {
    setStartLocation(prof.startLocation);
    setStartQuery(prof.startLocation.label);
    setEndLocation(prof.endLocation);
    setEndQuery(prof.endLocation.label);
    setBikeType(prof.bikeType);
    
    // Fallback if customSpeed isn't saved
    const defSpeed = BIKE_TYPES.find(b => b.id === prof.bikeType)?.speed || 18;
    setCustomSpeed(prof.customSpeed || defSpeed);
  };

  const deleteProfile = (id, e) => {
    e.stopPropagation(); // Avoid loading profile when deleting
    const updated = savedProfiles.filter(p => p.id !== id);
    setSavedProfiles(updated);
    localStorage.setItem("biking_profiles", JSON.stringify(updated));
  };

  const handleBikeTypeChange = (typeId) => {
    setBikeType(typeId);
    const defSpeed = BIKE_TYPES.find(b => b.id === typeId)?.speed || 18;
    setCustomSpeed(defSpeed);
  };

  // Get default dates (today to +6 days)
  const getTodayDateStr = () => {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, "0");
    const dd = String(today.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  };

  return (
    <div className="glass-panel" style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ fontSize: "1.25rem", fontWeight: "700", display: "flex", alignItems: "center", gap: "8px" }}>
          <Settings2 size={20} style={{ color: "var(--primary)" }} /> Route Planner
        </h2>
        
        {/* Saved Profiles dropdown list */}
        {savedProfiles.length > 0 && (
          <div style={{ position: "relative" }}>
            <select
              onChange={(e) => {
                const selected = savedProfiles.find(p => p.id === e.target.value);
                if (selected) loadProfile(selected);
              }}
              defaultValue=""
              style={{
                background: "rgba(15, 23, 42, 0.6)",
                border: "1px solid var(--card-border)",
                color: "var(--foreground)",
                borderRadius: "8px",
                padding: "6px 12px",
                fontSize: "0.85rem",
                outline: "none",
                cursor: "pointer"
              }}
            >
              <option value="" disabled>Saved Commutes...</option>
              {savedProfiles.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Start Location Search input */}
      <div style={{ display: "flex", flexDirection: "column", gap: "6px", position: "relative" }}>
        <label style={{ fontSize: "0.8rem", color: "var(--slate-400)", fontWeight: "600" }}>Start Location</label>
        <div style={{ display: "flex", gap: "8px" }}>
          <div style={{ position: "relative", flexGrow: "1" }}>
            <input
              type="text"
              value={startQuery}
              onChange={(e) => setStartQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && searchLocation(startQuery, true)}
              placeholder="Search start address..."
              style={{
                width: "100%",
                padding: "10px 36px 10px 12px",
                borderRadius: "8px",
                background: "rgba(15, 23, 42, 0.4)",
                border: "1px solid var(--card-border)",
                color: "var(--foreground)",
                outline: "none",
                fontSize: "0.9rem"
              }}
            />
            <Search size={16} style={{ position: "absolute", right: "12px", top: "12px", color: "var(--slate-500)" }} />
          </div>
          <button
            onClick={() => useCurrentLocation(true)}
            style={{
              padding: "10px",
              background: "rgba(99, 102, 241, 0.1)",
              border: "1px solid rgba(99, 102, 241, 0.2)",
              borderRadius: "8px",
              color: "var(--primary)",
              cursor: "pointer"
            }}
            title="Use current location"
          >
            <Navigation size={18} />
          </button>
        </div>

        {/* Start Results dropdown */}
        {startResults.length > 0 && (
          <div style={{
            position: "absolute",
            top: "70px",
            left: "0",
            right: "0",
            background: "#0f172a",
            border: "1px solid var(--slate-700)",
            borderRadius: "8px",
            zIndex: "999",
            maxHeight: "200px",
            overflowY: "auto",
            boxShadow: "0 10px 25px rgba(0,0,0,0.5)"
          }}>
            {startResults.map((res, i) => (
              <div
                key={i}
                onClick={() => handleSelectLocation(res, true)}
                style={{
                  padding: "10px 12px",
                  borderBottom: i < startResults.length - 1 ? "1px solid var(--slate-800)" : "none",
                  cursor: "pointer",
                  fontSize: "0.85rem",
                  transition: "background 0.2s"
                }}
                onMouseEnter={(e) => e.target.style.background = "#1e293b"}
                onMouseLeave={(e) => e.target.style.background = "transparent"}
              >
                <MapPin size={14} style={{ marginRight: "6px", display: "inline", verticalAlign: "middle", color: "var(--primary)" }} />
                {res.label}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* End Location Search input */}
      <div style={{ display: "flex", flexDirection: "column", gap: "6px", position: "relative" }}>
        <label style={{ fontSize: "0.8rem", color: "var(--slate-400)", fontWeight: "600" }}>Destination</label>
        <div style={{ display: "flex", gap: "8px" }}>
          <div style={{ position: "relative", flexGrow: "1" }}>
            <input
              type="text"
              value={endQuery}
              onChange={(e) => setEndQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && searchLocation(endQuery, false)}
              placeholder="Search destination address..."
              style={{
                width: "100%",
                padding: "10px 36px 10px 12px",
                borderRadius: "8px",
                background: "rgba(15, 23, 42, 0.4)",
                border: "1px solid var(--card-border)",
                color: "var(--foreground)",
                outline: "none",
                fontSize: "0.9rem"
              }}
            />
            <Search size={16} style={{ position: "absolute", right: "12px", top: "12px", color: "var(--slate-500)" }} />
          </div>
          <button
            onClick={() => useCurrentLocation(false)}
            style={{
              padding: "10px",
              background: "rgba(239, 68, 68, 0.1)",
              border: "1px solid rgba(239, 68, 68, 0.2)",
              borderRadius: "8px",
              color: "var(--rose)",
              cursor: "pointer"
            }}
            title="Use current location"
          >
            <Navigation size={18} />
          </button>
        </div>

        {/* End Results dropdown */}
        {endResults.length > 0 && (
          <div style={{
            position: "absolute",
            top: "70px",
            left: "0",
            right: "0",
            background: "#0f172a",
            border: "1px solid var(--slate-700)",
            borderRadius: "8px",
            zIndex: "999",
            maxHeight: "200px",
            overflowY: "auto",
            boxShadow: "0 10px 25px rgba(0,0,0,0.5)"
          }}>
            {endResults.map((res, i) => (
              <div
                key={i}
                onClick={() => handleSelectLocation(res, false)}
                style={{
                  padding: "10px 12px",
                  borderBottom: i < endResults.length - 1 ? "1px solid var(--slate-800)" : "none",
                  cursor: "pointer",
                  fontSize: "0.85rem",
                  transition: "background 0.2s"
                }}
                onMouseEnter={(e) => e.target.style.background = "#1e293b"}
                onMouseLeave={(e) => e.target.style.background = "transparent"}
              >
                <MapPin size={14} style={{ marginRight: "6px", display: "inline", verticalAlign: "middle", color: "var(--rose)" }} />
                {res.label}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Bicycle Profile Selector */}
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        <label style={{ fontSize: "0.8rem", color: "var(--slate-400)", fontWeight: "600" }}>Biking Preference</label>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "6px" }}>
          {BIKE_TYPES.map((b) => (
            <button
              key={b.id}
              onClick={() => handleBikeTypeChange(b.id)}
              style={{
                padding: "8px 4px",
                background: bikeType === b.id ? "rgba(99, 102, 241, 0.2)" : "rgba(15, 23, 42, 0.3)",
                border: bikeType === b.id ? "1px solid var(--primary)" : "1px solid var(--card-border)",
                borderRadius: "8px",
                color: bikeType === b.id ? "white" : "var(--slate-300)",
                fontSize: "0.75rem",
                fontWeight: "600",
                cursor: "pointer",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: "4px",
                transition: "all 0.2s"
              }}
            >
              <span style={{ fontSize: "1.2rem" }}>{b.icon}</span>
              <span style={{ textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap", width: "100%" }}>{b.name.split(" ")[0]}</span>
            </button>
          ))}
        </div>
        
        {/* Custom speed overrides */}
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginTop: "4px" }}>
          <label style={{ fontSize: "0.75rem", color: "var(--slate-500)" }}>Base Riding Speed:</label>
          <input
            type="number"
            value={customSpeed}
            onChange={(e) => setCustomSpeed(parseFloat(e.target.value) || 10)}
            style={{
              width: "60px",
              padding: "4px 8px",
              borderRadius: "6px",
              background: "rgba(15, 23, 42, 0.4)",
              border: "1px solid var(--card-border)",
              color: "white",
              textAlign: "center",
              fontSize: "0.8rem",
              outline: "none"
            }}
          />
          <span style={{ fontSize: "0.75rem", color: "var(--slate-500)" }}>km/h</span>
        </div>
      </div>

      {/* Arrival Time Input Controls */}
      <div className="glass-card" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <label style={{ fontSize: "0.8rem", color: "white", fontWeight: "700", display: "flex", alignItems: "center", gap: "6px" }}>
            <Calendar size={14} style={{ color: "var(--primary)" }} /> Plan by Arrival Time
          </label>
          <input
            type="checkbox"
            checked={isArrivalMode}
            onChange={(e) => setIsArrivalMode(e.target.checked)}
            style={{ cursor: "pointer", width: "16px", height: "16px" }}
          />
        </div>

        {isArrivalMode && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", animation: "fadeIn 0.2s" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              <span style={{ fontSize: "0.7rem", color: "var(--slate-400)" }}>Arrival Date</span>
              <input
                type="date"
                value={arrivalDate || getTodayDateStr()}
                onChange={(e) => setArrivalDate(e.target.value)}
                style={{
                  background: "rgba(15, 23, 42, 0.6)",
                  border: "1px solid var(--card-border)",
                  color: "white",
                  padding: "6px",
                  borderRadius: "6px",
                  fontSize: "0.8rem",
                  outline: "none"
                }}
              />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              <span style={{ fontSize: "0.7rem", color: "var(--slate-400)" }}>Desired Arrival Time</span>
              <input
                type="time"
                value={arrivalTime}
                onChange={(e) => setArrivalTime(e.target.value)}
                style={{
                  background: "rgba(15, 23, 42, 0.6)",
                  border: "1px solid var(--card-border)",
                  color: "white",
                  padding: "6px",
                  borderRadius: "6px",
                  fontSize: "0.8rem",
                  outline: "none"
                }}
              />
            </div>
          </div>
        )}
        
        {/* Dynamic calculation results when in Arrival Planning Mode */}
        {isArrivalMode && arrivalCalculationResult && (
          <div style={{
            background: "rgba(99, 102, 241, 0.1)",
            border: "1px solid rgba(99, 102, 241, 0.2)",
            borderRadius: "8px",
            padding: "10px",
            marginTop: "6px",
            fontSize: "0.8rem",
            display: "flex",
            flexDirection: "column",
            gap: "4px"
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontWeight: "600" }}>
              <span style={{ color: "var(--slate-300)" }}>⏰ Suggested Departure:</span>
              <span style={{ color: "white" }}>
                {new Date(arrivalCalculationResult.departureTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--slate-400)" }}>💨 Biking Duration:</span>
              <span>{arrivalCalculationResult.duration} min (Avg {arrivalCalculationResult.speed} km/h)</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--slate-400)" }}>📊 Weather Commute Score:</span>
              <span style={{ 
                fontWeight: "700", 
                color: arrivalCalculationResult.score >= 80 ? "var(--emerald)" : arrivalCalculationResult.score >= 50 ? "var(--amber)" : "var(--rose)" 
              }}>
                {arrivalCalculationResult.score} / 100 ({arrivalCalculationResult.hourDetails?.windImpact})
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Main Trigger buttons */}
      <div style={{ display: "flex", gap: "10px" }}>
        <button
          onClick={onCalculate}
          disabled={isLoading || !startLocation || !endLocation}
          style={{
            flexGrow: "1",
            padding: "12px",
            background: "linear-gradient(135deg, var(--primary), var(--primary-hover))",
            color: "white",
            border: "none",
            borderRadius: "8px",
            fontSize: "0.95rem",
            fontWeight: "700",
            cursor: (!startLocation || !endLocation) ? "not-allowed" : "pointer",
            opacity: (!startLocation || !endLocation || isLoading) ? "0.6" : "1",
            transition: "all 0.2s",
            boxShadow: "0 4px 15px rgba(99, 102, 241, 0.4)"
          }}
        >
          {isLoading ? "Fetching Route & Weather..." : "Calculate Biking Forecast"}
        </button>

        {startLocation && endLocation && (
          <button
            onClick={() => setShowSaveModal(true)}
            style={{
              padding: "12px",
              background: "rgba(255, 255, 255, 0.05)",
              border: "1px solid var(--card-border)",
              borderRadius: "8px",
              color: "white",
              cursor: "pointer",
              transition: "background 0.2s"
            }}
            title="Save commute profile"
          >
            <Plus size={18} />
          </button>
        )}
      </div>

      {/* Save Route Profile Modal */}
      {showSaveModal && (
        <div style={{
          position: "fixed",
          top: "0",
          left: "0",
          right: "0",
          bottom: "0",
          background: "rgba(0,0,0,0.8)",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          zIndex: "1000",
          backdropFilter: "blur(4px)"
        }}>
          <div className="glass-panel" style={{ width: "90%", maxWidth: "400px", padding: "20px", display: "flex", flexDirection: "column", gap: "12px" }}>
            <h3 style={{ fontSize: "1.1rem", fontWeight: "700", color: "white" }}>Save Biking Profile</h3>
            <p style={{ fontSize: "0.8rem", color: "var(--slate-400)" }}>Give this route configuration a name to easily reload it later.</p>
            <input
              type="text"
              placeholder="e.g. Daily Commute to Work"
              value={newProfileName}
              onChange={(e) => setNewProfileName(e.target.value)}
              style={{
                padding: "8px 12px",
                borderRadius: "6px",
                background: "rgba(15, 23, 42, 0.6)",
                border: "1px solid var(--card-border)",
                color: "white",
                outline: "none",
                fontSize: "0.9rem"
              }}
            />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "10px" }}>
              <button
                onClick={() => setShowSaveModal(false)}
                style={{
                  padding: "8px 14px",
                  background: "transparent",
                  border: "1px solid var(--card-border)",
                  borderRadius: "6px",
                  color: "var(--slate-300)",
                  cursor: "pointer",
                  fontSize: "0.85rem"
                }}
              >
                Cancel
              </button>
              <button
                onClick={saveProfile}
                disabled={!newProfileName.trim()}
                style={{
                  padding: "8px 14px",
                  background: "var(--primary)",
                  border: "none",
                  borderRadius: "6px",
                  color: "white",
                  cursor: "pointer",
                  fontWeight: "600",
                  fontSize: "0.85rem"
                }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete saved profiles management inside settings */}
      {savedProfiles.length > 0 && (
        <div style={{ marginTop: "4px" }}>
          <button
            onClick={() => setShowSettings(!showSettings)}
            style={{
              background: "none",
              border: "none",
              color: "var(--slate-500)",
              fontSize: "0.75rem",
              cursor: "pointer",
              textDecoration: "underline",
              display: "block"
            }}
          >
            {showSettings ? "Hide saved profiles list" : "Manage saved profiles list"}
          </button>
          
          {showSettings && (
            <div style={{
              display: "flex",
              flexDirection: "column",
              gap: "6px",
              marginTop: "8px",
              maxHeight: "150px",
              overflowY: "auto",
              padding: "6px",
              border: "1px solid var(--card-border)",
              borderRadius: "6px"
            }}>
              {savedProfiles.map(p => (
                <div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.75rem", padding: "4px" }}>
                  <span style={{ color: "var(--slate-300)" }}>{p.name}</span>
                  <button
                    onClick={(e) => deleteProfile(p.id, e)}
                    style={{
                      background: "none",
                      border: "none",
                      color: "var(--rose)",
                      cursor: "pointer"
                    }}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

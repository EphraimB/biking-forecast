"use client";

import React, { useState, useEffect } from "react";
import { Search, MapPin, Bike, Calendar, Clock, Plus, Trash2, Navigation, Settings2 } from "lucide-react";
import { geocodeAddress } from "@/utils/api";
import styles from "./TripPlanner.module.css";

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
  const [startQuery, setStartQuery] = useState(startLocation?.label || "");
  const [endQuery, setEndQuery] = useState(endLocation?.label || "");
  const [startResults, setStartResults] = useState([]);
  const [endResults, setEndResults] = useState([]);
  const [isSearchingStart, setIsSearchingStart] = useState(false);
  const [isSearchingEnd, setIsSearchingEnd] = useState(false);
  const [newProfileName, setNewProfileName] = useState("");
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  // Lazy state initializer for saved profiles - loads synchronously on first render
  const [savedProfiles, setSavedProfiles] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("biking_profiles");
      if (saved) {
        try {
          return JSON.parse(saved);
        } catch (e) {
          console.error(e);
        }
      }
    }
    return [];
  });

  // Pure state adjustment when props change (avoiding useEffect cascading updates)
  const [prevStartLocation, setPrevStartLocation] = useState(startLocation);
  if (startLocation !== prevStartLocation) {
    setPrevStartLocation(startLocation);
    setStartQuery(startLocation?.label || "");
  }

  const [prevEndLocation, setPrevEndLocation] = useState(endLocation);
  if (endLocation !== prevEndLocation) {
    setPrevEndLocation(endLocation);
    setEndQuery(endLocation?.label || "");
  }

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

  // Renamed to retrieveCurrentLocation to avoid custom hook lint warnings
  const retrieveCurrentLocation = (isStart) => {
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
    <div className={`glass-panel ${styles.plannerContainer}`}>
      <div className={styles.headerRow}>
        <h2 className={styles.titleText}>
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
              className={styles.savedCommutesDropdown}
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
      <div className={styles.searchRow}>
        <label className={styles.formLabel}>Start Location</label>
        <div className={styles.inputGroup}>
          <div className={styles.inputWrapper}>
            <input
              type="text"
              value={startQuery}
              onChange={(e) => setStartQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && searchLocation(startQuery, true)}
              placeholder="Search start address..."
              className={styles.addressInput}
            />
            <Search size={16} className={styles.searchIcon} />
          </div>
          <button
            onClick={() => retrieveCurrentLocation(true)}
            className={styles.gpsButtonStart}
            title="Use current location"
          >
            <Navigation size={18} />
          </button>
        </div>

        {/* Start Results dropdown */}
        {startResults.length > 0 && (
          <div className={styles.searchResultsBox}>
            {startResults.map((res, i) => (
              <div
                key={i}
                onClick={() => handleSelectLocation(res, true)}
                className={styles.searchResultItem}
                style={{ borderBottom: i < startResults.length - 1 ? "1px solid var(--slate-800)" : "none" }}
              >
                <MapPin size={14} className={styles.searchResultIcon} style={{ color: "var(--primary)" }} />
                {res.label}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* End Location Search input */}
      <div className={styles.searchRow}>
        <label className={styles.formLabel}>Destination</label>
        <div className={styles.inputGroup}>
          <div className={styles.inputWrapper}>
            <input
              type="text"
              value={endQuery}
              onChange={(e) => setEndQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && searchLocation(endQuery, false)}
              placeholder="Search destination address..."
              className={styles.addressInput}
            />
            <Search size={16} className={styles.searchIcon} />
          </div>
          <button
            onClick={() => retrieveCurrentLocation(false)}
            className={styles.gpsButtonEnd}
            title="Use current location"
          >
            <Navigation size={18} />
          </button>
        </div>

        {/* End Results dropdown */}
        {endResults.length > 0 && (
          <div className={styles.searchResultsBox}>
            {endResults.map((res, i) => (
              <div
                key={i}
                onClick={() => handleSelectLocation(res, false)}
                className={styles.searchResultItem}
                style={{ borderBottom: i < endResults.length - 1 ? "1px solid var(--slate-800)" : "none" }}
              >
                <MapPin size={14} className={styles.searchResultIcon} style={{ color: "var(--rose)" }} />
                {res.label}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Bicycle Profile Selector */}
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        <label className={styles.formLabel}>Biking Preference</label>
        <div className={styles.bikePreferencesGrid}>
          {BIKE_TYPES.map((b) => {
            const isActive = bikeType === b.id;
            return (
              <button
                key={b.id}
                onClick={() => handleBikeTypeChange(b.id)}
                className={`${styles.bikeButton} ${isActive ? styles.bikeButtonActive : styles.bikeButtonInactive}`}
              >
                <span style={{ fontSize: "1.2rem" }}>{b.icon}</span>
                <span style={{ textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap", width: "100%" }}>{b.name.split(" ")[0]}</span>
              </button>
            );
          })}
        </div>
        
        {/* Custom speed overrides */}
        <div className={styles.speedRow}>
          <label className={styles.speedLabel}>Base Riding Speed:</label>
          <input
            type="number"
            value={customSpeed}
            onChange={(e) => setCustomSpeed(parseFloat(e.target.value) || 10)}
            className={styles.speedInput}
          />
          <span className={styles.speedUnit}>km/h</span>
        </div>
      </div>

      {/* Arrival Time Input Controls */}
      <div className={`glass-card ${styles.arrivalModeCard}`}>
        <div className={styles.arrivalHeaderRow}>
          <label className={styles.arrivalModeLabel}>
            <Calendar size={14} style={{ color: "var(--primary)" }} /> Plan by Arrival Time
          </label>
          <input
            type="checkbox"
            checked={isArrivalMode}
            onChange={(e) => setIsArrivalMode(e.target.checked)}
            className={styles.checkboxInput}
          />
        </div>

        {isArrivalMode && (
          <div className={styles.arrivalDateTimeWrapper}>
            <div className={styles.arrivalInputCol}>
              <span className={styles.fieldLabel}>Arrival Date</span>
              <input
                type="date"
                value={arrivalDate || getTodayDateStr()}
                onChange={(e) => setArrivalDate(e.target.value)}
                className={styles.dateTimeField}
              />
            </div>
            <div className={styles.arrivalInputCol}>
              <span className={styles.fieldLabel}>Desired Arrival Time</span>
              <input
                type="time"
                value={arrivalTime}
                onChange={(e) => setArrivalTime(e.target.value)}
                className={styles.dateTimeField}
              />
            </div>
          </div>
        )}
        
        {/* Dynamic calculation results when in Arrival Planning Mode */}
        {isArrivalMode && arrivalCalculationResult && (
          <div className={styles.arrivalResultBox}>
            <div className={styles.arrivalResultRow} style={{ fontWeight: "600" }}>
              <span style={{ color: "var(--slate-300)" }}>⏰ Suggested Departure:</span>
              <span style={{ color: "white" }}>
                {new Date(arrivalCalculationResult.departureTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
            <div className={styles.arrivalResultRow}>
              <span style={{ color: "var(--slate-400)" }}>💨 Biking Duration:</span>
              <span>{arrivalCalculationResult.duration} min (Avg {arrivalCalculationResult.speed} km/h)</span>
            </div>
            <div className={styles.arrivalResultRow}>
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
      <div className={styles.buttonRow}>
        <button
          onClick={onCalculate}
          disabled={isLoading || !startLocation || !endLocation}
          className={styles.calculateBtn}
        >
          {isLoading ? "Fetching Route & Weather..." : "Calculate Biking Forecast"}
        </button>

        {startLocation && endLocation && (
          <button
            onClick={() => setShowSaveModal(true)}
            className={styles.plusSaveBtn}
            title="Save commute profile"
          >
            <Plus size={18} />
          </button>
        )}
      </div>

      {/* Save Route Profile Modal */}
      {showSaveModal && (
        <div className={styles.modalBackdrop}>
          <div className={`glass-panel ${styles.modalPanel}`}>
            <h3 className={styles.modalTitle}>Save Biking Profile</h3>
            <p className={styles.modalDesc}>Give this route configuration a name to easily reload it later.</p>
            <input
              type="text"
              placeholder="e.g. Daily Commute to Work"
              value={newProfileName}
              onChange={(e) => setNewProfileName(e.target.value)}
              className={styles.modalInput}
            />
            <div className={styles.modalActions}>
              <button
                onClick={() => setShowSaveModal(false)}
                className={styles.modalCancelBtn}
              >
                Cancel
              </button>
              <button
                onClick={saveProfile}
                disabled={!newProfileName.trim()}
                className={styles.modalSaveBtn}
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
            className={styles.manageProfilesBtn}
          >
            {showSettings ? "Hide saved profiles list" : "Manage saved profiles list"}
          </button>
          
          {showSettings && (
            <div className={styles.profilesManagerList}>
              {savedProfiles.map(p => (
                <div key={p.id} className={styles.profileManagerItem}>
                  <span style={{ color: "var(--slate-300)" }}>{p.name}</span>
                  <button
                    onClick={(e) => deleteProfile(p.id, e)}
                    className={styles.deleteProfileBtn}
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

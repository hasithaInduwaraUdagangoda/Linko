
/*
 * LINKO Field – test-message sender (no framework, no build step).
 * Submits to the Supabase project's server-side Edge Function.
 * The publishable key is public.
 * NEVER put a Supabase secret/service-role key here.
 * The hosted tables intentionally deny direct anonymous browser inserts.
 */

const CONFIG = {
  API_BASE_URL: "https://liovshgyuemuvxsreriq.supabase.co/functions/v1/linko-field-intake",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_q7DpPsDHDnWMl8sYnM1dxg_vPAVEzzz",
  GEOCODE_ENDPOINT: "https://nominatim.openstreetmap.org/search",
  MAP_STYLE: "https://tiles.openfreemap.org/styles/liberty",
};

(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);

  const state = {
    map: null,
    maplibre: null,
    mapReady: false,
    marker: null,
    mapMode: "offline",
    offlineView: null,
    onlineAttempted: false,
    location: null,
    currentRequestId: createId(),
    isSending: false,
    lastGeocodeAt: 0,
    searchCache: new Map(),
    device: null,
  };

  const quickPlaces = {
    colombo: {
      latitude: 6.9271,
      longitude: 79.8612,
      label: "Colombo, Sri Lanka"
    },
    kelaniya: {
      latitude: 6.9559,
      longitude: 79.9223,
      label: "Kelaniya, Sri Lanka"
    },
    kandy: {
      latitude: 7.2906,
      longitude: 80.6337,
      label: "Kandy, Sri Lanka"
    },
    galle: {
      latitude: 6.0535,
      longitude: 80.2210,
      label: "Galle, Sri Lanka"
    },
    negombo: {
      latitude: 7.2083,
      longitude: 79.8358,
      label: "Negombo, Sri Lanka"
    },
    ratnapura: {
      latitude: 6.6828,
      longitude: 80.3992,
      label: "Ratnapura, Sri Lanka"
    },
    jaffna: {
      latitude: 9.6615,
      longitude: 80.0255,
      label: "Jaffna, Sri Lanka"
    },
    matara: {
      latitude: 5.9549,
      longitude: 80.5550,
      label: "Matara, Sri Lanka"
    },
    kurunegala: {
      latitude: 7.4863,
      longitude: 80.3647,
      label: "Kurunegala, Sri Lanka"
    },
  };

  const examples = {
    sos: "TEST MESSAGE ONLY: SOS - Floodwater is entering our house. Three people need urgent help.",
    water: "TEST MESSAGE ONLY: We need clean drinking water for four family members.",
    medical: "TEST MESSAGE ONLY: A family member needs urgent medical assistance and medicine.",
    general: "TEST MESSAGE ONLY: This is a LINKO Field communication test. Please confirm receipt.",
  };

  // ============================================================
  // DEVICE ID
  // ============================================================

  function createId() {
    if (crypto?.randomUUID) return crypto.randomUUID();

    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(
      /[xy]/g,
      (c) => {
        const n = Math.floor(Math.random() * 16);
        return (c === "x" ? n : (n & 3) | 8).toString(16);
      }
    );
  }

  function randomHex(length = 7) {
    const bytes = new Uint8Array(Math.ceil(length / 2));

    if (crypto?.getRandomValues) {
      crypto.getRandomValues(bytes);
    } else {
      for (let i = 0; i < bytes.length; i++) {
        bytes[i] = Math.floor(Math.random() * 256);
      }
    }

    return Array.from(
      bytes,
      (b) => b.toString(16).padStart(2, "0")
    ).join("").toUpperCase().slice(0, length);
  }

  function newDevice() {
    const names = [
      "River",
      "Beacon",
      "Aster",
      "Horizon",
      "Coastal",
      "Willow",
      "Signal",
      "Delta",
      "Cedar",
      "Harbor",
      "Bluebird",
      "Nova"
    ];

    const index = parseInt(randomHex(2), 16) % names.length;
    const token = randomHex(6);

    state.device = {
      id: `ONE-TEST-${token}`,
      name: `LINKO One · ${names[index]} ${
        parseInt(token.slice(0, 3), 16) % 900 + 100
      }`
    };

    $("generatedDeviceName").textContent = state.device.name;
    $("generatedDeviceId").textContent = state.device.id;
    $("deviceId").value = state.device.id;
  }

  function icon(name) {
    const svg = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "svg"
    );

    svg.classList.add("icon");

    const use = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "use"
    );

    use.setAttribute("href", `#ic-${name}`);
    svg.appendChild(use);

    return svg;
  }

  // ============================================================
  // NOTIFICATIONS
  // ============================================================

  function notify(message = "", kind = "info") {
    const el = $("feedback");

    el.hidden = !message;
    el.className = `feedback ${kind}`;
    el.textContent = message;

    if (message && kind === "error") {
      console.warn("LINKO test form:", message);
    }
  }

  function revealSubmissionResult() {
    const el = $("feedback");

    if (!el.hidden) {
      el.scrollIntoView({
        behavior: "smooth",
        block: "nearest"
      });
    }
  }

  function coordinatesValid(lat, lon) {
    return (
      Number.isFinite(lat) &&
      Number.isFinite(lon) &&
      lat >= -90 &&
      lat <= 90 &&
      lon >= -180 &&
      lon <= 180
    );
  }

  function short(text, length = 70) {
    return text.length <= length
      ? text
      : `${text.slice(0, length - 1)}…`;
  }

  const round = (v) => Number(v).toFixed(6);

  function mapText(text) {
    $("mapStatusText").textContent = text;
  }

  // ============================================================
  // MAP ACCURACY
  // ============================================================

  function accuracyGeoJSON(lat, lng, radiusMetres) {
    if (
      !Number.isFinite(radiusMetres) ||
      radiusMetres <= 0
    ) {
      return {
        type: "FeatureCollection",
        features: []
      };
    }

    const radius = Math.min(radiusMetres, 100000) / 6371008.8;

    const lat0 = lat * Math.PI / 180;
    const lon0 = lng * Math.PI / 180;

    const coordinates = [];

    for (let step = 0; step <= 64; step++) {
      const bearing = 2 * Math.PI * step / 64;

      const newLat = Math.asin(
        Math.sin(lat0) * Math.cos(radius) +
        Math.cos(lat0) * Math.sin(radius) * Math.cos(bearing)
      );

      const newLon = lon0 + Math.atan2(
        Math.sin(bearing) * Math.sin(radius) * Math.cos(lat0),
        Math.cos(radius) - Math.sin(lat0) * Math.sin(newLat)
      );

      coordinates.push([
        newLon * 180 / Math.PI,
        newLat * 180 / Math.PI
      ]);
    }

    return {
      type: "FeatureCollection",
      features: [{
        type: "Feature",
        properties: {},
        geometry: {
          type: "Polygon",
          coordinates: [coordinates]
        }
      }]
    };
  }

  // ============================================================
  // ONLINE MAP LOCATION
  // ============================================================

  function updateMapLocation() {
    if (
      !state.mapReady ||
      !state.location ||
      !state.map
    ) return;

    const {
      latitude,
      longitude,
      accuracyMeters
    } = state.location;

    const coords = [longitude, latitude];

    if (!state.marker) {
      state.marker = new state.maplibre.Marker({
        color: "#0071e3",
        draggable: true,
        anchor: "bottom"
      }).setLngLat(coords).addTo(state.map);

      state.marker.on("dragend", () => {
        const point = state.marker.getLngLat();

        setLocation(point.lat, point.lng, {
          source: "map_pin",
          label: "Dragged map pin",
          zoom: false
        });
      });
    } else {
      state.marker.setLngLat(coords);
    }

    const src = state.map.getSource(
      "linko-location-accuracy"
    );

    if (src) {
      src.setData(
        accuracyGeoJSON(
          latitude,
          longitude,
          accuracyMeters
        )
      );
    }

    const zoom = Math.max(
      state.map.getZoom(),
      13.3
    );

    state.map.easeTo({
      center: coords,
      zoom,
      duration: 600
    });
  }

  // ============================================================
  // SET LOCATION
  // ============================================================

  function setLocation(lat, lng, options = {}) {
    if (!coordinatesValid(lat, lng)) {
      notify(
        "Please choose valid latitude and longitude coordinates.",
        "error"
      );
      return;
    }

    const {
      source = "manual",
      label = "Selected map location",
      accuracyMeters = null,
      zoom = true
    } = options;

    state.location = {
      latitude: lat,
      longitude: lng,
      accuracyMeters:
        Number.isFinite(accuracyMeters) && accuracyMeters >= 0
          ? Math.min(accuracyMeters, 100000)
          : null,
      observedAt: new Date().toISOString(),
      source,
      label: String(label).slice(0, 180)
    };

    $("latitude").value = round(lat);
    $("longitude").value = round(lng);

    $("selectedPlaceName").textContent = short(
      state.location.label,
      58
    );

    $("locationSourceTag").textContent =
      source === "browser_gps"
        ? "CURRENT GPS"
        : source === "place_search"
          ? "PLACE SEARCH"
          : "MAP PIN";

    $("locationSourceTag").classList.add("active");

    $("locationAccuracy").textContent =
      state.location.accuracyMeters === null
        ? "Manually selected position. No GPS accuracy estimate available."
        : `Device-reported GPS accuracy: approximately ±${Math.round(
            state.location.accuracyMeters
          )} m (not guaranteed).`;

    $("locationSummary")
      .querySelector("strong")
      .textContent = short(state.location.label, 46);

    $("locationSummary")
      .querySelector("div span")
      .textContent = `${round(lat)}, ${round(lng)}`;

    $("openMapLink").hidden = false;

    $("openMapLink").href =
      `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=15/${lat}/${lng}`;

    if (state.mapReady) {
      if (zoom) {
        updateMapLocation();
      } else {
        if (state.marker) {
          state.marker.setLngLat([lng, lat]);
        }

        const src = state.map.getSource(
          "linko-location-accuracy"
        );

        if (src) {
          src.setData(
            accuracyGeoJSON(
              lat,
              lng,
              state.location.accuracyMeters
            )
          );
        }
      }
    }

    renderOfflinePin();
    updateMobileSend();

    mapText("Selected position ready");
    notify("");
  }

  function clearLocation() {
    state.location = null;

    if (state.marker) {
      state.marker.remove();
    }

    state.marker = null;

    if (state.mapReady) {
      state.map.getSource(
        "linko-location-accuracy"
      )?.setData({
        type: "FeatureCollection",
        features: []
      });
    }

    $("latitude").value = "";
    $("longitude").value = "";

    $("selectedPlaceName").textContent =
      "No location chosen yet";

    $("locationSourceTag").textContent = "NOT SET";
    $("locationSourceTag").classList.remove("active");

    $("locationAccuracy").textContent =
      "Use GPS, search for a place, tap the map, or enter coordinates.";

    $("locationSummary")
      .querySelector("strong")
      .textContent = "Location not selected";

    $("locationSummary")
      .querySelector("div span")
      .textContent = "Choose a location on the map first.";

    $("openMapLink").hidden = true;

    renderOfflinePin();
    updateMobileSend();

    mapText("Tap the map to choose a point");
  }

  // ============================================================
  // MAP INITIALIZATION
  // ============================================================

  async function initMap(manual = false) {
    if (!document.querySelector("#linkoMapCSS")) {
      const link = document.createElement("link");

      link.id = "linkoMapCSS";
      link.rel = "stylesheet";

      link.href =
        "https://cdn.jsdelivr.net/npm/maplibre-gl@6.19.0/dist/maplibre-gl.css";

      document.head.appendChild(link);
    }

    if (state.onlineAttempted && !manual) return;

    if (state.mapReady) {
      if (manual) showOnlineMap();
      return;
    }

    if (state.mapLoading) return;

    state.mapLoading = true;
    state.onlineAttempted = true;

    if (manual) {
      mapText("Loading online street map…");
    }

    try {
      let gl;

      try {
        gl = await Promise.race([
          import(
            "https://cdn.jsdelivr.net/npm/maplibre-gl@6.19.0/dist/maplibre-gl.mjs"
          ),
          new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error("Map library timed out")),
              8500
            )
          )
        ]);
      } catch (firstError) {
        console.warn(
          "Primary map CDN not available:",
          firstError.message
        );

        gl = await Promise.race([
          import(
            "https://unpkg.com/maplibre-gl@6.19.0/dist/maplibre-gl.mjs"
          ),
          new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error("Backup map library timed out")),
              8000
            )
          )
        ]);
      }

      if (!gl.supported()) {
        throw new Error("WebGL2 not available");
      }

      const map = new gl.Map({
        container: "map",
        style: CONFIG.MAP_STYLE,
        center: [80.65, 7.55],
        zoom: 7.1,
        minZoom: 5.5,
        attributionControl: false,
        cooperativeGestures: false
      });

      state.map = map;

      map.addControl(
        new gl.NavigationControl({
          showCompass: false
        }),
        "top-right"
      );

      map.addControl(
        new gl.AttributionControl({
          compact: true
        }),
        "bottom-right"
      );

      let settled = false;

      const timeout = setTimeout(() => {
        if (!settled) {
          try {
            map.remove();
          } catch {}

          state.map = null;

          mapFailed(
            "Online tiles slow or unavailable · Use coordinate map"
          );
        }
      }, 11000);

      map.on("load", () => {
        if (settled || state.map !== map) return;

        settled = true;
        clearTimeout(timeout);

        state.maplibre = gl;
        state.mapReady = true;

        map.addSource("linko-location-accuracy", {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: []
          }
        });

        map.addLayer({
          id: "linko-accuracy-fill",
          type: "fill",
          source: "linko-location-accuracy",
          paint: {
            "fill-color": "#0071e3",
            "fill-opacity": 0.1
          }
        });

        map.addLayer({
          id: "linko-accuracy-outline",
          type: "line",
          source: "linko-location-accuracy",
          paint: {
            "line-color": "#0071e3",
            "line-opacity": 0.7,
            "line-width": 1.5
          }
        });

        if (state.location) {
          updateMapLocation();
        }

        showOnlineMap();
      });

      map.on("error", (ev) => {
        if (ev?.error) {
          console.warn(
            "Basemap error:",
            ev.error.message || ev.error
          );
        }
      });

      map.on("click", (ev) =>
        setLocation(
          ev.lngLat.lat,
          ev.lngLat.lng,
          {
            source: "map_pin",
            label: "Selected on street map"
          }
        )
      );

    } catch (error) {
      console.warn(
        "Online map could not load:",
        error.message || error
      );

      mapFailed(
        "Online map unavailable · Offline map is ready"
      );

    } finally {
      state.mapLoading = false;
    }
  }

  function mapFailed(message) {
    if (state.mapReady) return;

    showOfflineMap();

    $("mapStatus").classList.add("map-offline");
    mapText(message);
  }

  // ============================================================
  // OFFLINE COORDINATE MAP
  // ============================================================

  const geoBounds = {
    west: 77.35,
    east: 84.45,
    south: 5.50,
    north: 10.05
  };

  const offlinePath = "M294.8,409.7 L294.5,409.5 L292.8,408.8 L292.8,406.6 L291.4,406.2 L290.7,407.6 L286.6,402.9 L286.4,403.9 L281.7,400.0 L274.6,390.2 L271.7,382.6 L271.6,376.5 L267.3,365.6 L269.4,366.1 L265.9,363.1 L266.6,357.6 L264.2,352.1 L265.1,353.0 L264.5,350.6 L264.1,351.1 L255.0,327.9 L252.5,314.8 L253.0,312.9 L253.4,314.6 L255.2,311.1 L256.8,310.9 L256.6,312.4 L257.2,310.8 L255.4,310.7 L250.4,287.4 L254.2,298.5 L254.4,296.4 L255.7,296.5 L255.6,292.9 L254.0,288.9 L252.2,289.0 L251.4,287.4 L252.7,281.1 L254.1,280.6 L252.5,280.6 L247.2,250.5 L247.2,247.4 L247.6,249.2 L248.7,246.8 L248.0,246.8 L248.4,238.7 L246.5,227.8 L238.7,201.9 L238.3,194.2 L239.4,193.3 L237.8,187.3 L238.3,185.3 L240.9,184.3 L242.2,179.3 L246.8,171.4 L244.2,176.6 L245.4,176.8 L243.8,178.4 L244.5,181.1 L241.2,184.3 L246.3,181.2 L245.5,185.4 L244.1,184.9 L242.3,187.2 L243.4,189.1 L241.3,193.6 L241.6,199.0 L244.0,201.2 L242.7,202.0 L242.2,206.0 L243.8,208.6 L251.0,210.2 L250.4,207.7 L251.8,205.5 L247.3,199.7 L248.5,200.0 L247.8,198.9 L251.8,194.2 L251.6,192.1 L250.2,191.2 L250.3,187.0 L247.6,184.7 L249.3,184.8 L247.2,183.8 L249.4,183.3 L251.9,177.6 L253.3,178.7 L252.0,175.2 L253.0,175.1 L252.0,174.8 L253.1,171.9 L252.7,165.2 L254.9,161.7 L255.5,153.6 L260.3,151.9 L260.8,150.4 L262.7,151.1 L260.7,150.0 L260.6,147.7 L263.2,144.7 L263.6,136.0 L264.8,134.5 L261.2,127.1 L262.8,125.9 L260.5,125.3 L262.2,120.0 L261.7,116.9 L262.8,116.6 L259.7,112.7 L261.9,111.6 L261.6,114.8 L263.5,115.0 L262.8,113.2 L264.8,110.2 L268.0,108.7 L268.0,106.9 L275.5,102.9 L276.0,96.9 L277.2,96.0 L276.5,93.4 L280.9,84.3 L279.9,78.2 L281.7,76.6 L278.0,73.3 L275.3,72.9 L274.3,66.6 L283.9,61.9 L287.6,57.5 L283.2,51.5 L274.2,45.7 L275.3,44.5 L286.3,51.4 L292.5,52.1 L297.4,56.1 L294.0,55.4 L297.1,58.3 L292.5,58.3 L297.9,60.7 L300.5,59.5 L302.6,60.4 L303.4,58.9 L304.4,59.7 L309.2,57.0 L308.8,54.1 L294.3,43.9 L286.2,40.1 L285.0,41.1 L286.4,42.0 L285.4,43.3 L287.4,43.5 L286.7,44.9 L276.6,39.6 L277.0,41.5 L282.6,44.7 L273.9,40.8 L270.8,40.8 L267.8,36.4 L267.0,37.1 L265.5,35.3 L263.2,36.5 L259.2,29.7 L268.2,24.2 L282.3,23.5 L282.2,26.1 L282.8,23.1 L289.9,22.0 L294.5,23.0 L297.2,29.0 L305.7,39.3 L337.0,64.0 L335.8,65.2 L334.1,63.2 L334.9,65.2 L338.7,67.2 L337.5,64.6 L350.9,76.6 L349.2,77.5 L351.3,77.1 L358.3,93.4 L356.2,92.1 L356.5,95.4 L358.0,96.5 L358.6,93.9 L370.4,112.9 L368.9,114.2 L370.8,113.0 L371.6,117.0 L371.8,115.5 L376.1,120.5 L378.7,120.2 L382.1,127.2 L380.8,127.6 L385.1,129.6 L387.9,133.3 L386.1,133.5 L384.9,132.6 L384.0,134.3 L384.8,133.1 L386.9,134.1 L387.0,135.9 L388.1,133.7 L393.2,141.4 L392.6,146.3 L394.1,149.0 L395.3,148.6 L395.3,152.4 L393.4,153.5 L393.2,149.7 L389.9,149.7 L391.8,156.2 L389.1,155.9 L388.6,153.3 L387.3,154.8 L389.9,160.2 L388.5,162.6 L391.4,161.8 L390.9,160.1 L393.4,160.8 L392.7,162.8 L394.0,160.7 L396.4,160.7 L394.4,161.4 L395.0,162.4 L396.9,160.7 L398.7,161.6 L398.7,156.2 L402.3,154.5 L402.9,156.2 L403.8,156.3 L403.8,157.9 L405.0,156.5 L404.7,157.7 L406.1,157.6 L410.0,171.1 L408.6,171.3 L410.8,182.1 L411.3,180.8 L417.6,202.2 L421.4,207.7 L424.1,209.2 L422.3,215.6 L426.8,218.0 L429.0,222.9 L431.3,225.4 L433.2,224.9 L435.2,229.0 L442.1,235.2 L439.8,231.9 L441.9,233.5 L450.5,249.4 L453.1,261.5 L451.9,258.3 L451.2,260.7 L452.4,260.6 L455.4,266.5 L458.4,278.4 L457.6,289.5 L456.8,288.1 L457.3,289.6 L453.4,292.5 L455.7,296.4 L457.6,290.0 L457.4,299.1 L456.2,300.0 L457.7,299.3 L459.4,306.0 L458.5,307.7 L457.2,306.9 L457.9,308.2 L459.2,307.2 L458.0,310.8 L455.9,309.0 L456.6,311.4 L458.5,311.1 L457.8,312.9 L456.5,311.9 L457.7,313.4 L454.5,319.7 L455.5,320.3 L456.4,318.8 L456.2,321.7 L454.8,323.6 L454.0,322.2 L452.7,323.3 L455.6,325.0 L452.9,327.6 L453.9,327.9 L453.1,332.6 L454.1,332.6 L450.5,337.3 L451.6,338.1 L448.5,342.3 L447.7,349.6 L445.2,352.6 L444.1,352.2 L444.3,353.7 L443.4,353.3 L444.3,354.3 L442.6,354.8 L443.9,355.6 L441.5,359.7 L434.1,365.7 L434.7,363.8 L433.0,367.7 L427.6,372.3 L421.3,373.9 L418.9,378.6 L413.0,382.1 L411.5,381.7 L412.5,383.1 L410.3,384.9 L408.0,384.4 L408.1,386.1 L404.8,387.3 L403.1,389.9 L389.4,393.8 L389.7,391.6 L389.1,393.8 L383.3,397.5 L371.8,398.5 L368.0,401.0 L358.9,402.8 L356.2,405.5 L351.9,404.9 L347.9,409.2 L344.7,409.9 L343.6,412.5 L342.2,411.9 L341.5,413.9 L334.9,414.0 L328.8,418.1 L328.3,416.1 L323.9,415.1 L317.2,416.3 L314.3,415.7 L315.0,413.3 L313.8,412.8 L311.3,414.4 L307.4,413.8 L300.5,410.6 L294.8,409.7 Z";

  const mapTowns = [
    ["Jaffna", 9.6615, 80.0255],
    ["Anuradhapura", 8.3114, 80.4037],
    ["Trincomalee", 8.5874, 81.2152],
    ["Batticaloa", 7.7145, 81.6951],
    ["Negombo", 7.2083, 79.8358],
    ["Colombo", 6.9271, 79.8612],
    ["Kandy", 7.2906, 80.6337],
    ["Badulla", 6.9895, 81.0550],
    ["Ratnapura", 6.6828, 80.3992],
    ["Galle", 6.0535, 80.2210],
    ["Matara", 5.9549, 80.5550]
  ];

  function geoToSvg(lat, lng) {
    return {
      x: (lng - geoBounds.west) /
         (geoBounds.east - geoBounds.west) * 720,
      y: (geoBounds.north - lat) /
         (geoBounds.north - geoBounds.south) * 460
    };
  }

  function svgToGeo(x, y) {
    return {
      longitude:
        geoBounds.west +
        x / 720 * (geoBounds.east - geoBounds.west),
      latitude:
        geoBounds.north -
        y / 460 * (geoBounds.north - geoBounds.south)
    };
  }

  function offlineViewForScreen() {
    return window.innerWidth < 580
      ? { x: 160, y: 0, w: 400, h: 460 }
      : { x: 0, y: 0, w: 720, h: 460 };
  }

  function updateOfflineView() {
    const v = state.offlineView;

    if (v) {
      $("offlineMap").setAttribute(
        "viewBox",
        `${v.x} ${v.y} ${v.w} ${v.h}`
      );
    }
  }

  function renderOfflinePin() {
    const pin = $("offlinePin");

    if (!pin) return;

    if (!state.location) {
      pin.setAttribute("visibility", "hidden");
      return;
    }

    const p = geoToSvg(
      state.location.latitude,
      state.location.longitude
    );

    pin.setAttribute(
      "transform",
      `translate(${p.x},${p.y})`
    );

    pin.setAttribute("visibility", "visible");
  }

  function initOfflineMap() {
    const svg = $("offlineMap");

    state.offlineView = offlineViewForScreen();

    const grid = [];

    for (let lat = 5.5; lat <= 10.1; lat += 0.5) {
      const yy = geoToSvg(lat, 80).y;

      grid.push(
        `<line x1="0" y1="${yy}" x2="720" y2="${yy}"/>`
      );
    }

    for (let lon = 77.5; lon <= 84.5; lon += 0.5) {
      const xx = geoToSvg(7, lon).x;

      grid.push(
        `<line x1="${xx}" y1="0" x2="${xx}" y2="460"/>`
      );
    }

    const towns = mapTowns.map(
      ([name, lat, lng]) => {
        const p = geoToSvg(lat, lng);

        return `
          <g class="offline-town"
             transform="translate(${p.x.toFixed(1)},${p.y.toFixed(1)})">
            <circle r="3.2"/>
            <text x="8" y="-6">${name}</text>
          </g>
        `;
      }
    ).join("");

    svg.innerHTML =
      `<rect width="720" height="460" class="offline-sea"/>` +
      `<g class="offline-grid">${grid.join("")}</g>` +
      `<path class="offline-land" d="${offlinePath}"/>` +
      `<g>${towns}</g>` +
      `<g id="offlinePin" visibility="hidden">` +
      `<circle class="offline-pin-ring" r="18"/>` +
      `<circle class="offline-pin-halo" r="10"/>` +
      `<circle class="offline-pin-core" r="5"/>` +
      `<path d="M-13,0H-23M13,0H23M0,-13V-23M0,13V23" stroke="#0066cc" stroke-width="1.4"/>` +
      `</g>`;

    updateOfflineView();

    svg.addEventListener("click", (event) => {
      if (state.mapMode !== "offline") return;

      const point = svg.createSVGPoint();

      point.x = event.clientX;
      point.y = event.clientY;

      const matrix = svg.getScreenCTM();

      if (!matrix) return;

      const c = point.matrixTransform(
        matrix.inverse()
      );

      const pos = svgToGeo(c.x, c.y);

      if (
        coordinatesValid(
          pos.latitude,
          pos.longitude
        )
      ) {
        setLocation(
          pos.latitude,
          pos.longitude,
          {
            source: "map_pin",
            label: "Selected on coordinate map"
          }
        );
      }
    });

    svg.addEventListener("keydown", (event) => {
      if (
        ![
          "ArrowUp",
          "ArrowDown",
          "ArrowLeft",
          "ArrowRight"
        ].includes(event.key)
      ) return;

      event.preventDefault();

      const base = state.location || {
        latitude: 7.50,
        longitude: 80.70
      };

      const step =
        state.offlineView.w / 720 * 0.04;

      const lat =
        base.latitude +
        (
          event.key === "ArrowUp"
            ? step
            : event.key === "ArrowDown"
              ? -step
              : 0
        );

      const lng =
        base.longitude +
        (
          event.key === "ArrowRight"
            ? step
            : event.key === "ArrowLeft"
              ? -step
              : 0
        );

      setLocation(lat, lng, {
        source: "manual",
        label: "Selected on coordinate map"
      });
    });

    $("offlineZoomIn").addEventListener(
      "click",
      () => zoomOffline(0.65)
    );

    $("offlineZoomOut").addEventListener(
      "click",
      () => zoomOffline(1 / 0.65)
    );

    $("offlineMapButton").addEventListener(
      "click",
      () => showOfflineMap()
    );

    $("onlineMapButton").addEventListener(
      "click",
      () => {
        if (state.mapReady) {
          showOnlineMap();
        } else {
          mapText(
            "Connecting to online street map… offline map remains available"
          );

          initMap(true);
        }
      }
    );

    window.addEventListener("resize", () => {
      if (
        state.offlineView &&
        state.offlineView.w >= 400
      ) {
        const old = state.offlineView;
        const next = offlineViewForScreen();

        if (
          (old.w === 720 && next.w === 400) ||
          (old.w === 400 && next.w === 720)
        ) {
          state.offlineView = next;
          updateOfflineView();
        }
      }
    });

    renderOfflinePin();
    showOfflineMap();
  }

  function zoomOffline(factor) {
    let v = state.offlineView;

    const w = Math.max(
      70,
      Math.min(720, v.w * factor)
    );

    const h = Math.max(
      55,
      Math.min(460, v.h * factor)
    );

    const center = state.location
      ? geoToSvg(
          state.location.latitude,
          state.location.longitude
        )
      : {
          x: v.x + v.w / 2,
          y: v.y + v.h / 2
        };

    state.offlineView = {
      x: Math.max(
        0,
        Math.min(720 - w, center.x - w / 2)
      ),
      y: Math.max(
        0,
        Math.min(460 - h, center.y - h / 2)
      ),
      w,
      h
    };

    updateOfflineView();
  }

  function showOfflineMap() {
    state.mapMode = "offline";

    $("mapFallback").hidden = false;
    $("map").style.display = "none";

    $("offlineMapButton").classList.add("active");
    $("offlineMapButton").setAttribute(
      "aria-pressed",
      "true"
    );

    $("onlineMapButton").classList.remove("active");
    $("onlineMapButton").setAttribute(
      "aria-pressed",
      "false"
    );

    $("mapAttribution").textContent =
      "Outline: GSHHG · Coordinates: WGS84";

    mapText(
      state.location
        ? "Selected location ready · Tap to change it"
        : "Tap the map, search a place, or use GPS"
    );

    $("mapStatus").classList.remove("map-offline");
  }

  function showOnlineMap() {
    if (!state.mapReady) {
      showOfflineMap();
      return;
    }

    state.mapMode = "online";

    $("mapFallback").hidden = true;
    $("map").style.display = "block";

    $("onlineMapButton").classList.add("active");
    $("onlineMapButton").setAttribute(
      "aria-pressed",
      "true"
    );

    $("offlineMapButton").classList.remove("active");
    $("offlineMapButton").setAttribute(
      "aria-pressed",
      "false"
    );

    $("mapAttribution").textContent =
      "Online basemap: OpenFreeMap · OpenStreetMap contributors";

    mapText(
      state.location
        ? "Selected location ready"
        : "Tap the map to place a pin"
    );

    setTimeout(
      () => state.map?.resize(),
      50
    );
  }

  function updateMobileSend() {
    const chip = $("locationSummary");

    chip.classList.toggle(
      "has-location",
      Boolean(state.location)
    );
  }

  // ============================================================
  // LOCATION SEARCH
  // ============================================================

  function renderSearchNotice(message) {
    const list = $("placeResults");

    list.replaceChildren();

    const row = document.createElement("div");

    row.className = "place-results-empty";
    row.textContent = message;

    list.appendChild(row);
    list.hidden = false;
  }

  function renderPlaces(places) {
    const list = $("placeResults");

    list.replaceChildren();

    if (!places.length) {
      renderSearchNotice(
        "No matches found. Try a nearby town, use Current location, or enter coordinates."
      );

      return;
    }

    places.forEach((p) => {
      const button = document.createElement("button");

      button.type = "button";
      button.className = "place-result";

      button.appendChild(icon("pin"));

      const label = document.createElement("span");

      label.textContent = p.label;

      button.appendChild(label);

      button.addEventListener("click", () => {
        $("placeQuery").value = p.label;

        list.hidden = true;

        setLocation(
          p.latitude,
          p.longitude,
          {
            source: "place_search",
            label: p.label
          }
        );
      });

      list.appendChild(button);
    });

    list.hidden = false;
  }

  async function searchPlace(event) {
    event.preventDefault();

    const query = $("placeQuery").value.trim();

    if (query.length < 3) {
      renderSearchNotice(
        "Type at least 3 characters, then press Search."
      );

      return;
    }

    const key = query.toLowerCase();

    const local = Object.values(
      quickPlaces
    ).filter(
      (p) =>
        p.label.toLowerCase().includes(key)
    );

    const btn = $("searchButton");

    btn.disabled = true;
    btn.textContent = "Searching…";

    try {
      if (state.searchCache.has(key)) {
        renderPlaces(
          state.searchCache.get(key)
        );
        return;
      }

      const wait = Math.max(
        0,
        1200 - (Date.now() - state.lastGeocodeAt)
      );

      if (wait) {
        await new Promise(
          (resolve) =>
            setTimeout(resolve, wait)
        );
      }

      state.lastGeocodeAt = Date.now();

      const url = new URL(
        CONFIG.GEOCODE_ENDPOINT
      );

      url.searchParams.set("format", "jsonv2");
      url.searchParams.set("q", query);
      url.searchParams.set("limit", "5");
      url.searchParams.set("countrycodes", "lk");

      const res = await fetch(
        url,
        {
          headers: {
            Accept: "application/json"
          },
          signal: AbortSignal.timeout(10000)
        }
      );

      if (!res.ok) {
        throw new Error(
          `Location provider returned ${res.status}`
        );
      }

      const raw = await res.json();

      const remote = (
        Array.isArray(raw) ? raw : []
      ).map(
        (p) => ({
          latitude: Number(p.lat),
          longitude: Number(p.lon),
          label: String(p.display_name || "")
        })
      ).filter(
        (p) =>
          coordinatesValid(
            p.latitude,
            p.longitude
          ) && p.label
      );

      const merged = remote.length
        ? remote
        : local;

      state.searchCache.set(key, merged);

      renderPlaces(merged);

    } catch (error) {
      if (local.length) {
        renderPlaces(local);
      } else {
        renderSearchNotice(
          "Place search could not connect. Use Current location, select the map, or enter coordinates."
        );
      }

      console.warn(
        "Place lookup unavailable:",
        error.message
      );

    } finally {
      btn.disabled = false;
      btn.textContent = "Search";
    }
  }

  // ============================================================
  // CURRENT GPS LOCATION
  // ============================================================

  function currentLocation() {
    if (!navigator.geolocation) {
      notify(
        "Current location is not supported by this browser. Use search or coordinates.",
        "error"
      );

      return;
    }

    if (!window.isSecureContext) {
      notify(
        "Current location requires HTTPS or localhost. Open the website through http://localhost or HTTPS.",
        "error"
      );

      return;
    }

    const button = $("currentLocationButton");

    button.disabled = true;
    button.textContent = "Locating…";

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocation(
          pos.coords.latitude,
          pos.coords.longitude,
          {
            source: "browser_gps",
            accuracyMeters: pos.coords.accuracy,
            label: "Current GPS location"
          }
        );

        button.disabled = false;

        button.replaceChildren(
          icon("crosshair"),
          document.createTextNode(
            " Current location"
          )
        );
      },

      (err) => {
        const messages = {
          1: "Location permission was denied.",
          2: "Your device could not find its position.",
          3: "Location request timed out."
        };

        notify(
          `${
            messages[err.code] ||
            "Current location unavailable."
          } Choose the location manually if needed.`,
          "error"
        );

        button.disabled = false;

        button.replaceChildren(
          icon("crosshair"),
          document.createTextNode(
            " Current location"
          )
        );
      },

      {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 16000
      }
    );
  }

  function applyCoordinates() {
    const rawLat = $("latitude").value.trim();
    const rawLng = $("longitude").value.trim();

    if (!rawLat || !rawLng) {
      notify(
        "Enter both latitude and longitude.",
        "error"
      );

      return;
    }

    const lat = Number(rawLat);
    const lng = Number(rawLng);

    if (!coordinatesValid(lat, lng)) {
      notify(
        "Coordinates must be a valid latitude (-90…90) and longitude (-180…180).",
        "error"
      );

      return;
    }

    setLocation(lat, lng, {
      source: "manual",
      label: "Manual coordinates"
    });
  }

  // ============================================================
  // SEND BUTTON LOADING STATE
  // ============================================================

  function setSending(loading) {
    state.isSending = loading;

    $("sendButton").disabled = loading;

    $("sendButtonLabel").textContent =
      loading
        ? "Sending…"
        : "Send test message";
  }

  // ============================================================
  // SEND MESSAGE TO SUPABASE
  // ============================================================

  async function sendMessage(event) {
    event.preventDefault();

    if (state.isSending) return;

    notify("");

    const form = $("messageForm");

    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    if (!state.location) {
      notify(
        "Select a location first: use Current location, place search, map pin, or manual coordinates.",
        "error"
      );

      $("location-section").scrollIntoView({
        behavior: "smooth",
        block: "start"
      });

      return;
    }

    if (!$("consent").checked) {
      notify(
        "Please confirm that this is a test-only submission.",
        "error"
      );

      return;
    }

    const name = $("senderName").value.trim();
    const message = $("messageText").value.trim();

    if (
      name.length < 2 ||
      message.length < 3
    ) {
      notify(
        "Enter a valid name and message before sending.",
        "error"
      );

      return;
    }

    const requestId = state.currentRequestId;

    const sourceMap = {
      browser_gps: "gps",
      place_search: "search",
      map_pin: "map_pin",
      manual: "manual"
    };

    const payload = {
      idempotency_key: requestId,
      sender_name: name,

      sender_phone:
        $("phone").value.trim() || null,

      device_id: state.device.id,

      message_text: message,

      user_selected_category: null,

      latitude: state.location.latitude,
      longitude: state.location.longitude,

      location_name: state.location.label,

      location_source:
        sourceMap[state.location.source] ||
        "manual",

      location_accuracy_m:
        state.location.accuracyMeters,

      location_observed_at:
        state.location.observedAt
    };

    setSending(true);

    try {
      const endpoint =
        CONFIG.API_BASE_URL.trim();

      if (!endpoint) {
        throw new Error(
          "Supabase intake endpoint is not configured."
        );
      }

      if (!/^https:\/\//i.test(endpoint)) {
        throw new Error(
          "Secure HTTPS intake endpoint required."
        );
      }

      const response = await fetch(
        endpoint,
        {
          method: "POST",

          headers: {
            "Content-Type": "application/json",
            "apikey": CONFIG.SUPABASE_PUBLISHABLE_KEY
          },

          body: JSON.stringify(payload),

          signal:
            AbortSignal.timeout(20000)
        }
      );

      let body = {};

      try {
        body = await response.json();
      } catch {}

      if (
        !response.ok ||
        body.ok !== true
      ) {
        throw new Error(
          body.error ||
          `Request rejected (${response.status}).`
        );
      }

      // ====================================================
      // UPDATED SUCCESS MESSAGE
      // Category and Priority are NOT shown to the user.
      // The server still stores classification in Supabase.
      // ====================================================

      notify(
        `Test message sent successfully!

Reference ID: ${body.referenceId || body.messageId || requestId}

Your test message has been saved successfully.

Thank you for using LINKO Field.

This is a test submission, not an emergency response confirmation.`,
        "success"
      );

      // Prepare a new ID only after successful submission.
      state.currentRequestId = createId();

      revealSubmissionResult();

      $("messageText").value = "";
      $("charCount").textContent = "0 / 1000";

      document.querySelectorAll(
        "[data-template]"
      ).forEach(
        (b) => b.classList.remove("active")
      );

    } catch (error) {
      const message =
        error instanceof TypeError &&
        /fetch|network|load/i.test(error.message)

          ? (
              location.protocol === "file:"
                ? "Open this website using http://localhost:8080 rather than double-clicking index.html (file://)."
                : "Connection failed. Check the browser Network panel, Edge Function URL, CORS origin, and your internet connection. If hosted, the domain must be in LINKO_ALLOWED_ORIGINS."
            )

          : (
              error?.name === "TimeoutError"
                ? "Request timed out. Check your connection and try again."
                : error.message
            );

      notify(
        `Message not confirmed: ${message}
Please retry. The same request ID was kept to reduce duplicate submissions.`,
        "error"
      );

      revealSubmissionResult();

    } finally {
      setSending(false);
    }
  }

  // ============================================================
  // INITIALIZE WEBSITE
  // ============================================================

  function init() {
    newDevice();

    $("regenerateDevice").addEventListener(
      "click",
      newDevice
    );

    $("placeSearchForm").addEventListener(
      "submit",
      searchPlace
    );

    $("currentLocationButton").addEventListener(
      "click",
      currentLocation
    );

    $("clearLocationButton").addEventListener(
      "click",
      clearLocation
    );

    $("applyCoordinatesButton").addEventListener(
      "click",
      applyCoordinates
    );

    document.querySelectorAll(
      "[data-place]"
    ).forEach(
      (button) => {
        button.addEventListener(
          "click",
          () => {
            const place =
              quickPlaces[button.dataset.place];

            if (place) {
              $("placeQuery").value = place.label;

              setLocation(
                place.latitude,
                place.longitude,
                {
                  source: "place_search",
                  label: place.label
                }
              );
            }
          }
        );
      }
    );

    $("messageText").addEventListener(
      "input",
      () => {
        $("charCount").textContent =
          `${$("messageText").value.length} / 1000`;

        document.querySelectorAll(
          "[data-template]"
        ).forEach(
          (b) => b.classList.remove("active")
        );
      }
    );

    document.querySelectorAll(
      "[data-template]"
    ).forEach(
      (button) => {
        button.addEventListener(
          "click",
          () => {
            document.querySelectorAll(
              "[data-template]"
            ).forEach(
              (b) => b.classList.remove("active")
            );

            button.classList.add("active");

            $("messageText").value =
              examples[button.dataset.template] ||
              "";

            $("charCount").textContent =
              `${$("messageText").value.length} / 1000`;

            $("messageText").focus();
          }
        );
      }
    );

    document.addEventListener(
      "pointerdown",
      (event) => {
        if (
          !$("placeResults").contains(event.target) &&
          !$("placeSearchForm").contains(event.target)
        ) {
          $("placeResults").hidden = true;
        }
      }
    );

    $("messageForm").addEventListener(
      "submit",
      sendMessage
    );

    $("modeNote").textContent =
      CONFIG.API_BASE_URL
        ? "LINKO Supabase classroom demo · Message saved only when the database confirms it."
        : "LOCAL PREVIEW MODE · Intake not configured. No message will be stored online.";

    if (CONFIG.API_BASE_URL) {
      $("modeNote").classList.add("api-mode");
    }

    initOfflineMap();

    // Online map loads only on request.
    // The offline map always works first.
  }

  init();

})();

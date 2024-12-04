import { midToFlag } from "./flags.js";

const timestampIndicatorId = "timestamp-indicator";
const datetimePickerId = "datetime-picker";
const darkThemeClass = "dark-theme";
const darkTheme = "dark";
const lightTheme = "light";

// ##################
// Map Initialization
// ##################
const map = L.map("map", { minZoom: 12 })
  .setView([49.44, 2.83], 12)
  .setMaxBounds(L.latLngBounds(L.latLng(49.25, 2.6), L.latLng(49.55, 3.1)));

const layerGroup = L.layerGroup().addTo(map);

let intervalId = setInterval(updateMap, 30000);
let waybackMode = false;
let currentTheme = localStorage.getItem("mapTheme") || lightTheme;
let protomapLayer = createProtomapsLayer(currentTheme).addTo(map);
if (currentTheme == darkTheme) document.body.classList.add(darkThemeClass);

map.addControl(new L.Control.Fullscreen());
addThemeToggleControl();
addTimestampIndicator();
addCascadeButtons();
addDatetimePickerControl();

// ######################
// Function Definitions
// ######################

function createProtomapsLayer(theme) {
  return protomapsL.leafletLayer({
    url: "static/map.pmtiles",
    theme,
  });
}

function addThemeToggleControl() {
  const themeToggleControl = L.control({ position: "topleft" });
  themeToggleControl.onAdd = () => createToggleControl();
  themeToggleControl.addTo(map);
}

function createToggleControl() {
  const div = L.DomUtil.create("div", "leaflet-bar leaflet-control");
  const button = L.DomUtil.create("a", "", div);
  button.href = "#";
  button.title = "Toggle Light/Dark Theme";
  button.innerHTML = "🌓";
  button.style.cursor = "pointer";

  L.DomEvent.on(button, "click", (e) => {
    L.DomEvent.preventDefault(e);
    toggleTheme();
  });

  return div;
}

function toggleTheme() {
  currentTheme = currentTheme === darkTheme ? lightTheme : darkTheme;
  localStorage.setItem("mapTheme", currentTheme);

  document.body.classList.toggle(darkThemeClass);

  map.removeLayer(protomapLayer);
  protomapLayer = createProtomapsLayer(currentTheme).addTo(map);
}

function addDatetimePickerControl() {
  const waybackDatetimePicker = L.control({ position: "topright" });
  waybackDatetimePicker.onAdd = () => createDatetimePicker();
  waybackDatetimePicker.addTo(map);
}

function createDatetimePicker() {
  const div = L.DomUtil.create("div", "leaflet-bar leaflet-control");
  const datetimePicker = L.DomUtil.create("input", "", div);
  datetimePicker.type = "datetime-local";
  datetimePicker.id = datetimePickerId;
  datetimePicker.style.display = "none";
  datetimePicker.addEventListener("change", async (event) => {
    // Get the input value
    const datetimeInput = document.getElementById(datetimePickerId).value;

    // Convert the input to an epoch timestamp
    const epochTimestamp = new Date(datetimeInput).getTime() / 1000;

    if (isNaN(epochTimestamp)) {
      alert("Invalid date or time. Please select a valid datetime.");
      return;
    }

    updateMap(epochTimestamp, false);
    document.getElementById(timestampIndicatorId).innerText =
      `${timeAgo(epochTimestamp)}`;
  });
  return div;
}

function addCascadeButtons() {
  new L.cascadeButtons(
    [
      {
        icon: "fas fa-clock-rotate-left",
        command: toggleWaybackMode,
        items: createTimeTravelButtons(),
      },
    ],
    { position: "topright", direction: "vertical" },
  ).addTo(map);
}

function createTimeTravelButtons() {
  return [
    { icon: "fas fa-forward-fast", command: () => timeTravel(15) },
    { icon: "fas fa-forward-step", command: () => timeTravel(5) },
    { icon: "fas fa-backward-step", command: () => timeTravel(-5) },
    { icon: "fas fa-backward-fast", command: () => timeTravel(-15) },
  ];
}

function toggleWaybackMode() {
  waybackMode = !waybackMode;
  const datetimeElement = document.getElementById(datetimePickerId);
  datetimeElement.style.display = waybackMode ? "block" : "none";

  if (waybackMode) {
    clearInterval(intervalId);
    datetimeElement.value = dateToFullString(new Date());
    timeTravel(0);
  } else {
    updateMap();
    intervalId = setInterval(updateMap, 30000);
  }
}

function timeTravel(minutes) {
  const datetimeElement = document.getElementById(datetimePickerId);
  const newTime = new Date(
    new Date(datetimeElement.value).getTime() + minutes * 60000,
  );
  datetimeElement.value = dateToFullString(newTime);

  datetimeElement.dispatchEvent(
    new Event("change", { bubbles: true, cancelable: true }),
  );
}

function addTimestampIndicator() {
  const timeStampIndicator = L.control({ position: "topright" });
  timeStampIndicator.onAdd = () => {
    const div = L.DomUtil.create("div", "leaflet-bar leaflet-control");
    const indicator = L.DomUtil.create("div", "leaflet-control-div", div);
    indicator.id = timestampIndicatorId;
    indicator.innerText = "Fetching data…";
    return div;
  };
  timeStampIndicator.addTo(map);
}

// ######################
// Map Data Loading
// ######################

async function updateMap(tsMax, live = true) {
  const apiRoute = tsMax ? `/data?tsMax=${tsMax}` : `/data`;
  try {
    const response = await fetch(apiRoute).then((res) => res.json());
    const { positions, tracks, latestTs } = response;

    layerGroup.clearLayers();

    if (live) updateTimestampLive(latestTs);
    drawTracks(tracks);
    addShipMarkers(positions, live);
  } catch (error) {
    console.error("Error fetching data:", error);
  }
}

function updateTimestampLive(latestTs) {
  const minutesAgo = Math.floor((Date.now() - latestTs * 1000) / 60000);
  document.getElementById(timestampIndicatorId).innerText =
    `Latest ping: ${timeAgo(latestTs)}`;
}

function drawTracks(tracks) {
  Object.values(tracks).forEach((coordinates) => {
    if (coordinates.length > 1) {
      const latLngs = coordinates.map(([lat, lon]) => [lat, lon]);

      for (let i = 0; i < latLngs.length - 1; i++) {
        const opacity = 1 - i / (latLngs.length - 1); // Calculate fading opacity
        L.polyline([latLngs[i], latLngs[i + 1]], {
          color: "#F8591F",
          weight: 3,
          opacity,
        }).addTo(layerGroup);
      }
    }
  });
}

function addShipMarkers(positions, live) {
  positions.forEach((ship) => {
    const { mmsi, lat, lon, course, speed, shipname, mid } = ship;
    const marker = createShipMarker(lat, lon, course, speed);
    const popupText = createPopupText(ship, live);

    marker.addTo(layerGroup).bindPopup(popupText);
    if (shipname)
      marker
        .bindTooltip(`${midToFlag(mid)} ${shipname}`, {
          permanent: true,
          direction: "left",
        })
        .openTooltip();
  });
}

function createShipMarker(lat, lon, course, speed) {
  return course !== null && speed !== 0
    ? L.marker([lat, lon], {
        icon: L.divIcon({
          className: "arrow-icon",
          html: `<div style="transform: rotate(${course || 0}deg);"><img src="static/arrow_icon.svg">
</div>`,
          iconSize: [20, 20],
        }),
      })
    : L.circleMarker([lat, lon], {
        radius: 5,
        fillColor: "#F8591F",
        color: "#F8591F",
        fillOpacity: 0.8,
      });
}

function createPopupText(ship, live) {
  const {
    mmsi,
    shipname,
    speed,
    status,
    destination,
    destination_ts,
    ts,
    length,
    width,
    ship_type,
  } = ship;
  let popupText = `<b>${midToFlag(ship.mid)} ${shipname || "Unknown ship name"}</b><br/>`;
  popupText += `MMSI: <a href="https://www.marinetraffic.com/en/ais/details/ships/mmsi:${mmsi}" target="_blank" rel="noopener noreferrer">${mmsi}</a><br/>`;
  if (length)
    popupText += `${length} × ${width}m (${ship_type || "Unknown ship type"})<br/>`;
  if (destination)
    popupText += `Destination: ${destination} (${timeAgo(destination_ts)})<br/>`;
  if (speed) popupText += `Speed: ${speed} kts<br/>`;
  if (status && status !== "Undefined") popupText += `Status: ${status}<br/>`;
  popupText += `${timeAgo(ts)}`;
  return popupText;
}

// ######################
// Utility Functions
// ######################

function dateToTimeString(date) {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

function dateToFullString(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0"); // Months are zero-based
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}T${dateToTimeString(date)}`;
}

function timeAgo(timestampSeconds) {
  const minutes = Math.floor((new Date() - timestampSeconds * 1000) / 60000);
  if (minutes == 0) return `now`;
  if (minutes < 60) return `${minutes} minute${minutes > 1 ? "s" : ""} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24)
    return `${hours} hour${hours > 1 ? "s" : ""} ago (${dateToTimeString(new Date(timestampSeconds * 1000))})`;
  return dateToFullString(new Date(timestampSeconds * 1000)).replace("T", " ");
}

// Initial Map Update
updateMap();

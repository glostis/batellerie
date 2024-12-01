import { midToFlag } from "./flags.js";

// ##################
// Map Initialization
// ##################
const map = L.map("map").setView([49.44, 2.83], 12);

const layerGroup = L.layerGroup().addTo(map);

let intervalId = setInterval(updateMap, 30000);
let waybackMode = false;
let currentTheme = localStorage.getItem("mapTheme") || "light";
let protomapLayer = createProtomapsLayer(currentTheme).addTo(map);

map.addControl(new L.Control.Fullscreen());
addThemeToggleControl();
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
  currentTheme = currentTheme === "dark" ? "light" : "dark";
  localStorage.setItem("mapTheme", currentTheme);

  map.removeLayer(protomapLayer);
  protomapLayer = createProtomapsLayer(currentTheme).addTo(map);
}

function addDatetimePickerControl() {
  const waybackDatetimePicker = L.control({ position: "topleft" });
  waybackDatetimePicker.onAdd = () => createDatetimePicker();
  waybackDatetimePicker.addTo(map);
}

function createDatetimePicker() {
  const div = L.DomUtil.create("div", "leaflet-bar leaflet-control");
  const datetimePicker = L.DomUtil.create("input", "", div);
  datetimePicker.type = "datetime-local";
  datetimePicker.id = "datetime";
  datetimePicker.style.display = "none";
  datetimePicker.addEventListener("change", async (event) => {
    // Get the input value
    const datetimeInput = document.getElementById("datetime").value;

    // Convert the input to an epoch timestamp
    const epochTimestamp = new Date(datetimeInput).getTime() / 1000;

    if (isNaN(epochTimestamp)) {
      alert("Invalid date or time. Please select a valid datetime.");
      return;
    }

    updateMap(epochTimestamp, false);
    document.getElementById("timestamp").innerText =
      `Data from ${dateToFullString(new Date(epochTimestamp * 1000))}`;
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
    { position: "topleft", direction: "vertical" },
  ).addTo(map);
}

function createTimeTravelButtons() {
  return [
    { icon: "fas fa-backward-fast", command: () => timeTravel(-15) },
    { icon: "fas fa-backward-step", command: () => timeTravel(-5) },
    { icon: "fas fa-forward-step", command: () => timeTravel(5) },
    { icon: "fas fa-forward-fast", command: () => timeTravel(15) },
  ];
}

function toggleWaybackMode() {
  waybackMode = !waybackMode;
  const datetimeElement = document.getElementById("datetime");
  datetimeElement.style.display = waybackMode ? "block" : "none";

  if (waybackMode) {
    clearInterval(intervalId);
    console.log(dateToFullString(new Date()));
    datetimeElement.value = dateToFullString(new Date());
    timeTravel(0);
  } else {
    updateMap();
    intervalId = setInterval(updateMap, 30000);
  }
}

function timeTravel(minutes) {
  const datetimeElement = document.getElementById("datetime");
  const newTime = new Date(
    new Date(datetimeElement.value).getTime() + minutes * 60000,
  );
  datetimeElement.value = dateToFullString(newTime);

  datetimeElement.dispatchEvent(
    new Event("change", { bubbles: true, cancelable: true }),
  );
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
  document.getElementById("timestamp").innerText =
    `Latest ping: ${dateToTimeString(new Date(latestTs * 1000))} (${minutesAgo} minutes ago)`;
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
  const timeStr = live
    ? `${Math.floor((Date.now() - ts * 1000) / 60000)} minutes ago`
    : dateToFullString(new Date(ts * 1000));
  const destinationTsStr = live
    ? `${Math.floor((Date.now() - destination_ts * 1000) / 60000)} minutes ago`
    : dateToFullString(new Date(destination_ts * 1000));
  let popupText = `<b>${midToFlag(ship.mid)} ${shipname || "Unknown ship name"}</b><br/>`;
  popupText += `MMSI: <a href="https://www.marinetraffic.com/en/ais/details/ships/mmsi:${mmsi}" target="_blank" rel="noopener noreferrer">${mmsi}</a><br/>`;
  if (length)
    popupText += `${length} × ${width}m (${ship_type || "Unknown ship type"})<br/>`;
  if (destination)
    popupText += `Destination: ${destination} (${destinationTsStr})<br/>`;
  if (speed) popupText += `Speed: ${speed} kts<br/>`;
  if (status) popupText += `Status: ${status}<br/>`;
  popupText += `${timeStr}`;
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

// Initial Map Update
updateMap();

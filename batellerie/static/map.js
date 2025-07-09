import { midToFlag } from "./flags.js";

const timestampIndicatorId = "timestamp-indicator";
const datetimePickerId = "datetime-picker";
const darkThemeClass = "dark-theme";
const darkTheme = "dark";
const lightTheme = "light";

const startColor = hexToRgb("#241FF8");
const endColor = hexToRgb("#F8591F");

// ##################
// Map Initialization
// ##################
const map = L.map("map", { minZoom: 12 })
  .setView([49.44, 2.83], 12)
  .setMaxBounds(L.latLngBounds(L.latLng(49.15, 2.5), L.latLng(49.55, 3.1)));

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
    {
      icon: "fas fa-circle-right",
      title: "+1 day",
      command: () => dayChange(1),
    },
    {
      icon: "fas fa-forward-fast",
      title: "+15 minutes",
      command: () => timeTravelRelative(15),
    },
    {
      icon: "fas fa-forward-step",
      title: "+5 minutes",
      command: () => timeTravelRelative(5),
    },
    {
      icon: "fas fa-backward-step",
      title: "-5 minutes",
      command: () => timeTravelRelative(-5),
    },
    {
      icon: "fas fa-backward-fast",
      title: "-15 minutes",
      command: () => timeTravelRelative(-15),
    },
    {
      icon: "fas fa-circle-left",
      title: "-1 day",
      command: () => dayChange(-1),
    },
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

function timeTravelRelative(minutes) {
  const datetimeElement = document.getElementById(datetimePickerId);
  const newTime = new Date(
    new Date(datetimeElement.value).getTime() + minutes * 60000,
  );
  datetimeElement.value = dateToFullString(newTime);

  datetimeElement.dispatchEvent(
    new Event("change", { bubbles: true, cancelable: true }),
  );
  return newTime;
}

function dayChange(days) {
  let newTime = timeTravelRelative(days * 24 * 60);
  renderTripsTable(newTime);
}

function timeTravelAbsolute(ts) {
  const datetimeElement = document.getElementById(datetimePickerId);
  const newTime = new Date(ts * 1000);
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
  const apiRoute = tsMax ? `/data/map?tsMax=${tsMax}` : `/data/map`;
  try {
    const response = await fetch(apiRoute).then((res) => res.json());
    const { positions, tracks, tsMax, tsMin } = response;

    layerGroup.clearLayers();

    if (live) updateTimestampLive(tsMax);
    drawTracks(tracks, tsMax, tsMin);
    addShipMarkers(positions, tsMax, tsMin, live);
  } catch (error) {
    console.error("Error fetching data:", error);
  }
}

function updateTimestampLive(tsMax) {
  const minutesAgo = Math.floor((Date.now() - tsMax * 1000) / 60000);
  document.getElementById(timestampIndicatorId).innerText =
    `Latest ping: ${timeAgo(tsMax)}`;
}

function drawTracks(tracks, tsMax, tsMin) {
  Object.values(tracks).forEach((coordinates) => {
    if (coordinates.length > 1) {
      const latLngs = coordinates.map(([lat, lon, ts]) => [lat, lon]);
      const tss = coordinates.map(([lat, lon, ts]) => ts);

      for (let i = 0; i < latLngs.length - 1; i++) {
        const factor = (tss[i] - tsMin) / (tsMax - tsMin);
        const opacity = Math.max(factor, 0.05);
        const color = interpolateColor(startColor, endColor, factor);

        L.polyline([latLngs[i], latLngs[i + 1]], {
          color,
          weight: 3,
          opacity,
          lineCap: "butt",
          interactive: false,
        }).addTo(layerGroup);
      }
    }
  });
}

function addShipMarkers(positions, tsMax, tsMin, live) {
  positions.forEach((ship) => {
    const { mmsi, ts, lat, lon, course, speed, shipname, mid } = ship;
    const marker = createShipMarker(lat, lon, course, speed, ts, tsMax, tsMin);
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

function createShipMarker(lat, lon, course, speed, ts, tsMax, tsMin) {
  // Decreasing opacity and chaning color, depending on the freshness of the data
  const factor = (ts - tsMin) / (tsMax - tsMin);
  const opacity = Math.max(factor, 0.15);
  const color = interpolateColor(startColor, endColor, factor);
  return course !== null && speed !== 0
    ? L.marker([lat, lon], {
        icon: L.divIcon({
          className: "arrow-icon",
          html: `<div style="transform: rotate(${course || 0}deg); opacity: ${opacity}">
<svg version="1.0" width="20" height="20" viewBox="0 0 1280 1280" xmlns="http://www.w3.org/2000/svg" xmlns:svg="http://www.w3.org/2000/svg"><g transform="matrix(-0.1,0,0,0.1,1280.0495,0.09709988)" fill="${color}" stroke="none" id="g1"><path d="M 314,12790 C 119,12749 -21,12548 5,12345 11,12294 388,11534 3045,6220 5946,419 6081,151 6127,110 6188,56 6284,11 6358,4 c 118,-13 258,40 334,125 31,35 771,1508 3070,6106 2924,5849 3029,6062 3035,6126 15,173 -76,326 -237,403 -59,27 -74,30 -160,30 -79,-1 -104,-5 -150,-26 -30,-13 -1359,-894 -2953,-1956 L 6400,8880 3503,10812 c -1594,1062 -2923,1942 -2953,1956 -61,27 -168,37 -236,22 z" id="path1"/></g></svg>
</div>`,
          iconSize: [20, 20],
        }),
      })
    : L.circleMarker([lat, lon], {
        radius: 5,
        fillColor: color,
        stroke: false,
        fillOpacity: opacity,
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

function dateToDateString(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0"); // Months are zero-based
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateToFullString(date) {
  return `${dateToDateString(date)}T${dateToTimeString(date)}`;
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

function timeFormatter(row, cell, value, columnDef, dataContext) {
  return `${dateToTimeString(new Date(value * 1000))} - ${dateToTimeString(new Date((value + dataContext.duration) * 1000))}`;
}

function durationFormatter(row, cell, value, columnDef, dataContext) {
  let seconds = value;
  if (
    typeof seconds !== "number" ||
    isNaN(seconds) ||
    !Number.isInteger(seconds)
  ) {
    throw new Error("Input must be an integer");
  }

  if (seconds < 0) {
    throw new Error("Input must be a non-negative integer");
  }

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  // Pad the hours and minutes with leading zeros if necessary
  const paddedHours = hours.toString().padStart(2, "0");
  const paddedMinutes = minutes.toString().padStart(2, "0");

  return `${paddedHours}:${paddedMinutes}`;
}

function dimensionsFormatter(row, cell, value, columnDef, dataContext) {
  return `${dataContext.length} × ${dataContext.width}m`;
}

function interpolateColor(color1, color2, factor) {
  const result = color1.map((c, i) => Math.round(c + factor * (color2[i] - c)));
  return `rgb(${result[0]}, ${result[1]}, ${result[2]})`;
}

function hexToRgb(hex) {
  return hex.match(/\w\w/g).map((x) => parseInt(x, 16));
}

// Initial Map Update
updateMap();
renderTripsTable();

// Fetch data from Flask API
async function renderTripsTable(date) {
  if (date == null) date = Date.now();

  // Get today's date at midnight
  let tsMin = new Date(date);
  tsMin.setHours(0, 0, 0, 0);
  let tsMax = new Date(date);
  tsMax.setHours(23, 59, 59, 0);
  tsMin = Math.floor(tsMin.getTime() / 1000);
  tsMax = Math.floor(tsMax.getTime() / 1000);

  fetch(`/data/trips?tsMin=${tsMin}&tsMax=${tsMax}`)
    .then((response) => response.json())
    .then((data) => {
      const columns = [
        {
          id: "shipname",
          name: "Name",
          field: "shipname",
          sortable: true,
        },
        {
          id: "dimensions",
          name: "Dimensions",
          formatter: dimensionsFormatter,
        },
        {
          id: "timestamp",
          name: "Time",
          field: "min_ts",
          sortable: true,
          formatter: timeFormatter,
        },
        {
          id: "duration",
          name: "Duration",
          field: "duration",
          sortable: true,
          formatter: durationFormatter,
        },
      ];

      // SlickGrid options
      const options = {
        enableCellNavigation: true,
        editable: false,
        autoEdit: false,
        fullWidthRows: true,
        forceFitColumns: true,
      };

      // Create the SlickGrid instance
      const grid = new Slick.Grid("#tripsTable", data, columns, options);

      // Add sorting functionality
      grid.onSort.subscribe((e, args) => {
        const { sortCol, sortAsc } = args;
        data.sort((a, b) => {
          const aValue = a[sortCol.field];
          const bValue = b[sortCol.field];
          return (
            (aValue === bValue ? 0 : aValue > bValue ? 1 : -1) *
            (sortAsc ? 1 : -1)
          );
        });
        grid.invalidateAllRows();
        grid.render();
      });

      grid.onClick.subscribe(function (e, args) {
        var item = args.grid.getData()[args.row];
        timeTravelAbsolute(item.min_ts);
      });
    });
}

// Toggle table functionality
const toggleButton = document.getElementById("toggle-button");
const tripsContainer = document.getElementById("tripsContainer");

let tableVisible = false;

toggleButton.addEventListener("click", () => {
  tableVisible = !tableVisible;
  tripsContainer.style.bottom = tableVisible ? "0" : "-33%";
  toggleButton.textContent = tableVisible ? "⬇" : "⬆";
  if (tableVisible) {
    const button = document.querySelector(".fa-clock-rotate-left");
    if (!button.classList.contains("activeButton")) {
      button.click();
    }
  }
});

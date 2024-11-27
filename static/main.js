import { midToFlag } from "./flags.js";

// ##################
// Map initialisation
// ##################
const map = L.map("map").setView([49.44, 2.83], 12);

map.addControl(new L.Control.Fullscreen());

// Load protomaps basemap and handle theme
function createProtomapsLayer(theme) {
  return protomapsL.leafletLayer({
    url: "static/map.pmtiles",
    theme: theme,
  });
}
const savedTheme = localStorage.getItem("mapTheme") || "light";
let currentTheme = savedTheme;
let protomapLayer = createProtomapsLayer(currentTheme);
protomapLayer.addTo(map);

const themeToggleControl = L.control({ position: "topleft" });
themeToggleControl.onAdd = function () {
  const div = L.DomUtil.create("div", "leaflet-bar leaflet-control");
  const button = L.DomUtil.create("a", "", div);
  button.href = "#";
  button.title = "Toggle Light/Dark Theme";
  button.innerHTML = "🌓"; // Toggle icon
  button.style.cursor = "pointer";

  L.DomEvent.on(button, "click", function (e) {
    L.DomEvent.preventDefault(e);

    // Toggle the theme
    currentTheme = currentTheme === "dark" ? "light" : "dark";
    localStorage.setItem("mapTheme", currentTheme);

    // Remove the existing layer
    map.removeLayer(protomapLayer);

    // Add a new layer with the updated theme
    protomapLayer = createProtomapsLayer(currentTheme);
    protomapLayer.addTo(map);
  });

  return div;
};
themeToggleControl.addTo(map);

let waybackMode = false;
const waybackToggleControl = L.control({ position: "topleft" });
waybackToggleControl.onAdd = function () {
  const div = L.DomUtil.create("div", "leaflet-bar leaflet-control");

  // Toggle Button
  const button = L.DomUtil.create("a", "", div);
  button.href = "#";
  button.id = "wayback-button";
  button.title = "Wayback machine";
  button.style.cursor = "pointer";

  L.DomEvent.on(button, "click", function (e) {
    L.DomEvent.preventDefault(e);

    // Toggle the wayback mode
    waybackMode = waybackMode === false ? true : false;

    if (waybackMode == true) {
      document.getElementById("datetime").style.display = "block";
      clearInterval(intervalId);
    } else {
      document.getElementById("datetime").style.display = "none";
      updateMap();
      intervalId = setInterval(updateMap, 30000);
      const timestampDiv = document.getElementById("timestamp");
    }
  });
  return div;
};
waybackToggleControl.addTo(map);

const waybackDatetimePicker = L.control({ position: "topleft" });
waybackDatetimePicker.onAdd = function () {
  const div = L.DomUtil.create("div", "leaflet-bar leaflet-control");
  const datetimePicker = L.DomUtil.create("input", "", div);
  datetimePicker.type = "datetime-local";
  datetimePicker.id = "datetime";
  datetimePicker.style.display = "none";
  return div;
};
waybackDatetimePicker.addTo(map);

// ####################
// Load data to the map
// ####################

// Layer group to which markers and lines are added, to ease refreshing the data
const layerGroup = L.layerGroup().addTo(map);

async function timestampLive(latestTs) {
  const timestampDiv = document.getElementById("timestamp");
  const minutesAgo = Math.floor((Date.now() - latestTs * 1000) / 1000 / 60);
  const dt = new Date(latestTs * 1000);
  const pingHours = dt.getHours();
  const pingMinutes = dt.getMinutes();
  timestampDiv.innerText = `Latest ping: ${pingHours}:${pingMinutes < 10 ? "0" : ""}${pingMinutes} (${minutesAgo} minutes ago)`;
}

function dateToString(date) {
  const year = date.getFullYear();
  const month = date.getMonth() + 1; // Months are zero-based in JavaScript
  const day = date.getDate();
  const hours = date.getHours();
  const minutes = date.getMinutes();
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

export async function timestampWayback(ts) {
  const timestampDiv = document.getElementById("timestamp");
  const date = new Date(ts * 1000);
  timestampDiv.innerText = `Browsing data at ${dateToString(date)}`;
}

export async function updateMap(tsMax, live = true) {
  const apiRoute = tsMax !== undefined ? `/data?tsMax=${tsMax}` : `/data`;
  fetch(`${apiRoute}`)
    .then((response) => response.json())
    .then((response) => {
      const { positions, tracks, latestTs } = response;

      // Clear the existing layers
      layerGroup.clearLayers();

      // Update the timestamp display
      if (live == true) {
        timestampLive(latestTs);
      }

      // Add ship tracks
      Object.keys(tracks).forEach((mmsi) => {
        const coordinates = tracks[mmsi]; // List of (lat, lon) tuples

        // Convert to Leaflet-compatible format
        const latLngs = coordinates.map(([lat, lon]) => [lat, lon]);

        // Create a polyline for the MMSI
        for (let i = 0; i < latLngs.length - 1; i++) {
          const opacity = 1 - i / (latLngs.length - 1);

          // Create a segment from point i to point i+1
          const segment = L.polyline([latLngs[i], latLngs[i + 1]], {
            color: "#F8591F",
            weight: 3,
            opacity: opacity,
          }).addTo(layerGroup);
        }
      });

      // Add ship positions
      positions.forEach((item) => {
        const { mmsi, lat, lon, ts, course, speed, status, shipname, mid } =
          item;

        const shipMarker =
          course == null || speed == 0
            ? L.circleMarker([lat, lon], {
                radius: 5,
                fillColor: "#F8591F",
                color: "#F8591F",
                weight: 1,
                opacity: 1,
                fillOpacity: 0.8,
              })
            : L.marker([lat, lon], {
                icon: L.divIcon({
                  className: "arrow-icon",
                  html: `
                        <div style="transform: rotate(${course || 0}deg);">
                          <svg
                            version="1.0"
                            width="20"
                            height="20"
                            viewBox="0 0 1280 1280"
                            xmlns="http://www.w3.org/2000/svg"
                            xmlns:svg="http://www.w3.org/2000/svg"
                          >
                            <g
                              transform="matrix(-0.1,0,0,0.1,1280.0495,0.09709988)"
                              fill="#F8591F"
                              stroke="none"
                              id="g1"
                            >
                              <path
                                d="M 314,12790 C 119,12749 -21,12548 5,12345 11,12294 388,11534 3045,6220 5946,419 6081,151 6127,110 6188,56 6284,11 6358,4 c 118,-13 258,40 334,125 31,35 771,1508 3070,6106 2924,5849 3029,6062 3035,6126 15,173 -76,326 -237,403 -59,27 -74,30 -160,30 -79,-1 -104,-5 -150,-26 -30,-13 -1359,-894 -2953,-1956 L 6400,8880 3503,10812 c -1594,1062 -2923,1942 -2953,1956 -61,27 -168,37 -236,22 z"
                                id="path1"
                              />
                            </g>
                          </svg>
                        </div>
                      `,
                  iconSize: [20, 20],
                  tooltipAnchor: [-10, 0],
                }),
              });

        let popupText = `
          <b>${midToFlag(mid)} ${shipname || "Undefined name"}</b><br/>
          MMSI: <a href="https://www.marinetraffic.com/en/ais/details/ships/mmsi:${mmsi}" target="_blank" rel="noopener noreferrer">${mmsi}</a><br/>
          Speed: ${speed || "?"}kts<br/>
          ${status}<br/>
        `;

        if (live == true) {
          popupText =
            popupText +
            `${Math.floor((Date.now() - ts * 1000) / 1000 / 60)} minutes ago`;
        } else {
          const dt = new Date(ts * 1000);
          popupText = popupText + `${dateToString(dt)}`;
        }

        shipMarker.addTo(layerGroup).bindPopup(popupText);
        if (shipname) {
          shipMarker
            .bindTooltip(`${midToFlag(mid)} ${shipname}`, {
              permanent: true,
              direction: "left",
            })
            .openTooltip();
        }
      });
    })
    .catch((error) => console.error("Error fetching data:", error));
}

// Initial map update
updateMap();

// Refresh map every 30 seconds
let intervalId = setInterval(updateMap, 30000);

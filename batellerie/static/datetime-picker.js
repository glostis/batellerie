import { updateMap, timestampWayback } from "./main.js";

document
  .getElementById("datetime")
  .addEventListener("change", async (event) => {
    // Get the input value
    const datetimeInput = document.getElementById("datetime").value;

    // Convert the input to an epoch timestamp
    const epochTimestamp = new Date(datetimeInput).getTime() / 1000;

    if (isNaN(epochTimestamp)) {
      alert("Invalid date or time. Please select a valid datetime.");
      return;
    }

    updateMap(epochTimestamp, false);
    timestampWayback(epochTimestamp);
  });

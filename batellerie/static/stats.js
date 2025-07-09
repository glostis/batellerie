
// Fetch data from the Flask backend and populate the table
fetch('/data/stats')
    .then(response => response.json())
    .then(data => populateTable(data));

function populateTable(data) {
    const tableBody = document.getElementById('tableBody');
    tableBody.innerHTML = '';
    data.forEach(row => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${row.name}</td>
            <td>${row.speed}</td>
            <td>${row.status}</td>
        `;
        tableBody

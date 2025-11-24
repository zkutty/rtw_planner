// Global state
let map;
let currentOrigin = null;
let currentDate = null;
let selectedSegments = [];
let flightMarkers = [];
let routeLines = [];
let selectedRouteLines = [];
let hoverLine = null;
let hoverMarker = null;
let currentFlights = [];

// Initialize map
function initMap() {
    map = L.map('map').setView([30, 0], 2);
    
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 18
    }).addTo(map);
    
    // Load starting airports
    const startingAirports = document.getElementById('starting-airports').value.split(',').map(a => a.trim().toUpperCase());
    const startDate = document.getElementById('start-date').value;
    
    if (startingAirports.length > 0 && startDate) {
        loadFlightsFromAirport(startingAirports[0], startDate);
    }
}

// Load flights from an airport
async function loadFlightsFromAirport(origin, date) {
    currentOrigin = origin;
    currentDate = date;
    
    const dateRange = document.getElementById('date-range').value;
    const cabinFilter = document.getElementById('cabin-filter').value;
    
    try {
        const response = await fetch(`/api/flights?origin=${origin}&date=${date}&date_range=${dateRange}&cabin_class=${cabinFilter || ''}`);
        const data = await response.json();
        
        if (data.error) {
            showError(data.error);
            return;
        }
        
        displayFlights(data.flights, origin);
        displayFlightsOnMap(data.flights, origin);
    } catch (error) {
        console.error('Error loading flights:', error);
        showError('Failed to load flights');
    }
}

// Display flights in sidebar
function displayFlights(flights, origin) {
    const sidebar = document.getElementById('flight-sidebar');
    const flightList = document.getElementById('flight-list');
    
    sidebar.classList.add('open');
    
    if (flights.length === 0) {
        flightList.innerHTML = `
            <p class="empty-state">No flights found from ${origin}</p>
            <button class="btn btn-primary" onclick="expandDateRange()">Expand Date Range</button>
            <button class="btn btn-secondary" onclick="showNearbyAirports('${origin}')">Try Nearby Airports</button>
        `;
        return;
    }
    
    flightList.innerHTML = flights.map((flight, index) => {
        const isDirect = flight.is_direct;
        const numStops = flight.num_stops;
        const hasBusiness = flight.business_miles_int > 0;
        const hasEconomy = flight.economy_miles_int > 0;
        const cabinClass = hasBusiness ? 'Business' : 'Economy';
        const miles = hasBusiness ? flight.business_miles : flight.economy_miles;
        const carriers = hasBusiness ? flight.business_carriers : flight.economy_carriers;
        
        const dateObj = new Date(flight.date);
        const dateStr = dateObj.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
        const dateMarker = flight.date === currentDate ? '★' : ' ';
        
        return `
            <div class="flight-item" 
                 data-flight-index="${index}"
                 data-origin="${flight.origin}"
                 data-destination="${flight.destination}"
                 data-date="${flight.date}"
                 onmouseenter="highlightRoute('${flight.origin}', '${flight.destination}')"
                 onmouseleave="clearHighlight()"
                 onclick="selectFlight(${index}, '${flight.origin}', '${flight.destination}', '${flight.date}', ${flight.is_direct}, ${flight.num_stops}, ${flight.business_miles_int}, ${flight.economy_miles_int}, '${flight.business_carriers || ''}', '${flight.economy_carriers || ''}')">
                <div class="flight-header">
                    <div>
                        <span class="flight-route">${dateMarker} ${flight.origin} → ${flight.destination}</span>
                        <div class="flight-date">${dateStr}</div>
                    </div>
                    <div>
                        ${isDirect ? '<span class="flight-badge badge-direct">Direct</span>' : `<span class="flight-badge badge-stops">${numStops} stop${numStops > 1 ? 's' : ''}</span>`}
                        <span class="flight-badge badge-${cabinClass.toLowerCase()}">${cabinClass}</span>
                    </div>
                </div>
                <div class="flight-details">
                    ${flight.origin_name} → ${flight.destination_name}<br>
                    ${miles ? `${parseInt(miles).toLocaleString()} miles` : 'N/A'} • ${carriers || 'N/A'}
                </div>
            </div>
        `;
    }).join('');
}

// Display flights on map
async function displayFlightsOnMap(flights, origin) {
    // Clear only flight markers and lines (keep selected routes)
    clearFlightMarkers();
    currentFlights = flights;
    
    // Get coordinates for origin and all destinations
    const airports = [origin, ...flights.map(f => f.destination)];
    const uniqueAirports = [...new Set(airports)];
    
    try {
        const response = await fetch(`/api/airport-coords?${uniqueAirports.map(a => `airports=${a}`).join('&')}`);
        const coords = await response.json();
        
        // Add origin marker
        if (coords[origin]) {
            const originCoords = [coords[origin].lat, coords[origin].lon];
            const originMarker = L.marker(originCoords, {
                icon: L.divIcon({
                    className: 'origin-marker',
                    html: `<div style="background: #667eea; color: white; border-radius: 50%; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; font-weight: bold; border: 3px solid white; box-shadow: 0 2px 8px rgba(0,0,0,0.3);">${origin}</div>`,
                    iconSize: [30, 30],
                    iconAnchor: [15, 15]
                })
            }).addTo(map);
            
            originMarker.bindPopup(`<strong>${origin}</strong><br>${coords[origin].name}`);
            flightMarkers.push(originMarker);
        }
        
        // Add destination markers and lines
        flights.forEach(flight => {
            if (coords[flight.destination]) {
                const destCoords = [coords[flight.destination].lat, coords[flight.destination].lon];
                const originCoords = [coords[origin].lat, coords[origin].lon];
                
                // Create marker
                const marker = L.marker(destCoords, {
                    icon: L.divIcon({
                        className: 'destination-marker',
                        html: `<div style="background: #4CAF50; color: white; border-radius: 50%; width: 25px; height: 25px; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 0.7rem; border: 2px solid white; box-shadow: 0 2px 6px rgba(0,0,0,0.3);">${flight.destination}</div>`,
                        iconSize: [25, 25],
                        iconAnchor: [12, 12]
                    })
                }).addTo(map);
                
                const popupContent = `
                    <strong>${flight.destination}</strong><br>
                    ${coords[flight.destination].name}<br>
                    ${flight.is_direct ? 'Direct' : `${flight.num_stops} stop${flight.num_stops > 1 ? 's' : ''}`}<br>
                    ${flight.business_miles_int > 0 ? `Business: ${parseInt(flight.business_miles).toLocaleString()} miles` : `Economy: ${parseInt(flight.economy_miles).toLocaleString()} miles`}
                `;
                marker.bindPopup(popupContent);
                
                // Store flight data in marker
                marker._flightData = flight;
                marker._origin = origin;
                flightMarkers.push(marker);
                
                // Create line (will be shown on hover)
                const line = L.polyline([originCoords, destCoords], {
                    color: flight.is_direct ? '#4CAF50' : '#FF9800',
                    weight: 2,
                    opacity: 0.3,
                    dashArray: flight.is_direct ? null : '5, 5'
                });
                
                line._flightData = flight;
                line._origin = origin;
                routeLines.push({ line, marker, flight });
            }
        });
        
        // Fit map to show all markers and selected routes
        const allMarkers = [...flightMarkers];
        selectedRouteLines.forEach(({ line }) => {
            if (line.getLatLngs) {
                allMarkers.push(L.marker(line.getLatLngs()[0]));
                allMarkers.push(L.marker(line.getLatLngs()[line.getLatLngs().length - 1]));
            }
        });
        
        if (allMarkers.length > 0) {
            const group = new L.featureGroup(allMarkers);
            map.fitBounds(group.getBounds().pad(0.1));
        }
    } catch (error) {
        console.error('Error displaying flights on map:', error);
    }
}

// Highlight route on hover
function highlightRoute(origin, destination) {
    clearHighlight();
    
    const route = routeLines.find(r => 
        r.flight.origin === origin && r.flight.destination === destination
    );
    
    if (route && !route.line._isSelected) {
        route.line.setStyle({
            opacity: 0.8,
            weight: 4
        });
        route.line.addTo(map);
        hoverLine = route.line;
        
        // Highlight marker
        route.marker.setIcon(L.divIcon({
            className: 'destination-marker',
            html: `<div style="background: #667eea; color: white; border-radius: 50%; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 0.8rem; border: 3px solid white; box-shadow: 0 2px 8px rgba(0,0,0,0.4);">${destination}</div>`,
            iconSize: [30, 30],
            iconAnchor: [15, 15]
        }));
        hoverMarker = route.marker;
    }
}

// Clear highlight
function clearHighlight() {
    if (hoverLine) {
        hoverLine.setStyle({
            opacity: 0.3,
            weight: 2
        });
        hoverLine = null;
    }
    
    if (hoverMarker) {
        const flight = hoverMarker._flightData;
        hoverMarker.setIcon(L.divIcon({
            className: 'destination-marker',
            html: `<div style="background: #4CAF50; color: white; border-radius: 50%; width: 25px; height: 25px; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 0.7rem; border: 2px solid white; box-shadow: 0 2px 6px rgba(0,0,0,0.3);">${flight.destination}</div>`,
            iconSize: [25, 25],
            iconAnchor: [12, 12]
        }));
        hoverMarker = null;
    }
}

// Select a flight
async function selectFlight(index, origin, destination, date, isDirect, numStops, businessMiles, economyMiles, businessCarriers, economyCarriers) {
    // Get coordinates
    const coordsResponse = await fetch(`/api/airport-coords?airports=${origin}&airports=${destination}`);
    const coords = await coordsResponse.json();
    
    if (!coords[origin] || !coords[destination]) {
        showError('Could not get coordinates for airports');
        return;
    }
    
    const originCoords = [coords[origin].lat, coords[origin].lon];
    const destCoords = [coords[destination].lat, coords[destination].lon];
    
    // Calculate distance
    const distance = calculateDistance(originCoords, destCoords);
    
    // Add segment
    const segment = {
        segment: selectedSegments.length + 1,
        origin: origin,
        destination: destination,
        date: date,
        is_direct: isDirect,
        num_stops: numStops,
        business_miles_int: businessMiles,
        economy_miles_int: economyMiles,
        business_carriers: businessCarriers,
        economy_carriers: economyCarriers,
        cabin_class: businessMiles > 0 ? 'Business' : 'Economy',
        distance_miles: distance
    };
    
    selectedSegments.push(segment);
    
    // Draw selected route on map
    const selectedLine = L.polyline([originCoords, destCoords], {
        color: '#667eea',
        weight: 4,
        opacity: 0.8
    }).addTo(map);
    
    selectedLine._segmentIndex = selectedSegments.length - 1;
    selectedLine._isSelected = true;
    selectedRouteLines.push({ line: selectedLine, segment });
    
    // Update UI
    updateTripSummary();
    updateButtons();
    
    // Mark flight item as selected
    document.querySelectorAll('.flight-item').forEach(item => {
        item.classList.remove('selected');
    });
    document.querySelector(`[data-flight-index="${index}"]`)?.classList.add('selected');
    
    // Move to next airport
    setTimeout(() => {
        loadFlightsFromAirport(destination, date);
    }, 500);
}

// Calculate distance between two coordinates
function calculateDistance(coord1, coord2) {
    const R = 3958.8; // Earth radius in miles
    const lat1 = coord1[0] * Math.PI / 180;
    const lat2 = coord2[0] * Math.PI / 180;
    const dLat = (coord2[0] - coord1[0]) * Math.PI / 180;
    const dLon = (coord2[1] - coord1[1]) * Math.PI / 180;
    
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1) * Math.cos(lat2) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    
    return R * c;
}

// Update trip summary
function updateTripSummary() {
    const summaryDiv = document.getElementById('trip-summary');
    
    if (selectedSegments.length === 0) {
        summaryDiv.innerHTML = '<p class="empty-state">No segments selected yet</p>';
        return;
    }
    
    let totalDistance = 0;
    let totalBusinessMiles = 0;
    let totalEconomyMiles = 0;
    
    const segmentsHtml = selectedSegments.map((seg, index) => {
        totalDistance += seg.distance_miles;
        if (seg.business_miles_int > 0) totalBusinessMiles += seg.business_miles_int;
        if (seg.economy_miles_int > 0) totalEconomyMiles += seg.economy_miles_int;
        
        const dateObj = new Date(seg.date);
        const dateStr = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        
        return `
            <div class="trip-segment" data-segment-index="${index}">
                <div class="trip-segment-header">Segment ${seg.segment}: ${seg.origin} → ${seg.destination}</div>
                <div class="trip-segment-details">
                    ${dateStr} • ${seg.cabin_class} • ${seg.distance_miles.toFixed(0)} miles
                </div>
            </div>
        `;
    }).join('');
    
    const remainingMiles = 35000 - totalDistance;
    const remainingClass = remainingMiles >= 0 ? '' : 'validation-error';
    
    summaryDiv.innerHTML = segmentsHtml + `
        <div style="margin-top: 1rem; padding-top: 1rem; border-top: 1px solid #ddd;">
            <strong>Total Distance: ${totalDistance.toFixed(0)} miles</strong><br>
            <span class="${remainingClass}">Remaining: ${Math.abs(remainingMiles).toFixed(0)} miles ${remainingMiles < 0 ? 'OVER LIMIT' : ''}</span>
        </div>
    `;
}

// Update button states
function updateButtons() {
    document.getElementById('undo-btn').disabled = selectedSegments.length === 0;
    document.getElementById('clear-btn').disabled = selectedSegments.length === 0;
    document.getElementById('validate-btn').disabled = selectedSegments.length === 0;
}

// Undo last segment
function undoLast() {
    if (selectedSegments.length === 0) return;
    
    selectedSegments.pop();
    
    // Remove last selected line from map
    const lastSelected = selectedRouteLines.pop();
    if (lastSelected) {
        map.removeLayer(lastSelected.line);
    }
    
    updateTripSummary();
    updateButtons();
    
    // Reload flights from previous airport
    if (selectedSegments.length > 0) {
        const lastSeg = selectedSegments[selectedSegments.length - 1];
        loadFlightsFromAirport(lastSeg.destination, lastSeg.date);
    } else {
        // Back to start
        const startingAirports = document.getElementById('starting-airports').value.split(',').map(a => a.trim().toUpperCase());
        const startDate = document.getElementById('start-date').value;
        if (startingAirports.length > 0 && startDate) {
            loadFlightsFromAirport(startingAirports[0], startDate);
        }
    }
}

// Clear all segments
function clearAll() {
    if (confirm('Clear all segments?')) {
        selectedSegments = [];
        clearMap();
        updateTripSummary();
        updateButtons();
        
        // Reload starting flights
        const startingAirports = document.getElementById('starting-airports').value.split(',').map(a => a.trim().toUpperCase());
        const startDate = document.getElementById('start-date').value;
        if (startingAirports.length > 0 && startDate) {
            loadFlightsFromAirport(startingAirports[0], startDate);
        }
    }
}

// Clear flight markers (but keep selected routes)
function clearFlightMarkers() {
    flightMarkers.forEach(marker => map.removeLayer(marker));
    routeLines.forEach(({ line }) => {
        if (map.hasLayer(line)) {
            map.removeLayer(line);
        }
    });
    flightMarkers = [];
    routeLines = [];
    hoverLine = null;
    hoverMarker = null;
}

// Clear everything including selected routes
function clearMap() {
    clearFlightMarkers();
    selectedRouteLines.forEach(({ line }) => map.removeLayer(line));
    selectedRouteLines = [];
}

// Validate trip
async function validateTrip() {
    try {
        const response = await fetch('/api/validate-trip', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ segments: selectedSegments })
        });
        
        const validation = await response.json();
        
        // Display validation results
        const modal = document.getElementById('validation-modal');
        const resultsDiv = document.getElementById('validation-results');
        
        let html = '';
        if (validation.valid) {
            html += '<div class="validation-result validation-valid">✓ Trip is VALID for oneworld RTW ticket!</div>';
        } else {
            html += '<div class="validation-result validation-error">❌ Trip has validation errors:</div>';
            validation.errors.forEach(error => {
                html += `<div class="validation-error">• ${error}</div>`;
            });
        }
        
        if (validation.warnings && validation.warnings.length > 0) {
            html += '<div class="validation-result validation-warning">⚠️ Warnings:</div>';
            validation.warnings.forEach(warning => {
                html += `<div class="validation-warning">• ${warning}</div>`;
            });
        }
        
        html += '<div class="validation-summary">';
        html += `<div class="validation-summary-item">Total Segments: ${validation.num_segments}</div>`;
        html += `<div class="validation-summary-item">Continents: ${validation.num_continents} ${validation.continents_visited.join(', ')}</div>`;
        html += `<div class="validation-summary-item">Atlantic Crossed: ${validation.atlantic_crossed ? '✓' : '✗'}</div>`;
        html += `<div class="validation-summary-item">Pacific Crossed: ${validation.pacific_crossed ? '✓' : '✗'}</div>`;
        html += `<div class="validation-summary-item">Total Distance: ${validation.total_distance_miles.toFixed(0)} miles</div>`;
        html += `<div class="validation-summary-item">Total Days: ${validation.total_days}</div>`;
        html += '</div>';
        
        resultsDiv.innerHTML = html;
        modal.classList.add('show');
    } catch (error) {
        console.error('Error validating trip:', error);
        showError('Failed to validate trip');
    }
}

// Expand date range
function expandDateRange() {
    const dateRangeSelect = document.getElementById('date-range');
    if (dateRangeSelect.value === '2') {
        dateRangeSelect.value = '4';
        if (currentOrigin && currentDate) {
            loadFlightsFromAirport(currentOrigin, currentDate);
        }
    }
}

// Show nearby airports
async function showNearbyAirports(airport) {
    try {
        const response = await fetch(`/api/nearby-airports?airport=${airport}`);
        const data = await response.json();
        
        if (data.airports && data.airports.length > 0) {
            const list = data.airports.map((a, i) => 
                `<button class="btn btn-secondary" style="width: 100%; margin-bottom: 0.5rem;" onclick="loadFlightsFromAirport('${a.code}', '${currentDate}')">${a.code} (${a.name}) - ${a.distance} miles</button>`
            ).join('');
            
            document.getElementById('flight-list').innerHTML = `
                <h4>Nearby Airports:</h4>
                ${list}
            `;
        }
    } catch (error) {
        console.error('Error loading nearby airports:', error);
    }
}

// Show error
function showError(message) {
    alert(message); // Could be replaced with a better UI
}

// Event listeners
document.addEventListener('DOMContentLoaded', () => {
    initMap();
    
    // Starting airports change
    document.getElementById('starting-airports').addEventListener('change', (e) => {
        const airports = e.target.value.split(',').map(a => a.trim().toUpperCase());
        const startDate = document.getElementById('start-date').value;
        if (airports.length > 0 && startDate) {
            loadFlightsFromAirport(airports[0], startDate);
        }
    });
    
    // Start date change
    document.getElementById('start-date').addEventListener('change', (e) => {
        const startingAirports = document.getElementById('starting-airports').value.split(',').map(a => a.trim().toUpperCase());
        if (startingAirports.length > 0 && e.target.value) {
            loadFlightsFromAirport(startingAirports[0], e.target.value);
        }
    });
    
    // Date range change
    document.getElementById('date-range').addEventListener('change', () => {
        if (currentOrigin && currentDate) {
            loadFlightsFromAirport(currentOrigin, currentDate);
        }
    });
    
    // Cabin filter change
    document.getElementById('cabin-filter').addEventListener('change', () => {
        if (currentOrigin && currentDate) {
            loadFlightsFromAirport(currentOrigin, currentDate);
        }
    });
    
    // Buttons
    document.getElementById('undo-btn').addEventListener('click', undoLast);
    document.getElementById('clear-btn').addEventListener('click', clearAll);
    document.getElementById('validate-btn').addEventListener('click', validateTrip);
    document.getElementById('close-sidebar').addEventListener('click', () => {
        document.getElementById('flight-sidebar').classList.remove('open');
    });
    
    // Modal close
    document.querySelector('.close-modal').addEventListener('click', () => {
        document.getElementById('validation-modal').classList.remove('show');
    });
    
    document.getElementById('validation-modal').addEventListener('click', (e) => {
        if (e.target.id === 'validation-modal') {
            e.target.classList.remove('show');
        }
    });
});

// Make functions available globally
window.loadFlightsFromAirport = loadFlightsFromAirport;
window.highlightRoute = highlightRoute;
window.clearHighlight = clearHighlight;
window.selectFlight = selectFlight;
window.expandDateRange = expandDateRange;
window.showNearbyAirports = showNearbyAirports;
window.undoLast = undoLast;
window.clearAll = clearAll;
window.validateTrip = validateTrip;


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
let filteredDestination = null; // For filtering flights by destination

// Initialize map - show world view
function initMap() {
    map = L.map('map').setView([20, 0], 2);
    
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 18
    }).addTo(map);
    
    // Map is visible from the start - world view
}

// Zoom to airport
async function zoomToAirport(airportCode, zoomLevel = 6) {
    try {
        const response = await fetch(`/api/airport-coords?airports=${airportCode}`);
        const coords = await response.json();
        
        if (coords[airportCode] && coords[airportCode].lat !== 0 && coords[airportCode].lon !== 0) {
            const lat = coords[airportCode].lat;
            const lon = coords[airportCode].lon;
            map.flyTo([lat, lon], zoomLevel, {
                duration: 1.0
            });
            
            // Clear existing origin markers
            flightMarkers.forEach(m => {
                if (m._airportType === 'origin') {
                    map.removeLayer(m);
                }
            });
            flightMarkers = flightMarkers.filter(m => m._airportType !== 'origin');
            
            // Add a marker for the starting airport
            const marker = L.marker([lat, lon], {
                icon: L.divIcon({
                    className: 'origin-marker',
                    html: `<div style="background: #667eea; color: white; border-radius: 50%; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; font-weight: bold; border: 3px solid white; box-shadow: 0 2px 8px rgba(0,0,0,0.3);">${airportCode}</div>`,
                    iconSize: [30, 30],
                    iconAnchor: [15, 15]
                })
            }).addTo(map);
            
            marker._airportType = 'origin';
            marker.bindPopup(`<strong>${airportCode}</strong><br>${coords[airportCode].name}`);
            flightMarkers.push(marker);
        } else {
            console.warn(`No valid coordinates found for airport ${airportCode}`);
        }
    } catch (error) {
        console.error('Error zooming to airport:', error);
    }
}

// Load flights from an airport
async function loadFlightsFromAirport(origin, date) {
    currentOrigin = origin;
    currentDate = date;
    
    // Ensure map container is visible
    const mapContainer = document.querySelector('.map-container');
    if (mapContainer) {
        mapContainer.style.display = 'block';
        mapContainer.style.visibility = 'visible';
    }
    
    // Ensure map is visible and initialized
    if (map) {
        map.invalidateSize();
    }
    
    // Zoom to the starting airport first
    await zoomToAirport(origin, 6);
    
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
        
        // Ensure map is still visible after loading
        if (map) {
            map.invalidateSize();
        }
    } catch (error) {
        console.error('Error loading flights:', error);
        showError('Failed to load flights');
    }
}

// Filter flights by destination
function filterByDestination(destination) {
    filteredDestination = destination;
    const filtered = currentFlights.filter(f => f.destination === destination);
    displayFlights(filtered, currentOrigin, true);
    
    // Highlight the marker
    const marker = flightMarkers.find(m => m._destination === destination);
    if (marker) {
        marker.openPopup();
    }
}

// Clear destination filter
function clearDestinationFilter() {
    filteredDestination = null;
    displayFlights(currentFlights, currentOrigin, true);
}

// Display flights in sidebar
function displayFlights(flights, origin, keepSidebarOpen = false) {
    const sidebar = document.getElementById('flight-sidebar');
    const flightList = document.getElementById('flight-list');
    
    if (!keepSidebarOpen) {
        sidebar.classList.add('open');
    }
    
    if (flights.length === 0) {
        let message = `No flights found from ${origin}`;
        // Check if we're trying to return to starting airport
        if (startingAirports.length > 0 && startingAirports.includes(origin)) {
            message += `<br><small style="color: #666;">Note: Flights back to starting airports (${startingAirports.join(', ')}) should be available to complete your RTW trip.</small>`;
        }
        flightList.innerHTML = `
            <p class="empty-state">${message}</p>
            <button class="btn btn-primary" onclick="expandDateRange()">Expand Date Range</button>
            <button class="btn btn-secondary" onclick="showNearbyAirports('${origin}')">Try Nearby Airports</button>
        `;
        return;
    }
    
    // Add filter indicator if filtering by destination
    let headerHTML = '';
    if (filteredDestination) {
        headerHTML = `
            <div style="padding: 0.5rem; background: #f0f4ff; border-bottom: 1px solid #e0e0e0; display: flex; justify-content: space-between; align-items: center;">
                <span style="font-size: 0.85rem;">Filtered: <strong>${filteredDestination}</strong></span>
                <button onclick="clearDestinationFilter()" style="padding: 2px 8px; background: #667eea; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 0.75rem;">Clear</button>
            </div>
        `;
    }
    
    flightList.innerHTML = headerHTML + flights.map((flight, index) => {
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
        
        // Group flights by destination to determine best cabin class
        const flightsByDest = {};
        flights.forEach(flight => {
            const dest = flight.destination;
            if (!flightsByDest[dest]) {
                flightsByDest[dest] = [];
            }
            flightsByDest[dest].push(flight);
        });
        
        // Add destination markers and lines
        Object.keys(flightsByDest).forEach(dest => {
            const destFlights = flightsByDest[dest];
            // Find best cabin class available for this destination
            const hasBusiness = destFlights.some(f => f.business_miles_int > 0);
            const hasPremium = destFlights.some(f => f.premium_economy_miles_int > 0);
            const hasEconomy = destFlights.some(f => f.economy_miles_int > 0);
            
            // Determine marker color: Business (best) > Premium Economy > Economy (least)
            let markerColor, markerBgColor;
            if (hasBusiness) {
                markerColor = '#667eea'; // Purple/blue - most positive
                markerBgColor = '#667eea';
            } else if (hasPremium) {
                markerColor = '#4CAF50'; // Green - medium positive
                markerBgColor = '#4CAF50';
            } else if (hasEconomy) {
                markerColor = '#FF9800'; // Orange - least positive
                markerBgColor = '#FF9800';
            } else {
                markerColor = '#9E9E9E'; // Gray - no availability
                markerBgColor = '#9E9E9E';
            }
            
            if (coords[dest]) {
                const destCoords = [coords[dest].lat, coords[dest].lon];
                const originCoords = [coords[origin].lat, coords[origin].lon];
                
                // Use first flight for marker position and popup
                const firstFlight = destFlights[0];
                
                // Create marker with color based on cabin class
                const marker = L.marker(destCoords, {
                    icon: L.divIcon({
                        className: 'destination-marker',
                        html: `<div style="background: ${markerBgColor}; color: white; border-radius: 50%; width: 25px; height: 25px; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 0.7rem; border: 2px solid white; box-shadow: 0 2px 6px rgba(0,0,0,0.3);">${dest}</div>`,
                        iconSize: [25, 25],
                        iconAnchor: [12, 12]
                    })
                }).addTo(map);
                
                // Build popup with city/country and flight info
                const cabinInfo = [];
                if (hasBusiness) cabinInfo.push('Business');
                if (hasPremium) cabinInfo.push('Premium Economy');
                if (hasEconomy) cabinInfo.push('Economy');
                
                const popupContent = `
                    <strong>${dest}</strong><br>
                    ${coords[dest].name}<br>
                    <strong>Available Classes:</strong> ${cabinInfo.join(', ')}<br>
                    <strong>Flights:</strong> ${destFlights.length} option${destFlights.length > 1 ? 's' : ''}<br>
                    <button onclick="filterByDestination('${dest}')" style="margin-top: 8px; padding: 4px 8px; background: #667eea; color: white; border: none; border-radius: 4px; cursor: pointer;">View Flights</button>
                `;
                marker.bindPopup(popupContent);
                
                // Add tooltip with city/country name
                marker.bindTooltip(coords[dest].name, {
                    permanent: false,
                    direction: 'top',
                    offset: [0, -10]
                });
                
                // Store flight data in marker
                marker._flightData = destFlights;
                marker._destination = dest;
                marker._origin = origin;
                marker._cabinClass = hasBusiness ? 'business' : (hasPremium ? 'premium' : 'economy');
                
                // Add click handler to filter flights
                marker.on('click', function() {
                    filterByDestination(dest);
                });
                
                flightMarkers.push(marker);
                
                // Create lines for all flights to this destination
                destFlights.forEach(flight => {
                    // Calculate great circle path for shortest route
                    const path = getGreatCirclePath(originCoords, destCoords);
                    
                    // Create line (initially hidden, shown on hover)
                    const line = L.polyline(path, {
                        color: flight.is_direct ? markerColor : '#FF9800',
                        weight: 2,
                        opacity: 0,
                        dashArray: flight.is_direct ? null : '5, 5'
                    });
                    
                    // Add to map but keep invisible until hover
                    line.addTo(map);
                    
                    line._flightData = flight;
                    line._origin = origin;
                    routeLines.push({ line, marker, flight });
                });
            }
        });
        
        // Fit map to show all markers and selected routes, but don't zoom too much
        const allMarkers = [...flightMarkers];
        selectedRouteLines.forEach(({ line }) => {
            if (line.getLatLngs && line.getLatLngs().length > 0) {
                const latlngs = line.getLatLngs();
                if (latlngs[0]) allMarkers.push(L.marker(latlngs[0]));
                if (latlngs[latlngs.length - 1]) allMarkers.push(L.marker(latlngs[latlngs.length - 1]));
            }
        });
        
        if (allMarkers.length > 0) {
            const group = new L.featureGroup(allMarkers);
            const bounds = group.getBounds();
            // Only fit bounds if we have valid bounds and the map is visible
            if (bounds.isValid()) {
                map.fitBounds(bounds.pad(0.1), {
                    maxZoom: 8  // Don't zoom in too much, keep a wider view
                });
            }
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
        // Make line visible and prominent
        route.line.setStyle({
            opacity: 0.9,
            weight: 4
        });
        hoverLine = route.line;
        
        // Highlight marker (larger, purple)
        route.marker.setIcon(L.divIcon({
            className: 'destination-marker',
            html: `<div style="background: #667eea; color: white; border-radius: 50%; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 0.8rem; border: 3px solid white; box-shadow: 0 2px 8px rgba(0,0,0,0.4);">${destination}</div>`,
            iconSize: [30, 30],
            iconAnchor: [15, 15]
        }));
        hoverMarker = route.marker;
        
        // Ensure map is visible
        if (map && map.getContainer()) {
            map.getContainer().style.display = 'block';
        }
    }
}

// Clear highlight
function clearHighlight() {
    if (hoverLine) {
        // Hide the line again
        hoverLine.setStyle({
            opacity: 0,
            weight: 2
        });
        hoverLine = null;
    }
    
    if (hoverMarker) {
        // Restore original marker color based on cabin class
        const cabinClass = hoverMarker._cabinClass;
        let markerColor;
        if (cabinClass === 'business') {
            markerColor = '#667eea';
        } else if (cabinClass === 'premium') {
            markerColor = '#4CAF50';
        } else {
            markerColor = '#FF9800';
        }
        
        const dest = hoverMarker._destination || (Array.isArray(hoverMarker._flightData) ? hoverMarker._flightData[0]?.destination : hoverMarker._flightData?.destination);
        hoverMarker.setIcon(L.divIcon({
            className: 'destination-marker',
            html: `<div style="background: ${markerColor}; color: white; border-radius: 50%; width: 25px; height: 25px; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 0.7rem; border: 2px solid white; box-shadow: 0 2px 6px rgba(0,0,0,0.3);">${dest}</div>`,
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
    
    // Draw selected route on map using great circle path
    const selectedPath = getGreatCirclePath(originCoords, destCoords);
    const selectedLine = L.polyline(selectedPath, {
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
    
    // Show next flight planning section
    const nextFlightSection = document.getElementById('next-flight-section');
    if (nextFlightSection) {
        nextFlightSection.style.display = 'block';
    }
    
    // Calculate next flight date based on planning mode
    const planningMode = document.getElementById('planning-mode')?.value || 'days';
    let nextFlightDate = date;
    
    if (planningMode === 'days') {
        const daysToStay = parseInt(document.getElementById('days-to-stay')?.value || '3');
        const currentDate = new Date(date);
        currentDate.setDate(currentDate.getDate() + daysToStay);
        nextFlightDate = currentDate.toISOString().split('T')[0];
        
        // Update target date field for reference
        const targetDateInput = document.getElementById('target-date');
        if (targetDateInput) {
            targetDateInput.value = nextFlightDate;
        }
    } else {
        const targetDateInput = document.getElementById('target-date');
        if (targetDateInput && targetDateInput.value) {
            nextFlightDate = targetDateInput.value;
        } else {
            // If no target date set, default to 3 days
            const currentDate = new Date(date);
            currentDate.setDate(currentDate.getDate() + 3);
            nextFlightDate = currentDate.toISOString().split('T')[0];
            if (targetDateInput) {
                targetDateInput.value = nextFlightDate;
            }
        }
    }
    
    // Move to next airport
    setTimeout(() => {
        loadFlightsFromAirport(destination, nextFlightDate);
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

// Calculate great circle waypoints for shortest route
// This handles routes that cross the international date line or go the "wrong way"
function getGreatCirclePath(coord1, coord2) {
    const lat1 = coord1[0] * Math.PI / 180;
    const lon1 = coord1[1] * Math.PI / 180;
    const lat2 = coord2[0] * Math.PI / 180;
    const lon2 = coord2[1] * Math.PI / 180;
    
    // Calculate angular distance
    const d = Math.acos(
        Math.sin(lat1) * Math.sin(lat2) +
        Math.cos(lat1) * Math.cos(lat2) * Math.cos(lon2 - lon1)
    );
    
    // If distance is very small, just return the two points
    if (d < 0.01) {
        return [coord1, coord2];
    }
    
    // Calculate waypoints along the great circle
    const waypoints = [];
    const numPoints = Math.max(20, Math.ceil(d * 180 / Math.PI * 2)); // More points for longer routes
    
    for (let i = 0; i <= numPoints; i++) {
        const f = i / numPoints;
        
        const A = Math.sin((1 - f) * d) / Math.sin(d);
        const B = Math.sin(f * d) / Math.sin(d);
        
        const x = A * Math.cos(lat1) * Math.cos(lon1) + B * Math.cos(lat2) * Math.cos(lon2);
        const y = A * Math.cos(lat1) * Math.sin(lon1) + B * Math.cos(lat2) * Math.sin(lon2);
        const z = A * Math.sin(lat1) + B * Math.sin(lat2);
        
        const lat = Math.atan2(z, Math.sqrt(x * x + y * y)) * 180 / Math.PI;
        let lon = Math.atan2(y, x) * 180 / Math.PI;
        
        // Normalize longitude to [-180, 180]
        while (lon > 180) lon -= 360;
        while (lon < -180) lon += 360;
        
        waypoints.push([lat, lon]);
    }
    
    return waypoints;
}

// Update trip summary
async function updateTripSummary() {
    const summaryDiv = document.getElementById('trip-summary');
    const requirementsDiv = document.getElementById('trip-requirements');
    const requirementsStatus = document.getElementById('requirements-status');
    
    if (selectedSegments.length === 0) {
        summaryDiv.innerHTML = '<p class="empty-state">No segments selected yet</p>';
        if (requirementsDiv) requirementsDiv.style.display = 'none';
        return;
    }
    
    let totalDistance = 0;
    let totalBusinessMiles = 0;
    let totalEconomyMiles = 0;
    
        const segmentsHtml = selectedSegments.map((seg, index) => {
        totalDistance += seg.distance_miles || 0;
        if (seg.business_miles_int > 0) totalBusinessMiles += seg.business_miles_int;
        if (seg.economy_miles_int > 0) totalEconomyMiles += seg.economy_miles_int;
        
        const dateObj = new Date(seg.date);
        const dateStr = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        
        // Calculate days at destination (if not last segment)
        let daysAtDest = '';
        if (index < selectedSegments.length - 1) {
            const nextSeg = selectedSegments[index + 1];
            const arrivalDate = new Date(seg.date);
            const departureDate = new Date(nextSeg.date);
            const daysDiff = Math.round((departureDate - arrivalDate) / (1000 * 60 * 60 * 24));
            if (daysDiff >= 0) {
                daysAtDest = ` • ${daysDiff} day${daysDiff !== 1 ? 's' : ''} stay`;
            }
        }
        
        return `
            <div class="trip-segment" data-segment-index="${index}">
                <div class="trip-segment-header">Segment ${seg.segment}: ${seg.origin} → ${seg.destination}</div>
                <div class="trip-segment-details">
                    ${dateStr} • ${seg.cabin_class} • ${seg.distance_miles.toFixed(0)} miles${daysAtDest}
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
    
    // Validate trip and show requirements status
    if (requirementsDiv && requirementsStatus) {
        try {
            const response = await fetch('/api/validate-trip', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ segments: selectedSegments })
            });
            const validation = await response.json();
            
            if (!validation.error) {
                // Build requirements status HTML
                const requirementsHTML = `
                    <div style="margin-bottom: 0.5rem;">
                        <span style="color: ${validation.num_segments >= 3 && validation.num_segments <= 16 ? '#4CAF50' : '#f44336'};">
                            ${validation.num_segments >= 3 && validation.num_segments <= 16 ? '✓' : '✗'}
                        </span>
                        <strong>Segments:</strong> ${validation.num_segments} (min 3, max 16)
                    </div>
                    <div style="margin-bottom: 0.5rem;">
                        <span style="color: ${validation.atlantic_crossed ? '#4CAF50' : '#f44336'};">
                            ${validation.atlantic_crossed ? '✓' : '✗'}
                        </span>
                        <strong>Atlantic Crossing:</strong> ${validation.atlantic_crossed ? 'Yes' : 'No'}
                    </div>
                    <div style="margin-bottom: 0.5rem;">
                        <span style="color: ${validation.pacific_crossed ? '#4CAF50' : '#f44336'};">
                            ${validation.pacific_crossed ? '✓' : '✗'}
                        </span>
                        <strong>Pacific Crossing:</strong> ${validation.pacific_crossed ? 'Yes' : 'No'}
                    </div>
                    <div style="margin-bottom: 0.5rem;">
                        <span style="color: ${validation.num_continents >= 3 ? '#4CAF50' : '#FF9800'};">
                            ${validation.num_continents >= 3 ? '✓' : '○'}
                        </span>
                        <strong>Continents:</strong> ${validation.num_continents} (${validation.continents_visited.join(', ')})
                    </div>
                    <div style="margin-bottom: 0.5rem;">
                        <span style="color: ${validation.total_distance_miles < 35000 ? '#4CAF50' : '#f44336'};">
                            ${validation.total_distance_miles < 35000 ? '✓' : '✗'}
                        </span>
                        <strong>Distance:</strong> ${validation.total_distance_miles.toFixed(0)} / 35,000 miles
                    </div>
                    <div style="margin-bottom: 0.5rem;">
                        <span style="color: ${validation.errors.length === 0 || !validation.errors.some(e => e.includes('return to origin')) ? '#4CAF50' : '#f44336'};">
                            ${validation.errors.length === 0 || !validation.errors.some(e => e.includes('return to origin')) ? '✓' : '✗'}
                        </span>
                        <strong>Return to Origin:</strong> ${validation.errors.some(e => e.includes('return to origin')) ? 'No' : 'Yes'}
                    </div>
                    ${validation.errors.length > 0 ? `
                        <div style="margin-top: 0.5rem; padding: 0.5rem; background: #ffebee; border-radius: 4px; font-size: 0.75rem;">
                            <strong style="color: #f44336;">Errors:</strong>
                            ${validation.errors.map(e => `<div>• ${e}</div>`).join('')}
                        </div>
                    ` : ''}
                    ${validation.warnings.length > 0 ? `
                        <div style="margin-top: 0.5rem; padding: 0.5rem; background: #fff3e0; border-radius: 4px; font-size: 0.75rem;">
                            <strong style="color: #FF9800;">Warnings:</strong>
                            ${validation.warnings.map(w => `<div>• ${w}</div>`).join('')}
                        </div>
                    ` : ''}
                `;
                
                requirementsStatus.innerHTML = requirementsHTML;
                requirementsDiv.style.display = 'block';
            }
        } catch (error) {
            console.error('Error validating trip:', error);
        }
    }
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
        // Calculate next flight date based on planning mode
        const planningMode = document.getElementById('planning-mode')?.value || 'days';
        let nextFlightDate = lastSeg.date;
        
        if (planningMode === 'days') {
            const daysToStay = parseInt(document.getElementById('days-to-stay')?.value || '3');
            const currentDate = new Date(lastSeg.date);
            currentDate.setDate(currentDate.getDate() + daysToStay);
            nextFlightDate = currentDate.toISOString().split('T')[0];
        } else {
            const targetDate = document.getElementById('target-date')?.value;
            if (targetDate) {
                nextFlightDate = targetDate;
            }
        }
        
        loadFlightsFromAirport(lastSeg.destination, nextFlightDate);
    } else {
        // Back to start - hide next flight planning section
        const nextFlightSection = document.getElementById('next-flight-section');
        if (nextFlightSection) {
            nextFlightSection.style.display = 'none';
        }
        
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
        selectedRouteLines.forEach(({ line }) => {
            map.removeLayer(line);
        });
        selectedRouteLines = [];
        
        // Hide next flight planning section
        const nextFlightSection = document.getElementById('next-flight-section');
        if (nextFlightSection) {
            nextFlightSection.style.display = 'none';
        }
        
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
    
    // Load Flights button - zoom to airport and load flights
    document.getElementById('load-flights-btn').addEventListener('click', async () => {
        const airports = document.getElementById('starting-airports').value.split(',').map(a => a.trim().toUpperCase()).filter(a => a);
        const startDate = document.getElementById('start-date').value;
        if (airports.length > 0 && startDate) {
            // Store starting airports globally
            startingAirports = airports;
            // First zoom to the airport
            await zoomToAirport(airports[0], 6);
            // Then load flights
            loadFlightsFromAirport(airports[0], startDate);
        } else {
            showError('Please enter a starting airport and date');
        }
    });
    
    // Starting airports change - preview zoom when typing (optional)
    document.getElementById('starting-airports').addEventListener('blur', async (e) => {
        const airports = e.target.value.split(',').map(a => a.trim().toUpperCase()).filter(a => a);
        if (airports.length > 0) {
            await zoomToAirport(airports[0], 6);
        }
    });
    
    // Start date change - no auto-load, just update if flights are already loaded
    document.getElementById('start-date').addEventListener('change', (e) => {
        const startingAirports = document.getElementById('starting-airports').value.split(',').map(a => a.trim().toUpperCase()).filter(a => a);
        if (startingAirports.length > 0 && e.target.value && currentOrigin) {
            // Only reload if we already have flights loaded
            if (currentOrigin === startingAirports[0]) {
                loadFlightsFromAirport(startingAirports[0], e.target.value);
            }
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
    
    // Planning mode toggle
    const planningModeSelect = document.getElementById('planning-mode');
    const daysToStayGroup = document.getElementById('days-to-stay-group');
    const targetDateGroup = document.getElementById('target-date-group');
    
    if (planningModeSelect) {
        planningModeSelect.addEventListener('change', (e) => {
            if (e.target.value === 'days') {
                daysToStayGroup.style.display = 'block';
                targetDateGroup.style.display = 'none';
            } else {
                daysToStayGroup.style.display = 'none';
                targetDateGroup.style.display = 'block';
            }
        });
    }
    
    // Days to stay change - update next flight date if we have a current segment
    const daysToStayInput = document.getElementById('days-to-stay');
    if (daysToStayInput) {
        daysToStayInput.addEventListener('change', () => {
            if (selectedSegments.length > 0 && planningModeSelect?.value === 'days') {
                const lastSegment = selectedSegments[selectedSegments.length - 1];
                const daysToStay = parseInt(daysToStayInput.value || '3');
                const currentDate = new Date(lastSegment.date);
                currentDate.setDate(currentDate.getDate() + daysToStay);
                const nextFlightDate = currentDate.toISOString().split('T')[0];
                
                // Update target date field for reference
                const targetDateInput = document.getElementById('target-date');
                if (targetDateInput) {
                    targetDateInput.value = nextFlightDate;
                }
                
                // Reload flights with new date
                if (currentOrigin) {
                    currentDate = nextFlightDate;
                    loadFlightsFromAirport(currentOrigin, nextFlightDate);
                }
            }
        });
        
        // Also update on input (real-time)
        daysToStayInput.addEventListener('input', () => {
            if (selectedSegments.length > 0 && planningModeSelect?.value === 'days') {
                const lastSegment = selectedSegments[selectedSegments.length - 1];
                const daysToStay = parseInt(daysToStayInput.value || '3');
                const currentDate = new Date(lastSegment.date);
                currentDate.setDate(currentDate.getDate() + daysToStay);
                const nextFlightDate = currentDate.toISOString().split('T')[0];
                
                // Update target date field for reference
                const targetDateInput = document.getElementById('target-date');
                if (targetDateInput) {
                    targetDateInput.value = nextFlightDate;
                }
            }
        });
    }
    
    // Target date change - reload flights
    const targetDateInput = document.getElementById('target-date');
    if (targetDateInput) {
        targetDateInput.addEventListener('change', () => {
            if (selectedSegments.length > 0 && planningModeSelect?.value === 'date' && currentOrigin) {
                const nextFlightDate = targetDateInput.value;
                loadFlightsFromAirport(currentOrigin, nextFlightDate);
            }
        });
    }
    
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
window.filterByDestination = filterByDestination;
window.clearDestinationFilter = clearDestinationFilter;


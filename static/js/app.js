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
let currentHighlightedRoute = null; // Track currently highlighted route to avoid flickering
let hoverTimeout = null; // For debouncing hover events
let currentFlights = [];
let filteredDestination = null; // For filtering flights by destination
let mustVisitCities = []; // Array of airport codes that must be visited
let startDate = null; // Trip start date
let endDate = null; // Trip end date (return by)
let planningDirection = 'forward'; // 'forward' or 'backward'
let startingAirports = []; // Starting airports for the trip
let isLoadingFlights = false; // Flag to prevent multiple simultaneous flight loads
let isSelectingFlight = false; // Flag to prevent multiple simultaneous flight selections
let currentLoadAbortController = null; // AbortController for canceling in-flight requests

// Initialize map - show world view
function initMap() {
    map = L.map('map', {
        center: [20, 0],
        zoom: 2
    });
    
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

// Load flights from an airport (or TO an airport for backwards planning)
async function loadFlightsFromAirport(origin, date) {
    // Prevent concurrent loading operations
    if (isLoadingFlights) {
        // Cancel previous request if still loading
        if (currentLoadAbortController) {
            currentLoadAbortController.abort();
        }
    }
    
    // Set loading state
    isLoadingFlights = true;
    currentLoadAbortController = new AbortController();
    
    // Disable buttons during loading
    const loadBtn = document.getElementById('load-flights-btn');
    const undoBtn = document.getElementById('undo-btn');
    const clearBtn = document.getElementById('clear-btn');
    if (loadBtn) loadBtn.disabled = true;
    if (undoBtn) undoBtn.disabled = true;
    if (clearBtn) clearBtn.disabled = true;
    
    try {
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
        
        // Zoom to the airport first
        await zoomToAirport(origin, 6);
        
        const dateRange = document.getElementById('date-range').value;
        const cabinFilter = document.getElementById('cabin-filter').value;
        const direction = document.getElementById('planning-direction')?.value || 'forward';
        
        // Update global state
        planningDirection = direction;
        startDate = document.getElementById('start-date')?.value || null;
        endDate = document.getElementById('end-date')?.value || null;
        const mustVisitInput = document.getElementById('must-visit-cities')?.value || '';
        mustVisitCities = mustVisitInput.split(',').map(c => c.trim().toUpperCase()).filter(c => c);
        startingAirports = (document.getElementById('starting-airports')?.value || '').split(',').map(a => a.trim().toUpperCase()).filter(a => a);
        
        // Check if we're loading after a segment was selected (show up to 30 days, but not past end date)
        const isAfterSegmentSelection = selectedSegments.length > 0;
        
        // Calculate maximum search range - limit to end date if set
        let maxSearchRange = isAfterSegmentSelection ? 30 : parseInt(dateRange);
        if (endDate && isAfterSegmentSelection) {
            const endDateObj = new Date(endDate);
            const searchBaseDate = selectedSegments.length > 0 ? new Date(selectedSegments[selectedSegments.length - 1].date) : new Date(date);
            const daysUntilEnd = Math.ceil((endDateObj - searchBaseDate) / (1000 * 60 * 60 * 24));
            // Limit search range to not exceed end date
            if (daysUntilEnd < maxSearchRange) {
                maxSearchRange = Math.max(daysUntilEnd, 0); // Don't go negative
            }
        }
        const searchDateRange = maxSearchRange;
        
        // If loading after a segment, use the last segment's date as the base date
        // This ensures we don't search for flights before we arrive
        let searchDate = date;
        if (isAfterSegmentSelection && selectedSegments.length > 0) {
            const lastSegment = selectedSegments[selectedSegments.length - 1];
            // Use the last segment's date as the minimum date
            searchDate = lastSegment.date;
        }
        
        let response;
        if (direction === 'backward') {
            // For backwards planning, search for flights TO this airport
            response = await fetch(`/api/flights-to?destination=${origin}&date=${searchDate}&date_range=${searchDateRange}&cabin_class=${cabinFilter || ''}`, {
                signal: currentLoadAbortController.signal
            });
        } else {
            // Forward planning: flights FROM this airport
            // Always respect cabin filter
            response = await fetch(`/api/flights?origin=${origin}&date=${searchDate}&date_range=${searchDateRange}&cabin_class=${cabinFilter || ''}`, {
                signal: currentLoadAbortController.signal
            });
        }
        
        const data = await response.json();
        
        if (data.error) {
            showError(data.error);
            return;
        }
        
        let flights = data.flights;
        
        // If we're loading after a segment selection, filter out flights before the last segment's date
        if (isAfterSegmentSelection && selectedSegments.length > 0) {
            const lastSegment = selectedSegments[selectedSegments.length - 1];
            const lastSegmentDate = new Date(lastSegment.date);
            lastSegmentDate.setHours(0, 0, 0, 0); // Reset time to start of day
            
            flights = flights.filter(flight => {
                const flightDate = new Date(flight.date);
                flightDate.setHours(0, 0, 0, 0);
                // Only include flights on or after the last segment's date
                let isValid = flightDate >= lastSegmentDate;
                
                // Also filter out flights after the end date if one is set
                if (endDate && isValid) {
                    const endDateObj = new Date(endDate);
                    endDateObj.setHours(0, 0, 0, 0);
                    isValid = flightDate <= endDateObj;
                }
                
                return isValid;
            });
        } else if (endDate) {
            // Even for initial load, filter out flights after end date
            const endDateObj = new Date(endDate);
            endDateObj.setHours(0, 0, 0, 0);
            
            flights = flights.filter(flight => {
                const flightDate = new Date(flight.date);
                flightDate.setHours(0, 0, 0, 0);
                return flightDate <= endDateObj;
            });
        }
        
        // Filter out destinations that don't have flights available from arrival until end date
        if (isAfterSegmentSelection && selectedSegments.length > 0 && endDate) {
            const lastSegment = selectedSegments[selectedSegments.length - 1];
            const arrivalDate = new Date(lastSegment.date);
            arrivalDate.setHours(0, 0, 0, 0);
            const endDateObj = new Date(endDate);
            endDateObj.setHours(0, 0, 0, 0);
            
            // Get unique destinations from current flights
            const uniqueDestinations = [...new Set(flights.map(f => f.destination))];
            
            // Check each destination to see if it has flights available from arrival until end date
            const destinationsWithFutureFlights = new Set();
            const checkPromises = uniqueDestinations.map(async (dest) => {
                try {
                    // Check if destination has flights from arrival date until end date
                    // Use arrival date as the search base, and search up to end date
                    const daysUntilEnd = Math.ceil((endDateObj - arrivalDate) / (1000 * 60 * 60 * 24));
                    if (daysUntilEnd <= 0) return; // No time left
                    
                    const searchRange = Math.min(daysUntilEnd, 30); // Don't search more than 30 days
                    const arrivalDateStr = arrivalDate.toISOString().split('T')[0];
                    
                    const response = await fetch(`/api/airport-has-flights?airport=${dest}&start_date=${arrivalDateStr}`);
                    const data = await response.json();
                    
                    if (data.has_flights) {
                        // Double-check: get actual flights and verify they're within the date range
                        const flightsResponse = await fetch(`/api/flights?origin=${dest}&date=${arrivalDateStr}&date_range=${searchRange}&cabin_class=${cabinFilter || ''}`);
                        const flightsData = await flightsResponse.json();
                        
                        if (flightsData.flights && flightsData.flights.length > 0) {
                            // Check if any flights are within the valid date range
                            const hasValidFlights = flightsData.flights.some(f => {
                                const flightDate = new Date(f.date);
                                flightDate.setHours(0, 0, 0, 0);
                                return flightDate >= arrivalDate && flightDate <= endDateObj;
                            });
                            
                            if (hasValidFlights) {
                                destinationsWithFutureFlights.add(dest);
                            }
                        }
                    }
                } catch (error) {
                    console.error(`Error checking future flights for ${dest}:`, error);
                    // If check fails, include it anyway to be safe (don't filter out)
                    destinationsWithFutureFlights.add(dest);
                }
            });
            
            await Promise.all(checkPromises);
            
            // Filter flights to only show destinations that have future flights available
            flights = flights.filter(f => destinationsWithFutureFlights.has(f.destination));
        }
        
        // Filter for return flights if we're near the end date
        if (endDate) {
            const endDateObj = new Date(endDate);
            const currentDateObj = new Date(date);
            const daysUntilEnd = Math.ceil((endDateObj - currentDateObj) / (1000 * 60 * 60 * 24));
            
            if (direction === 'forward') {
                // Forward planning: prioritize flights to starting airports near end date
                if (daysUntilEnd <= 7 && daysUntilEnd >= -7) {
                    flights = flights.filter(f => {
                        const isReturnFlight = startingAirports.includes(f.destination);
                        if (isReturnFlight) {
                            // Check if flight date is close to end date
                            const flightDate = new Date(f.date);
                            const daysDiff = Math.abs(Math.ceil((endDateObj - flightDate) / (1000 * 60 * 60 * 24)));
                            return daysDiff <= parseInt(dateRange);
                        }
                        return true;
                    });
                    
                    // Sort: return flights first, then others
                    flights.sort((a, b) => {
                        const aIsReturn = startingAirports.includes(a.destination);
                        const bIsReturn = startingAirports.includes(b.destination);
                        if (aIsReturn && !bIsReturn) return -1;
                        if (!aIsReturn && bIsReturn) return 1;
                        return 0;
                    });
                }
            } else {
                // Backward planning: prioritize flights from starting airports near start date
                if (startDate) {
                    const startDateObj = new Date(startDate);
                    const daysFromStart = Math.ceil((currentDateObj - startDateObj) / (1000 * 60 * 60 * 24));
                    
                    if (daysFromStart <= 7 && daysFromStart >= -7) {
                        flights = flights.filter(f => {
                            const isFromStart = startingAirports.includes(f.origin);
                            if (isFromStart) {
                                // Check if flight date is close to start date
                                const flightDate = new Date(f.date);
                                const daysDiff = Math.abs(Math.ceil((startDateObj - flightDate) / (1000 * 60 * 60 * 24)));
                                return daysDiff <= parseInt(dateRange);
                            }
                            return true;
                        });
                        
                        // Sort: flights from start airports first
                        flights.sort((a, b) => {
                            const aFromStart = startingAirports.includes(a.origin);
                            const bFromStart = startingAirports.includes(b.origin);
                            if (aFromStart && !bFromStart) return -1;
                            if (!aFromStart && bFromStart) return 1;
                            return 0;
                        });
                    }
                }
            }
        }
        
        // Calculate target date range if we have a selected segment
        let targetDateRange = null;
        if (selectedSegments.length > 0 && isAfterSegmentSelection) {
            const lastSegment = selectedSegments[selectedSegments.length - 1];
            const lastSegmentDate = new Date(lastSegment.date);
            const planningMode = document.getElementById('planning-mode')?.value || 'days';
            const daysToStay = parseInt(document.getElementById('days-to-stay')?.value || '3');
            const dateRangeFilter = parseInt(document.getElementById('date-range')?.value || '2');
            
            let targetDate;
            if (planningMode === 'days') {
                targetDate = new Date(lastSegmentDate);
                targetDate.setDate(targetDate.getDate() + daysToStay);
            } else {
                const targetDateInput = document.getElementById('target-date');
                if (targetDateInput && targetDateInput.value) {
                    targetDate = new Date(targetDateInput.value);
                } else {
                    targetDate = new Date(lastSegmentDate);
                    targetDate.setDate(targetDate.getDate() + daysToStay);
                }
            }
            
            targetDateRange = {
                start: new Date(targetDate),
                end: new Date(targetDate)
            };
            targetDateRange.start.setDate(targetDateRange.start.getDate() - dateRangeFilter);
            targetDateRange.end.setDate(targetDateRange.end.getDate() + dateRangeFilter);
        }
        
        // Filter out destinations with no flights in next 30 days (only for initial load)
        if (!isAfterSegmentSelection) {
            // Get unique destinations
            const uniqueDestinations = [...new Set(flights.map(f => f.destination))];
            
            // Check each destination to see if it has flights in next 30 days
            const destinationsWithFlights = new Set();
            const checkPromises = uniqueDestinations.map(async (dest) => {
                try {
                    // Calculate a date 15 days from now to check
                    const checkDate = new Date(date);
                    checkDate.setDate(checkDate.getDate() + 15);
                    const checkDateStr = checkDate.toISOString().split('T')[0];
                    
                    const response = await fetch(`/api/airport-has-flights?airport=${dest}&start_date=${checkDateStr}`);
                    const data = await response.json();
                    if (data.has_flights) {
                        destinationsWithFlights.add(dest);
                    }
                } catch (error) {
                    console.error(`Error checking flights for ${dest}:`, error);
                    // If check fails, include it anyway to be safe
                    destinationsWithFlights.add(dest);
                }
            });
            
            await Promise.all(checkPromises);
            
            // Filter flights to only show destinations that have flights in next 30 days
            flights = flights.filter(f => destinationsWithFlights.has(f.destination));
        }
        
        // Highlight must-visit cities in the flight list
        displayFlights(flights, origin, false, direction, targetDateRange);
        displayFlightsOnMap(flights, origin, direction, targetDateRange);
        
        // Ensure map is still visible after loading
        if (map) {
            map.invalidateSize();
        }
    } catch (error) {
        console.error('Error loading flights:', error);
        showError('Failed to load flights');
    } finally {
        // Re-enable load button
        const loadBtn = document.getElementById('load-flights-btn');
        if (loadBtn) {
            loadBtn.disabled = false;
            loadBtn.textContent = 'Load Flights';
        }
        isLoadingFlights = false;
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
    // Recalculate target date range if needed
    let targetDateRange = null;
    if (selectedSegments.length > 0) {
        const lastSegment = selectedSegments[selectedSegments.length - 1];
        const lastSegmentDate = new Date(lastSegment.date);
        const planningMode = document.getElementById('planning-mode')?.value || 'days';
        const daysToStay = parseInt(document.getElementById('days-to-stay')?.value || '3');
        const dateRangeFilter = parseInt(document.getElementById('date-range')?.value || '2');
        
        let targetDate;
        if (planningMode === 'days') {
            targetDate = new Date(lastSegmentDate);
            targetDate.setDate(targetDate.getDate() + daysToStay);
        } else {
            const targetDateInput = document.getElementById('target-date');
            if (targetDateInput && targetDateInput.value) {
                targetDate = new Date(targetDateInput.value);
            } else {
                targetDate = new Date(lastSegmentDate);
                targetDate.setDate(targetDate.getDate() + daysToStay);
            }
        }
        
        targetDateRange = {
            start: new Date(targetDate),
            end: new Date(targetDate)
        };
        targetDateRange.start.setDate(targetDateRange.start.getDate() - dateRangeFilter);
        targetDateRange.end.setDate(targetDateRange.end.getDate() + dateRangeFilter);
    }
    displayFlights(currentFlights, currentOrigin, true, planningDirection, targetDateRange);
}

// Display flights in sidebar
function displayFlights(flights, origin, keepSidebarOpen = false, direction = 'forward', targetDateRange = null) {
    const sidebar = document.getElementById('flight-sidebar');
    const flightList = document.getElementById('flight-list');
    
    if (!keepSidebarOpen) {
        sidebar.classList.add('open');
    }
    
    if (flights.length === 0) {
        let message = direction === 'backward' ? `No flights found to ${origin}` : `No flights found from ${origin}`;
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
    
    // Add header with planning direction and filter indicator
    let headerHTML = '';
    if (targetDateRange) {
        headerHTML += `
            <div style="padding: 0.5rem; background: #e8f5e9; border-bottom: 1px solid #e0e0e0; font-size: 0.85rem;">
                <strong>Showing all flights for next 30 days.</strong> Flights within your "days to stay" range are highlighted with a green border.
            </div>
        `;
    }
    if (direction === 'backward') {
        headerHTML += `
            <div style="padding: 0.5rem; background: #fff3cd; border-bottom: 1px solid #e0e0e0; font-size: 0.85rem;">
                <strong>Planning Backwards:</strong> Select flights TO ${origin} (working back to start)
            </div>
        `;
    }
    if (filteredDestination) {
        headerHTML += `
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
        const hasPremium = flight.premium_economy_miles_int > 0;
        const hasEconomy = flight.economy_miles_int > 0;
        
        // Determine cabin class (prioritize Business > Premium > Economy)
        let cabinClass, miles, carriers;
        if (hasBusiness) {
            cabinClass = 'Business';
            miles = flight.business_miles;
            carriers = flight.business_carriers;
        } else if (hasPremium) {
            cabinClass = 'Premium Economy';
            miles = flight.premium_economy_miles;
            carriers = flight.premium_economy_carriers;
        } else if (hasEconomy) {
            cabinClass = 'Economy';
            miles = flight.economy_miles;
            carriers = flight.economy_carriers;
        } else {
            cabinClass = 'N/A';
            miles = 'N/A';
            carriers = 'N/A';
        }
        
        // Show all available cabin classes
        const availableClasses = [];
        if (hasBusiness) availableClasses.push('Business');
        if (hasPremium) availableClasses.push('Premium');
        if (hasEconomy) availableClasses.push('Economy');
        const classesDisplay = availableClasses.length > 1 ? ` (${availableClasses.join(', ')})` : '';
        
        const dateObj = new Date(flight.date);
        const dateStr = dateObj.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
        const dateMarker = flight.date === currentDate ? '★' : ' ';
        
        // For backwards planning, show origin as destination
        const displayOrigin = direction === 'backward' ? flight.destination : flight.origin;
        const displayDest = direction === 'backward' ? flight.origin : flight.destination;
        const displayOriginName = direction === 'backward' ? flight.destination_name : flight.origin_name;
        const displayDestName = direction === 'backward' ? flight.origin_name : flight.destination_name;
        
        // Check if destination (or origin for backwards) is a must-visit city
        const checkCity = direction === 'backward' ? flight.origin : flight.destination;
        const isMustVisit = mustVisitCities.includes(checkCity);
        const mustVisitBadge = isMustVisit ? '<span class="flight-badge" style="background: #FF6B6B; color: white;">Must Visit</span>' : '';
        
        // Check if flight is within target date range (for highlighting)
        let isWithinRange = false;
        if (targetDateRange) {
            const flightDate = new Date(flight.date);
            isWithinRange = flightDate >= targetDateRange.start && flightDate <= targetDateRange.end;
        }
        
        // Add border style for flights within range
        const borderStyle = isWithinRange ? 'border: 3px solid #4CAF50;' : '';
        const rangeIndicator = isWithinRange ? '<span style="color: #4CAF50; font-size: 0.75rem; margin-left: 0.5rem;">✓ In Range</span>' : '';
        
        return `
            <div class="flight-item" 
                 data-flight-index="${index}"
                 data-origin="${flight.origin}"
                 data-destination="${flight.destination}"
                 data-date="${flight.date}"
                 style="${borderStyle}"
                 onmouseenter="highlightRoute('${flight.origin}', '${flight.destination}')"
                 onmouseleave="clearHighlight()"
                 onclick="selectFlight(${index}, '${flight.origin}', '${flight.destination}', '${flight.date}', ${flight.is_direct}, ${flight.num_stops}, ${flight.business_miles_int || 0}, ${flight.premium_economy_miles_int || 0}, ${flight.economy_miles_int || 0}, '${(flight.business_carriers || '').replace(/'/g, "\\'")}', '${(flight.premium_economy_carriers || '').replace(/'/g, "\\'")}', '${(flight.economy_carriers || '').replace(/'/g, "\\'")}')">
                <div class="flight-header">
                    <div>
                        <span class="flight-route">${dateMarker} ${displayOrigin} → ${displayDest} ${mustVisitBadge}${rangeIndicator}</span>
                        <div class="flight-date">${dateStr}</div>
                    </div>
                    <div>
                        ${isDirect ? '<span class="flight-badge badge-direct">Direct</span>' : `<span class="flight-badge badge-stops">${numStops} stop${numStops > 1 ? 's' : ''}</span>`}
                        <span class="flight-badge badge-${cabinClass.toLowerCase().replace(' ', '-')}">${cabinClass}${classesDisplay}</span>
                    </div>
                </div>
                <div class="flight-details">
                    ${displayOriginName} → ${displayDestName}<br>
                    ${miles ? `${parseInt(miles).toLocaleString()} miles` : 'N/A'}<br>
                    <strong style="color: #667eea;">Airlines:</strong> ${carriers || 'N/A'}
                </div>
            </div>
        `;
    }).join('');
}

// Display flights on map
async function displayFlightsOnMap(flights, origin, direction = 'forward', targetDateRange = null) {
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
                
                // Check if any flights to this destination are within target date range
                let hasFlightsInRange = false;
                if (targetDateRange) {
                    hasFlightsInRange = destFlights.some(f => {
                        const flightDate = new Date(f.date);
                        return flightDate >= targetDateRange.start && flightDate <= targetDateRange.end;
                    });
                }
                
                // Add green border if flights are in range
                const borderColor = hasFlightsInRange ? '#4CAF50' : 'white';
                const borderWidth = hasFlightsInRange ? '4px' : '2px';
                
                // Create marker with color based on cabin class
                const originalIcon = L.divIcon({
                    className: 'destination-marker',
                    html: `<div style="background: ${markerBgColor}; color: white; border-radius: 50%; width: 25px; height: 25px; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 0.7rem; border: ${borderWidth} solid ${borderColor}; box-shadow: 0 2px 6px rgba(0,0,0,0.3);">${dest}</div>`,
                    iconSize: [25, 25],
                    iconAnchor: [12, 12]
                });
                
                const marker = L.marker(destCoords, {
                    icon: originalIcon
                }).addTo(map);
                
                // Store original icon for efficient restoration (prevents flickering)
                marker._originalIcon = originalIcon;
                // Store if in range for later reference
                marker._inRange = hasFlightsInRange;
                
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

// Highlight route on hover (with debouncing to prevent flickering)
function highlightRoute(origin, destination) {
    // Clear any pending hover timeout
    if (hoverTimeout) {
        clearTimeout(hoverTimeout);
        hoverTimeout = null;
    }
    
    // Check if we're already highlighting this route
    const routeKey = `${origin}-${destination}`;
    if (currentHighlightedRoute === routeKey) {
        return; // Already highlighting this route, no need to update
    }
    
    // Debounce the highlight to prevent rapid updates
    hoverTimeout = setTimeout(() => {
        const route = routeLines.find(r => 
            r.flight.origin === origin && r.flight.destination === destination
        );
        
        if (route && !route.line._isSelected) {
            // Only clear if we're highlighting a different route
            if (currentHighlightedRoute && currentHighlightedRoute !== routeKey) {
                clearHighlight();
            }
            
            // Use requestAnimationFrame for smoother updates
            requestAnimationFrame(() => {
                // Make line visible and prominent
                route.line.setStyle({
                    opacity: 0.9,
                    weight: 4
                });
                hoverLine = route.line;
                
                // Highlight marker (larger, purple) - only if we have original icon stored
                if (!route.marker._originalIcon) {
                    route.marker._originalIcon = route.marker.options.icon;
                }
                
                route.marker.setIcon(L.divIcon({
                    className: 'destination-marker',
                    html: `<div style="background: #667eea; color: white; border-radius: 50%; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 0.8rem; border: 3px solid white; box-shadow: 0 2px 8px rgba(0,0,0,0.4);">${destination}</div>`,
                    iconSize: [30, 30],
                    iconAnchor: [15, 15]
                }));
                hoverMarker = route.marker;
                currentHighlightedRoute = routeKey;
                
                // Ensure map is visible
                if (map && map.getContainer()) {
                    map.getContainer().style.display = 'block';
                }
            });
        }
        hoverTimeout = null;
    }, 50); // 50ms debounce delay
}

// Clear highlight (with debouncing to prevent flickering)
function clearHighlight() {
    // Clear any pending hover timeout
    if (hoverTimeout) {
        clearTimeout(hoverTimeout);
        hoverTimeout = null;
    }
    
    // Use requestAnimationFrame for smoother updates
    requestAnimationFrame(() => {
        if (hoverLine) {
            // Hide the line again
            hoverLine.setStyle({
                opacity: 0,
                weight: 2
            });
            hoverLine = null;
        }
        
        if (hoverMarker) {
            // Restore original marker - use stored original icon if available
            if (hoverMarker._originalIcon) {
                hoverMarker.setIcon(hoverMarker._originalIcon);
            } else {
                // Fallback: restore based on cabin class
                const cabinClass = hoverMarker._cabinClass;
                let markerColor;
                if (cabinClass === 'business') {
                    markerColor = '#667eea';
                } else if (cabinClass === 'premium') {
                    markerColor = '#4CAF50';
                } else if (cabinClass === 'economy') {
                    markerColor = '#FF9800';
                } else {
                    markerColor = '#9E9E9E';
                }
                
                const dest = hoverMarker._destination || (Array.isArray(hoverMarker._flightData) ? hoverMarker._flightData[0]?.destination : hoverMarker._flightData?.destination);
                const borderColor = hoverMarker._inRange ? '#4CAF50' : 'white';
                const borderWidth = hoverMarker._inRange ? '4px' : '2px';
                
                hoverMarker.setIcon(L.divIcon({
                    className: 'destination-marker',
                    html: `<div style="background: ${markerColor}; color: white; border-radius: 50%; width: 25px; height: 25px; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 0.7rem; border: ${borderWidth} solid ${borderColor}; box-shadow: 0 2px 6px rgba(0,0,0,0.3);">${dest}</div>`,
                    iconSize: [25, 25],
                    iconAnchor: [12, 12]
                }));
            }
            hoverMarker = null;
        }
        
        currentHighlightedRoute = null;
    });
}

// Redraw all selected routes as one continuous great circle path
async function redrawSelectedRoutes() {
    // Remove all existing selected route lines
    selectedRouteLines.forEach(({ line }) => {
        map.removeLayer(line);
    });
    selectedRouteLines = [];
    
    if (selectedSegments.length === 0) {
        return;
    }
    
    // Get all airport coordinates
    const airports = [];
    selectedSegments.forEach(seg => {
        if (!airports.includes(seg.origin)) airports.push(seg.origin);
        if (!airports.includes(seg.destination)) airports.push(seg.destination);
    });
    
    let coords = null;
    try {
        const coordsResponse = await fetch(`/api/airport-coords?${airports.map(a => `airports=${a}`).join('&')}`);
        coords = await coordsResponse.json();
        
        // Build continuous path by connecting all segments
        const allWaypoints = [];
        
        for (let i = 0; i < selectedSegments.length; i++) {
            const seg = selectedSegments[i];
            const originCoords = [coords[seg.origin].lat, coords[seg.origin].lon];
            const destCoords = [coords[seg.destination].lat, coords[seg.destination].lon];
            
            // Get great circle path for this segment
            const segmentPath = getGreatCirclePath(originCoords, destCoords);
            
            // Add waypoints (skip first point if not first segment to avoid duplicates)
            if (i === 0) {
                allWaypoints.push(...segmentPath);
            } else {
                // Skip first point to connect smoothly
                allWaypoints.push(...segmentPath.slice(1));
            }
        }
        
        // Draw as one continuous polyline
        const continuousLine = L.polyline(allWaypoints, {
            color: '#667eea',
            weight: 4,
            opacity: 0.8
        }).addTo(map);
        
        // Store reference to all segments
        selectedRouteLines.push({ 
            line: continuousLine, 
            segment: selectedSegments[selectedSegments.length - 1] 
        });
        
    } catch (error) {
        console.error('Error redrawing routes:', error);
        // Fallback: draw segments individually if we have coordinates
        if (coords) {
            selectedSegments.forEach(seg => {
                if (coords[seg.origin] && coords[seg.destination]) {
                    const originCoords = [coords[seg.origin].lat, coords[seg.origin].lon];
                    const destCoords = [coords[seg.destination].lat, coords[seg.destination].lon];
                    const path = getGreatCirclePath(originCoords, destCoords);
                    const line = L.polyline(path, {
                        color: '#667eea',
                        weight: 4,
                        opacity: 0.8
                    }).addTo(map);
                    selectedRouteLines.push({ line, segment: seg });
                }
            });
        }
    }
}

// Select a flight
async function selectFlight(index, origin, destination, date, isDirect, numStops, businessMiles, premiumEconomyMiles, economyMiles, businessCarriers, premiumEconomyCarriers, economyCarriers) {
    // Prevent multiple simultaneous selections
    if (isSelectingFlight) {
        console.log('Flight selection already in progress, skipping...');
        return;
    }
    
    isSelectingFlight = true;
    
    try {
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
    
    // Determine actual origin/destination based on planning direction
    let actualOrigin, actualDest;
    if (planningDirection === 'backward') {
        // For backwards planning, we're working from destination backwards
        // So the flight we selected is: origin -> destination
        // But in the trip, it should be: destination -> origin (reversed)
        actualOrigin = destination;
        actualDest = origin;
    } else {
        actualOrigin = origin;
        actualDest = destination;
    }
    
    // Determine cabin class (prioritize Business > Premium Economy > Economy)
    let cabinClass;
    if (businessMiles > 0) {
        cabinClass = 'Business';
    } else if (premiumEconomyMiles > 0) {
        cabinClass = 'Premium Economy';
    } else {
        cabinClass = 'Economy';
    }
    
    // Add segment
    const segment = {
        segment: selectedSegments.length + 1,
        origin: actualOrigin,
        destination: actualDest,
        date: date,
        is_direct: isDirect,
        num_stops: numStops,
        business_miles_int: businessMiles,
        premium_economy_miles_int: premiumEconomyMiles,
        economy_miles_int: economyMiles,
        business_carriers: businessCarriers,
        premium_economy_carriers: premiumEconomyCarriers,
        economy_carriers: economyCarriers,
        cabin_class: cabinClass,
        distance_miles: distance
    };
    
    // For backwards planning, prepend; for forward, append
    if (planningDirection === 'backward') {
        selectedSegments.unshift(segment);
        // Renumber segments
        selectedSegments.forEach((seg, i) => {
            seg.segment = i + 1;
        });
    } else {
        selectedSegments.push(segment);
    }
    
    console.log('=== FLIGHT SELECTED ===');
    console.log('Added segment:', segment);
    console.log('Total segments now:', selectedSegments.length);
    console.log('All segments:', JSON.stringify(selectedSegments.map(s => ({origin: s.origin, dest: s.destination, date: s.date}))));
    
    // Redraw all selected routes as one continuous great circle path
    redrawSelectedRoutes();
    
    // Update UI
    updateTripSummary();
    updateButtons();
    console.log('Buttons updated after flight selection, segments:', selectedSegments.length);
    
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
    
    // Calculate next flight date based on planning mode and direction
    const planningMode = document.getElementById('planning-mode')?.value || 'days';
    let nextFlightDate = date;
    let nextAirport;
    
    if (planningDirection === 'backward') {
        // For backwards planning, we go to the origin (where we came from)
        nextAirport = origin;
        
        if (planningMode === 'days') {
            const daysToStay = parseInt(document.getElementById('days-to-stay')?.value || '3');
            const currentDate = new Date(date);
            // For backwards, subtract days (going back in time)
            currentDate.setDate(currentDate.getDate() - daysToStay);
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
                // If no target date set, default to 3 days back
                const currentDate = new Date(date);
                currentDate.setDate(currentDate.getDate() - 3);
                nextFlightDate = currentDate.toISOString().split('T')[0];
                if (targetDateInput) {
                    targetDateInput.value = nextFlightDate;
                }
            }
        }
    } else {
        // Forward planning - go to destination
        nextAirport = destination;
        
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
    }
    
    // Check if we've reached the start/end
    const startingAirports = (document.getElementById('starting-airports')?.value || '').split(',').map(a => a.trim().toUpperCase()).filter(a => a);
    const isComplete = (planningDirection === 'forward' && startingAirports.includes(nextAirport)) ||
                       (planningDirection === 'backward' && startingAirports.includes(nextAirport));
    
    // Move to next airport (unless trip is complete)
    if (!isComplete) {
        setTimeout(() => {
            loadFlightsFromAirport(nextAirport, nextFlightDate);
        }, 500);
    } else {
        // Trip complete - hide next flight planning section
        const nextFlightSection = document.getElementById('next-flight-section');
        if (nextFlightSection) {
            nextFlightSection.style.display = 'none';
        }
    }
    } catch (error) {
        console.error('Error selecting flight:', error);
        showError('Failed to select flight');
    } finally {
        isSelectingFlight = false;
    }
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
        // Update buttons when no segments
        updateButtons();
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
        
        // Get airline information
        let airlineInfo = '';
        if (seg.business_carriers) {
            airlineInfo = seg.business_carriers;
        } else if (seg.premium_economy_carriers) {
            airlineInfo = seg.premium_economy_carriers;
        } else if (seg.economy_carriers) {
            airlineInfo = seg.economy_carriers;
        }
        
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
                <div class="trip-segment-header">
                    Segment ${seg.segment}: ${seg.origin} → ${seg.destination}
                    <button onclick="editSegmentDate(${index})" style="margin-left: 0.5rem; padding: 2px 6px; background: #667eea; color: white; border: none; border-radius: 3px; cursor: pointer; font-size: 0.7rem;">Edit Date</button>
                </div>
                <div class="trip-segment-details">
                    ${dateStr} • ${seg.cabin_class} • ${seg.distance_miles.toFixed(0)} miles${daysAtDest}<br>
                    ${airlineInfo ? `<small style="color: #666;">Airlines: ${airlineInfo}</small>` : ''}
                </div>
            </div>
        `;
    }).join('');
    
    const remainingMiles = 35000 - totalDistance;
    const remainingClass = remainingMiles >= 0 ? '' : 'validation-error';
    
    // Track must-visit cities
    const visitedAirports = new Set();
    selectedSegments.forEach(seg => {
        visitedAirports.add(seg.origin);
        visitedAirports.add(seg.destination);
    });
    
    const visitedMustVisit = mustVisitCities.filter(city => visitedAirports.has(city));
    const missingMustVisit = mustVisitCities.filter(city => !visitedAirports.has(city));
    
    let mustVisitHtml = '';
    if (mustVisitCities.length > 0) {
        mustVisitHtml = `
            <div style="margin-top: 0.75rem; padding-top: 0.75rem; border-top: 1px solid #eee;">
                <strong>Must-Visit Cities:</strong><br>
                ${visitedMustVisit.length > 0 ? 
                    `<span style="color: #4CAF50;">✓ Visited: ${visitedMustVisit.join(', ')}</span><br>` : ''}
                ${missingMustVisit.length > 0 ? 
                    `<span style="color: #f44336;">✗ Missing: ${missingMustVisit.join(', ')}</span>` : 
                    '<span style="color: #4CAF50;">✓ All must-visit cities included!</span>'}
            </div>
        `;
    }
    
    summaryDiv.innerHTML = segmentsHtml + `
        <div style="margin-top: 1rem; padding-top: 1rem; border-top: 1px solid #ddd;">
            <strong>Total Distance: ${totalDistance.toFixed(0)} miles</strong><br>
            <span class="${remainingClass}">Remaining: ${Math.abs(remainingMiles).toFixed(0)} miles ${remainingMiles < 0 ? 'OVER LIMIT' : ''}</span>
        </div>
        ${mustVisitHtml}
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
    const undoBtn = document.getElementById('undo-btn');
    const clearBtn = document.getElementById('clear-btn');
    const validateBtn = document.getElementById('validate-btn');
    
    const hasSegments = selectedSegments.length > 0;
    console.log('updateButtons called - segments:', selectedSegments.length, 'hasSegments:', hasSegments);
    
    if (undoBtn) {
        // Don't disable the button - just style it differently
        // This allows clicks to work even when visually "disabled"
        undoBtn.disabled = false; // Always allow clicks
        if (!hasSegments) {
            undoBtn.style.opacity = '0.5';
            undoBtn.style.cursor = 'not-allowed';
            undoBtn.title = 'No segments to undo';
        } else {
            undoBtn.style.opacity = '1';
            undoBtn.style.cursor = 'pointer';
            undoBtn.title = 'Undo last segment';
        }
        console.log('Undo button state updated - hasSegments:', hasSegments);
    }
    if (clearBtn) {
        clearBtn.disabled = !hasSegments;
    }
    if (validateBtn) {
        validateBtn.disabled = !hasSegments;
    }
}

// Undo last segment
function undoLast() {
    console.log('=== undoLast() CALLED ===');
    console.log('selectedSegments before:', selectedSegments.length, selectedSegments);
    
    // Check if there are segments to undo
    if (selectedSegments.length === 0) {
        console.log('No segments to undo - returning early');
        updateButtons();
        return;
    }
    
    try {
        // Remove the last segment
        const removedSegment = selectedSegments.pop();
        console.log('Removed segment:', removedSegment);
        console.log('Remaining segments:', selectedSegments.length, selectedSegments);
        
        // Remove the corresponding route line from map
        if (selectedRouteLines.length > 0) {
            const lastRoute = selectedRouteLines.pop();
            console.log('Removing route line:', lastRoute);
            if (lastRoute && lastRoute.line) {
                if (map.hasLayer(lastRoute.line)) {
                    map.removeLayer(lastRoute.line);
                    console.log('Route line removed from map');
                } else {
                    console.log('Route line not found on map');
                }
            }
        } else {
            console.log('No route lines to remove');
        }
        
        // Clear any hover highlights
        clearHighlight();
        
        // Redraw all remaining routes as one continuous path
        if (selectedSegments.length > 0) {
            console.log('Redrawing remaining routes');
            redrawSelectedRoutes();
        } else {
            console.log('No segments left - clearing all route lines');
            // Clear all route lines if no segments left
            selectedRouteLines.forEach(({ line }) => {
                if (map.hasLayer(line)) {
                    map.removeLayer(line);
                }
            });
            selectedRouteLines = [];
        }
        
        // Update UI
        console.log('Updating trip summary and buttons');
        updateTripSummary();
        updateButtons();
    
        // Reload flights from previous airport (use setTimeout to avoid blocking)
        setTimeout(() => {
            if (selectedSegments.length > 0) {
                const lastSeg = selectedSegments[selectedSegments.length - 1];
                console.log('Reloading flights from:', lastSeg.destination);
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
                console.log('No segments left - returning to start');
                // Back to start - hide next flight planning section
                const nextFlightSection = document.getElementById('next-flight-section');
                if (nextFlightSection) {
                    nextFlightSection.style.display = 'none';
                }
                
                // Clear the map
                clearFlightMarkers();
                
                const startingAirports = document.getElementById('starting-airports').value.split(',').map(a => a.trim().toUpperCase());
                const startDate = document.getElementById('start-date').value;
                if (startingAirports.length > 0 && startDate) {
                    loadFlightsFromAirport(startingAirports[0], startDate);
                }
            }
        }, 50);
    } catch (error) {
        console.error('Error in undoLast:', error);
        alert('Error undoing segment: ' + error.message);
    }
    
    console.log('=== undoLast() COMPLETE ===');
}

// Clear all segments
function clearAll() {
    if (isLoadingFlights || isSelectingFlight) return;
    if (confirm('Clear all segments?')) {
        // Disable button during operation
        const clearBtn = document.getElementById('clear-btn');
        if (clearBtn) clearBtn.disabled = true;
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
        
        // Re-enable button
        if (clearBtn) clearBtn.disabled = selectedSegments.length === 0;
    }
}

// Edit segment date
async function editSegmentDate(segmentIndex) {
    if (segmentIndex < 0 || segmentIndex >= selectedSegments.length) return;
    
    const segment = selectedSegments[segmentIndex];
    const currentDate = segment.date;
    
    // Prompt for new date
    const newDate = prompt(`Edit date for Segment ${segment.segment} (${segment.origin} → ${segment.destination}):\n\nCurrent date: ${currentDate}\n\nEnter new date (YYYY-MM-DD):`, currentDate);
    
    if (!newDate || newDate === currentDate) return;
    
    // Validate date format
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(newDate)) {
        showError('Invalid date format. Please use YYYY-MM-DD');
        return;
    }
    
    // Update segment date
    segment.date = newDate;
    
    // Recalculate days at destination for previous segment if exists
    if (segmentIndex > 0) {
        // Days calculation will be updated in trip summary
    }
    
    // Redraw routes and update summary
    redrawSelectedRoutes();
    updateTripSummary();
    
    // If this is the last segment, reload flights from that destination
    if (segmentIndex === selectedSegments.length - 1) {
        const planningMode = document.getElementById('planning-mode')?.value || 'days';
        const daysToStay = parseInt(document.getElementById('days-to-stay')?.value || '3');
        const nextDate = new Date(newDate);
        nextDate.setDate(nextDate.getDate() + daysToStay);
        const nextFlightDate = nextDate.toISOString().split('T')[0];
        loadFlightsFromAirport(segment.destination, nextFlightDate);
    }
}

// Clear flight markers (but keep selected routes)
function clearFlightMarkers() {
    // Clear any pending hover operations
    if (hoverTimeout) {
        clearTimeout(hoverTimeout);
        hoverTimeout = null;
    }
    
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
    currentHighlightedRoute = null;
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
        const direction = document.getElementById('planning-direction')?.value || 'forward';
        let date, dateLabel;
        
        if (direction === 'backward') {
            // For backwards planning, use end date (or start date as fallback)
            date = document.getElementById('end-date')?.value || document.getElementById('start-date')?.value;
            dateLabel = 'end date (or start date)';
        } else {
            // For forward planning, use start date
            date = document.getElementById('start-date')?.value;
            dateLabel = 'start date';
        }
        
        if (airports.length > 0 && date) {
            // Store starting airports globally
            startingAirports = airports;
            // First zoom to the airport
            await zoomToAirport(airports[0], 6);
            // Then load flights
            loadFlightsFromAirport(airports[0], date);
        } else {
            showError(`Please enter ${direction === 'backward' ? 'an ending' : 'a starting'} airport and ${dateLabel}`);
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
        const updateFlightsForDaysToStay = () => {
            if (selectedSegments.length > 0 && planningModeSelect?.value === 'days' && currentOrigin) {
                const lastSegment = selectedSegments[selectedSegments.length - 1];
                const daysToStay = parseInt(daysToStayInput.value || '3');
                const lastDate = new Date(lastSegment.date);
                lastDate.setDate(lastDate.getDate() + daysToStay);
                const nextFlightDate = lastDate.toISOString().split('T')[0];
                
                // Update target date field for reference
                const targetDateInput = document.getElementById('target-date');
                if (targetDateInput) {
                    targetDateInput.value = nextFlightDate;
                }
                
                // Update global currentDate and reload flights with new date
                // This will use the date-range filter (2 or 4 days) automatically
                loadFlightsFromAirport(currentOrigin, nextFlightDate);
            }
        };
        
        daysToStayInput.addEventListener('change', updateFlightsForDaysToStay);
        
        // Also update on input (real-time) - reload flights dynamically
        daysToStayInput.addEventListener('input', updateFlightsForDaysToStay);
    }
    
    // Target date change - reload flights
    const targetDateInput = document.getElementById('target-date');
    if (targetDateInput) {
        targetDateInput.addEventListener('change', () => {
            if (selectedSegments.length > 0 && planningModeSelect?.value === 'date' && currentOrigin) {
                const nextFlightDate = targetDateInput.value;
                // This will use the date-range filter (2 or 4 days) automatically
                loadFlightsFromAirport(currentOrigin, nextFlightDate);
            }
        });
        
        // Also update on input (real-time) - reload flights dynamically
        targetDateInput.addEventListener('input', () => {
            if (selectedSegments.length > 0 && planningModeSelect?.value === 'date' && currentOrigin) {
                const nextFlightDate = targetDateInput.value;
                // This will use the date-range filter (2 or 4 days) automatically
                loadFlightsFromAirport(currentOrigin, nextFlightDate);
            }
        });
    }
    
    // Buttons - Undo
    const undoBtn = document.getElementById('undo-btn');
    if (undoBtn) {
        // Remove any existing listeners by cloning
        const newUndoBtn = undoBtn.cloneNode(true);
        undoBtn.parentNode.replaceChild(newUndoBtn, undoBtn);
        
        // Add click listener - always allow clicks, check segments inside
        newUndoBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            
            console.log('=== UNDO BUTTON CLICKED ===');
            console.log('Selected segments:', selectedSegments.length);
            console.log('Segments array:', selectedSegments);
            
            // Check if we have segments to undo
            if (selectedSegments.length === 0) {
                console.log('No segments to undo');
                alert('No segments to undo');
                return;
            }
            
            console.log('Calling undoLast() with', selectedSegments.length, 'segments');
            try {
                undoLast();
            } catch (error) {
                console.error('Error calling undoLast:', error);
                alert('Error: ' + error.message);
            }
        }, { capture: true }); // Use capture phase to ensure it fires
        
        // Also add mousedown as backup
        newUndoBtn.addEventListener('mousedown', function(e) {
            if (selectedSegments.length > 0) {
                e.preventDefault();
                console.log('Undo button mousedown - calling undoLast');
                undoLast();
            }
        });
        
        console.log('Undo button event listeners attached to:', newUndoBtn);
    } else {
        console.error('Undo button not found!');
    }
    
    let clearClickTimeout = null;
    document.getElementById('clear-btn').addEventListener('click', () => {
        if (clearClickTimeout) clearTimeout(clearClickTimeout);
        clearClickTimeout = setTimeout(() => {
            clearAll();
            clearClickTimeout = null;
        }, 100);
    });
    
    let validateClickTimeout = null;
    document.getElementById('validate-btn').addEventListener('click', () => {
        if (validateClickTimeout) clearTimeout(validateClickTimeout);
        validateClickTimeout = setTimeout(() => {
            validateTrip();
            validateClickTimeout = null;
        }, 100);
    });
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
// Expose functions globally for onclick handlers
window.undoLast = undoLast;
window.selectedSegments = selectedSegments; // Make segments accessible globally for debugging
window.clearAll = clearAll;
window.validateTrip = validateTrip;
window.filterByDestination = filterByDestination;
window.clearDestinationFilter = clearDestinationFilter;
window.editSegmentDate = editSegmentDate;


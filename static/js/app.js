/**
 * RTW Trip Planner - Optimized Version
 * Consolidated state management, removed debug clutter, improved performance
 */

// =============================================================================
// STATE MANAGEMENT
// =============================================================================

// OneWorld Alliance airlines (IATA codes and names)
const ONEWORLD_AIRLINES = {
    codes: ['AS', 'AA', 'BA', 'CX', 'FJ', 'AY', 'IB', 'JL', 'MH', 'WY', 'QF', 'QR', 'AT', 'RJ', 'UL'],
    names: [
        'Alaska Airlines',
        'American Airlines',
        'British Airways',
        'Cathay Pacific',
        'Fiji Airways',
        'Finnair',
        'Iberia',
        'Japan Airlines',
        'Malaysia Airlines',
        'Oman Air',
        'Qantas',
        'Qatar Airways',
        'Royal Air Maroc',
        'Royal Jordanian',
        'SriLankan Airlines'
    ]
};

const AppState = {
    // Map state
    map: null,
    
    // Current search state
    currentOrigin: null,
    currentDate: null,
    currentFlights: [],
    filteredDestination: null,
    
    // Trip state
    selectedSegments: [],
    selectedRouteLines: [],
    
    // Marker/line state
    flightMarkers: [],
    routeLines: [],
    hoverLine: null,
    hoverMarker: null,
    currentHighlightedRoute: null,
    
    // UI state
    hoverTimeout: null,
    isLoadingFlights: false,
    isSelectingFlight: false,
    currentLoadAbortController: null,
    
    // Trip constraints
    mustVisitCities: [],
    startDate: null,
    endDate: null,
    planningDirection: 'forward',
    startingAirports: [],
    
    // Cache for API responses
    airportCoordsCache: {},
    flightCheckCache: {},
    
    // Filtering state
    allFlights: [],  // Unfiltered flights
    airportContinents: {}  // Cache for airport continent data
};

// Expose for backwards compatibility and debugging
window.selectedSegments = AppState.selectedSegments;

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Calculate great-circle distance between two coordinates (Haversine formula)
 */
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

/**
 * Calculate great circle waypoints for shortest route visualization
 */
function getGreatCirclePath(coord1, coord2) {
    const lat1 = coord1[0] * Math.PI / 180;
    const lon1 = coord1[1] * Math.PI / 180;
    const lat2 = coord2[0] * Math.PI / 180;
    const lon2 = coord2[1] * Math.PI / 180;
    
    const d = Math.acos(
        Math.sin(lat1) * Math.sin(lat2) +
        Math.cos(lat1) * Math.cos(lat2) * Math.cos(lon2 - lon1)
    );
    
    if (d < 0.01) return [coord1, coord2];
    
    const waypoints = [];
    const numPoints = Math.max(20, Math.ceil(d * 180 / Math.PI * 2));
    
    for (let i = 0; i <= numPoints; i++) {
        const f = i / numPoints;
        const A = Math.sin((1 - f) * d) / Math.sin(d);
        const B = Math.sin(f * d) / Math.sin(d);
        
        const x = A * Math.cos(lat1) * Math.cos(lon1) + B * Math.cos(lat2) * Math.cos(lon2);
        const y = A * Math.cos(lat1) * Math.sin(lon1) + B * Math.cos(lat2) * Math.sin(lon2);
        const z = A * Math.sin(lat1) + B * Math.sin(lat2);
        
        const lat = Math.atan2(z, Math.sqrt(x * x + y * y)) * 180 / Math.PI;
        let lon = Math.atan2(y, x) * 180 / Math.PI;
        
        while (lon > 180) lon -= 360;
        while (lon < -180) lon += 360;
        
        waypoints.push([lat, lon]);
    }
    
    return waypoints;
}

/**
 * Calculate target date range for flight filtering
 */
function calculateTargetDateRange() {
    if (AppState.selectedSegments.length === 0) return null;
    
    const lastSegment = AppState.selectedSegments[AppState.selectedSegments.length - 1];
    const lastSegmentDate = new Date(lastSegment.date);
    const planningMode = document.getElementById('planning-mode')?.value || 'days';
    const daysToStay = parseInt(document.getElementById('days-to-stay')?.value || '3');
    const dateRangeFilter = parseInt(document.getElementById('date-range')?.value || '2');
    const isBackward = AppState.planningDirection === 'backward';
    
    let targetDate;
    if (planningMode === 'days') {
        targetDate = new Date(lastSegmentDate);
        // Backward: subtract days (we need flights BEFORE the selected date)
        // Forward: add days (we need flights AFTER the selected date)
        targetDate.setDate(targetDate.getDate() + (isBackward ? -daysToStay : daysToStay));
    } else {
        const targetDateInput = document.getElementById('target-date');
        const daysOffset = isBackward ? -daysToStay : daysToStay;
        targetDate = (targetDateInput?.value) 
            ? new Date(targetDateInput.value) 
            : new Date(lastSegmentDate.getTime() + daysOffset * 24 * 60 * 60 * 1000);
    }
    
    return {
        start: new Date(targetDate.getTime() - dateRangeFilter * 24 * 60 * 60 * 1000),
        end: new Date(targetDate.getTime() + dateRangeFilter * 24 * 60 * 60 * 1000)
    };
}

/**
 * Simple debounce utility
 */
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

/**
 * Format date for display
 */
function formatDate(dateStr) {
    return new Date(dateStr).toLocaleDateString('en-US', { 
        weekday: 'short', month: 'short', day: 'numeric' 
    });
}

/**
 * Check if a flight is operated by OneWorld airlines
 * Returns true if any carrier in the flight is a OneWorld airline
 */
function isOneWorldFlight(flight) {
    // Check all carrier fields (business, premium economy, economy)
    const carriers = [
        flight.business_carriers || '',
        flight.premium_economy_carriers || '',
        flight.economy_carriers || ''
    ].filter(c => c && c.trim());
    
    if (carriers.length === 0) {
        // If no carriers specified, exclude for safety (can't verify)
        return false;
    }
    
    // Combine all carrier strings and normalize to lowercase for comparison
    const carriersString = carriers.join(' ').toLowerCase();
    
    // Check for OneWorld airline names (full names)
    for (const name of ONEWORLD_AIRLINES.names) {
        if (carriersString.includes(name.toLowerCase())) {
            return true;
        }
    }
    
    // Check for OneWorld airline codes (2-letter IATA codes)
    // Use word boundaries to match codes as whole words (avoid false positives like "AA" in "CAA")
    for (const code of ONEWORLD_AIRLINES.codes) {
        // Match code as whole word - word boundary ensures it's not part of another word
        const codePattern = new RegExp(`\\b${code}\\b`, 'i');
        if (codePattern.test(carriersString)) {
            return true;
        }
    }
    
    // Also check for common airline name variations/keywords
    const keyTerms = [
        'qantas', 'american airlines', 'british airways', 'cathay pacific',
        'japan airlines', 'qatar airways', 'malaysia airlines', 'iberia',
        'finnair', 'royal jordanian', 'royal air maroc', 'srilankan',
        'oman air', 'fiji airways', 'alaska airlines'
    ];
    
    for (const term of keyTerms) {
        if (carriersString.includes(term.toLowerCase())) {
            return true;
        }
    }
    
    return false;
}

/**
 * Filter flights to only include OneWorld airlines
 */
function filterOneWorldFlights(flights) {
    return flights.filter(flight => isOneWorldFlight(flight));
}

/**
 * Show error message
 */
function showError(message) {
    alert(message);
}

/**
 * Get airport coordinates (with caching)
 */
async function getAirportCoords(airports) {
    const uncached = airports.filter(a => !AppState.airportCoordsCache[a]);
    
    if (uncached.length > 0) {
        try {
            const response = await fetch(`/api/airport-coords?${uncached.map(a => `airports=${a}`).join('&')}`);
            const coords = await response.json();
            Object.assign(AppState.airportCoordsCache, coords);
        } catch (error) {
            console.error('Error fetching coordinates:', error);
        }
    }
    
    const result = {};
    airports.forEach(a => {
        result[a] = AppState.airportCoordsCache[a] || { lat: 0, lon: 0, name: a };
    });
    return result;
}

// =============================================================================
// MAP FUNCTIONS
// =============================================================================

function initMap() {
    AppState.map = L.map('map', {
        center: [20, 0],
        zoom: 2
    });
    
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 18
    }).addTo(AppState.map);
}

async function zoomToAirport(airportCode, zoomLevel = 6, shouldZoom = true) {
    try {
        const coords = await getAirportCoords([airportCode]);
        
        if (coords[airportCode]?.lat !== 0) {
            const { lat, lon, name } = coords[airportCode];
            if (shouldZoom) {
                AppState.map.flyTo([lat, lon], zoomLevel, { duration: 1.0 });
            }
            
            // Clear existing origin markers
            AppState.flightMarkers = AppState.flightMarkers.filter(m => {
                if (m._airportType === 'origin') {
                    AppState.map.removeLayer(m);
                    return false;
                }
                return true;
            });
            
            // Add origin marker
            const marker = L.marker([lat, lon], {
                icon: L.divIcon({
                    className: 'origin-marker',
                    html: `<div style="background: #667eea; color: white; border-radius: 50%; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; font-weight: bold; border: 3px solid white; box-shadow: 0 2px 8px rgba(0,0,0,0.3);">${airportCode}</div>`,
                    iconSize: [30, 30],
                    iconAnchor: [15, 15]
                })
            }).addTo(AppState.map);
            
            marker._airportType = 'origin';
            marker.bindPopup(`<strong>${airportCode}</strong><br>${name}`);
            AppState.flightMarkers.push(marker);
        }
    } catch (error) {
        console.error('Error zooming to airport:', error);
    }
}

function clearFlightMarkers() {
    if (AppState.hoverTimeout) {
        clearTimeout(AppState.hoverTimeout);
        AppState.hoverTimeout = null;
    }
    
    AppState.flightMarkers.forEach(marker => AppState.map.removeLayer(marker));
    AppState.routeLines.forEach(({ line }) => {
        if (AppState.map.hasLayer(line)) AppState.map.removeLayer(line);
    });
    
    AppState.flightMarkers = [];
    AppState.routeLines = [];
    AppState.hoverLine = null;
    AppState.hoverMarker = null;
    AppState.currentHighlightedRoute = null;
}

function clearMap() {
    clearFlightMarkers();
    AppState.selectedRouteLines.forEach(({ line }) => AppState.map.removeLayer(line));
    AppState.selectedRouteLines = [];
}

// =============================================================================
// ROUTE VISUALIZATION
// =============================================================================

async function redrawSelectedRoutes() {
    // Remove existing route lines
    AppState.selectedRouteLines.forEach(({ line }) => AppState.map.removeLayer(line));
    AppState.selectedRouteLines = [];
    
    if (AppState.selectedSegments.length === 0) return;
    
    // Get all airport coordinates
    const airports = new Set();
    AppState.selectedSegments.forEach(seg => {
        airports.add(seg.origin);
        airports.add(seg.destination);
    });
    
    try {
        const coords = await getAirportCoords([...airports]);
        const allWaypoints = [];
        
        for (let i = 0; i < AppState.selectedSegments.length; i++) {
            const seg = AppState.selectedSegments[i];
            if (!coords[seg.origin] || !coords[seg.destination]) continue;
            
            const originCoords = [coords[seg.origin].lat, coords[seg.origin].lon];
            const destCoords = [coords[seg.destination].lat, coords[seg.destination].lon];
            const segmentPath = getGreatCirclePath(originCoords, destCoords);
            
            if (i === 0) {
                allWaypoints.push(...segmentPath);
            } else {
                allWaypoints.push(...segmentPath.slice(1));
            }
        }
        
        if (allWaypoints.length > 0) {
            const continuousLine = L.polyline(allWaypoints, {
                color: '#667eea',
                weight: 4,
                opacity: 0.8
            }).addTo(AppState.map);
            
            AppState.selectedRouteLines.push({ 
                line: continuousLine, 
                segment: AppState.selectedSegments[AppState.selectedSegments.length - 1] 
            });
        }
    } catch (error) {
        console.error('Error redrawing routes:', error);
    }
}

function highlightRoute(origin, destination) {
    if (AppState.hoverTimeout) {
        clearTimeout(AppState.hoverTimeout);
        AppState.hoverTimeout = null;
    }
    
    const routeKey = `${origin}-${destination}`;
    if (AppState.currentHighlightedRoute === routeKey) return;
    
    AppState.hoverTimeout = setTimeout(() => {
        const route = AppState.routeLines.find(r => 
            r.flight.origin === origin && r.flight.destination === destination
        );
        
        if (route && !route.line._isSelected) {
            if (AppState.currentHighlightedRoute && AppState.currentHighlightedRoute !== routeKey) {
                clearHighlight();
            }
            
            requestAnimationFrame(() => {
                route.line.setStyle({ opacity: 0.9, weight: 4 });
                AppState.hoverLine = route.line;
                
                if (!route.marker._originalIcon) {
                    route.marker._originalIcon = route.marker.options.icon;
                }
                
                route.marker.setIcon(L.divIcon({
                    className: 'destination-marker',
                    html: `<div style="background: #667eea; color: white; border-radius: 50%; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 0.8rem; border: 3px solid white; box-shadow: 0 2px 8px rgba(0,0,0,0.4);">${destination}</div>`,
                    iconSize: [30, 30],
                    iconAnchor: [15, 15]
                }));
                AppState.hoverMarker = route.marker;
                AppState.currentHighlightedRoute = routeKey;
            });
        }
        AppState.hoverTimeout = null;
    }, 50);
}

function clearHighlight() {
    if (AppState.hoverTimeout) {
        clearTimeout(AppState.hoverTimeout);
        AppState.hoverTimeout = null;
    }
    
    requestAnimationFrame(() => {
        if (AppState.hoverLine) {
            AppState.hoverLine.setStyle({ opacity: 0, weight: 2 });
            AppState.hoverLine = null;
        }
        
        if (AppState.hoverMarker) {
            if (AppState.hoverMarker._originalIcon) {
                AppState.hoverMarker.setIcon(AppState.hoverMarker._originalIcon);
            }
            AppState.hoverMarker = null;
        }
        
        AppState.currentHighlightedRoute = null;
    });
}

// =============================================================================
// FLIGHT LOADING & DISPLAY
// =============================================================================

async function loadFlightsFromAirport(origin, date) {
    // Cancel any pending request
    if (AppState.currentLoadAbortController) {
        AppState.currentLoadAbortController.abort();
    }
    
    AppState.isLoadingFlights = true;
    AppState.currentLoadAbortController = new AbortController();
    
    const loadBtn = document.getElementById('load-flights-btn');
    if (loadBtn) {
        loadBtn.disabled = true;
        loadBtn.textContent = 'Loading...';
    }
    
    // Show loading overlay
    const loadingOverlay = document.getElementById('loading-overlay');
    const loadingText = loadingOverlay?.querySelector('.loading-text');
    if (loadingOverlay) {
        loadingOverlay.style.display = 'flex';
        if (loadingText) loadingText.textContent = `Loading flights from ${origin}...`;
    }
    
    // IMPORTANT: Clear old markers immediately to prevent stale data from showing
    clearFlightMarkers();
    AppState.currentFlights = [];
    
    try {
        AppState.currentOrigin = origin;
        AppState.currentDate = date;
        
        // Ensure map is visible
        AppState.map?.invalidateSize();
        await zoomToAirport(origin, 6, false);
        
        // Get filter values
        const dateRange = document.getElementById('date-range').value;
        const cabinFilter = document.getElementById('cabin-filter').value;
        const direction = document.getElementById('planning-direction')?.value || 'forward';
        const milesProgram = document.getElementById('miles-program')?.value || 'qantas';
        
        // Update global state
        AppState.planningDirection = direction;
        AppState.startDate = document.getElementById('start-date')?.value || null;
        AppState.endDate = document.getElementById('end-date')?.value || null;
        AppState.mustVisitCities = (document.getElementById('must-visit-cities')?.value || '')
            .split(',').map(c => c.trim().toUpperCase()).filter(c => c);
        AppState.startingAirports = (document.getElementById('starting-airports')?.value || '')
            .split(',').map(a => a.trim().toUpperCase()).filter(a => a);
        
        // Calculate search parameters
        const isAfterSegmentSelection = AppState.selectedSegments.length > 0;
        let maxSearchRange = isAfterSegmentSelection ? 30 : parseInt(dateRange);
        let searchDate = date;
        
        if (isAfterSegmentSelection) {
            const lastSegment = AppState.selectedSegments[AppState.selectedSegments.length - 1];
            const daysToStay = parseInt(document.getElementById('days-to-stay')?.value || '3');
            
            if (direction === 'backward') {
                // Backward: flights must arrive BEFORE the last segment departs
                const lastSegmentDate = new Date(lastSegment.date);
                lastSegmentDate.setDate(lastSegmentDate.getDate() - daysToStay);
                searchDate = lastSegmentDate.toISOString().split('T')[0];
                
                // Limit search range to not go before start date
                if (AppState.startDate) {
                    const startDateObj = new Date(AppState.startDate);
                    const daysSinceStart = Math.ceil((lastSegmentDate - startDateObj) / (1000 * 60 * 60 * 24));
                    maxSearchRange = Math.max(Math.min(daysSinceStart, maxSearchRange), 0);
                }
            } else {
                // Forward: flights depart AFTER the last segment arrives
                searchDate = lastSegment.date;
                
                // Limit search range to not exceed end date
                if (AppState.endDate) {
                    const endDateObj = new Date(AppState.endDate);
                    const searchBaseDate = new Date(searchDate);
                    const daysUntilEnd = Math.ceil((endDateObj - searchBaseDate) / (1000 * 60 * 60 * 24));
                    maxSearchRange = Math.max(Math.min(daysUntilEnd, maxSearchRange), 0);
                }
            }
        }
        
        // Fetch flights
        const endpoint = direction === 'backward' ? '/api/flights-to' : '/api/flights';
        const daysToStay = parseInt(document.getElementById('days-to-stay')?.value || '3');
        
        // Build params - include connectivity filtering (only show viable destinations/origins)
        let params = direction === 'backward' 
            ? `destination=${origin}&date=${searchDate}&date_range=${maxSearchRange}&cabin_class=${cabinFilter || ''}&source=${milesProgram}`
            : `origin=${origin}&date=${searchDate}&date_range=${maxSearchRange}&cabin_class=${cabinFilter || ''}&source=${milesProgram}`;
        
        // Add connectivity parameters
        if (direction === 'forward' && AppState.endDate) {
            // Forward: filter out destinations with no onward flights before end date
            params += `&end_date=${AppState.endDate}&days_to_stay=${daysToStay}`;
        } else if (direction === 'backward' && AppState.startDate) {
            // Backward: filter out origins with no inbound flights after start date
            params += `&start_date=${AppState.startDate}&days_to_stay=${daysToStay}`;
        }
        
        const response = await fetch(`${endpoint}?${params}`, {
            signal: AppState.currentLoadAbortController.signal
        });
        
        const data = await response.json();
        if (data.error) {
            showError(data.error);
            // Still show origin marker so user knows where they are
            await zoomToAirport(origin, 6, false);
            displayFlights([], origin, false, direction);
            return;
        }
        
        let flights = data.flights;
        
        // Filter to only include OneWorld alliance airlines
        flights = filterOneWorldFlights(flights);
        
        // Filter by date constraints
        if (isAfterSegmentSelection) {
            const lastSegment = AppState.selectedSegments[AppState.selectedSegments.length - 1];
            const lastSegmentDate = new Date(lastSegment.date);
            lastSegmentDate.setHours(0, 0, 0, 0);
            
            flights = flights.filter(flight => {
                const flightDate = new Date(flight.date);
                flightDate.setHours(0, 0, 0, 0);
                
                if (direction === 'backward') {
                    // Backward: flights must be BEFORE the last segment date
                    // (we need to arrive before the next leg departs)
                    if (flightDate >= lastSegmentDate) return false;
                    // Don't show flights before start date
                    if (AppState.startDate) {
                        const startDateObj = new Date(AppState.startDate);
                        startDateObj.setHours(0, 0, 0, 0);
                        if (flightDate < startDateObj) return false;
                    }
                } else {
                    // Forward: flights must be ON or AFTER the last segment date
                    if (flightDate < lastSegmentDate) return false;
                    // Don't show flights after end date
                    if (AppState.endDate) {
                        const endDateObj = new Date(AppState.endDate);
                        endDateObj.setHours(0, 0, 0, 0);
                        if (flightDate > endDateObj) return false;
                    }
                }
                return true;
            });
        } else {
            // Initial search - apply date boundaries
            if (direction === 'backward' && AppState.startDate) {
                const startDateObj = new Date(AppState.startDate);
                startDateObj.setHours(0, 0, 0, 0);
                flights = flights.filter(flight => {
                    const flightDate = new Date(flight.date);
                    flightDate.setHours(0, 0, 0, 0);
                    return flightDate >= startDateObj;
                });
            } else if (direction === 'forward' && AppState.endDate) {
                const endDateObj = new Date(AppState.endDate);
                endDateObj.setHours(0, 0, 0, 0);
                flights = flights.filter(flight => {
                    const flightDate = new Date(flight.date);
                    flightDate.setHours(0, 0, 0, 0);
                    return flightDate <= endDateObj;
                });
            }
        }
        
        // Filter dead-end destinations (batch API call)
        if (isAfterSegmentSelection && AppState.endDate && flights.length > 0) {
            const uniqueDestinations = [...new Set(flights.map(f => f.destination))];
            const lastSegment = AppState.selectedSegments[AppState.selectedSegments.length - 1];
            const arrivalDate = new Date(lastSegment.date);
            const endDateObj = new Date(AppState.endDate);
            const daysUntilEnd = Math.ceil((endDateObj - arrivalDate) / (1000 * 60 * 60 * 24));
            
            if (daysUntilEnd > 0) {
                // Batch check all destinations in parallel (limit to 10 concurrent)
                const destinationsWithFlights = new Set();
                const batchSize = 10;
                
                for (let i = 0; i < uniqueDestinations.length; i += batchSize) {
                    const batch = uniqueDestinations.slice(i, i + batchSize);
                    const checkPromises = batch.map(async (dest) => {
                        const cacheKey = `${dest}-${arrivalDate.toISOString().split('T')[0]}`;
                        if (AppState.flightCheckCache[cacheKey] !== undefined) {
                            if (AppState.flightCheckCache[cacheKey]) destinationsWithFlights.add(dest);
                            return;
                        }
                        
                        try {
                            const response = await fetch(
                                `/api/airport-has-flights?airport=${dest}&start_date=${arrivalDate.toISOString().split('T')[0]}`
                            );
                            const data = await response.json();
                            AppState.flightCheckCache[cacheKey] = data.has_flights;
                            if (data.has_flights) destinationsWithFlights.add(dest);
                        } catch {
                            destinationsWithFlights.add(dest); // Include on error
                        }
                    });
                    await Promise.all(checkPromises);
                }
                
                flights = flights.filter(f => destinationsWithFlights.has(f.destination));
            }
        }
        
        // Calculate target date range
        const targetDateRange = calculateTargetDateRange();
        
        // Display flights
        displayFlights(flights, origin, false, direction, targetDateRange);
        await displayFlightsOnMap(flights, origin, direction, targetDateRange);
        
        AppState.map?.invalidateSize();
        
    } catch (error) {
        if (error.name !== 'AbortError') {
            console.error('Error loading flights:', error);
            showError('Failed to load flights');
        }
    } finally {
        // Hide loading overlay
        const loadingOverlay = document.getElementById('loading-overlay');
        if (loadingOverlay) {
            loadingOverlay.style.display = 'none';
        }
        
        if (loadBtn) {
            loadBtn.disabled = false;
            loadBtn.textContent = 'Load Flights';
        }
        AppState.isLoadingFlights = false;
    }
}

function displayFlights(flights, origin, keepSidebarOpen = false, direction = 'forward', targetDateRange = null) {
    const sidebar = document.getElementById('flight-sidebar');
    const flightList = document.getElementById('flight-list');
    
    if (!keepSidebarOpen) sidebar.classList.add('open');
    
    if (flights.length === 0) {
        const message = direction === 'backward' 
            ? `No flights found to ${origin}` 
            : `No flights found from ${origin}`;
        flightList.innerHTML = `
            <p class="empty-state">${message}</p>
            <button class="btn btn-primary" onclick="expandDateRange()">Expand Date Range</button>
            <button class="btn btn-secondary" onclick="showNearbyAirports('${origin}')">Try Nearby Airports</button>
        `;
        return;
    }
    
    // Store unfiltered flights (only update if this is a new flight set, not a filter update)
    if (!keepSidebarOpen || !AppState.allFlights || AppState.allFlights.length === 0) {
        AppState.allFlights = flights;
        // Load continent data for filtering (only once per flight set)
        loadContinentData(flights, direction);
    }
    
    AppState.currentFlights = flights;
    
    // Show filters when flights are displayed
    const filtersDiv = document.getElementById('flight-filters');
    if (filtersDiv && flights.length > 0) {
        filtersDiv.style.display = 'block';
    }
    
    // Build header
    let headerHTML = '';
    if (targetDateRange) {
        headerHTML += `<div style="padding: 0.5rem; background: #e8f5e9; border-bottom: 1px solid #e0e0e0; font-size: 0.85rem;">
            <strong>Showing flights for next 30 days.</strong> Green border = within "days to stay" range.
        </div>`;
    }
    if (direction === 'backward') {
        headerHTML += `<div style="padding: 0.5rem; background: #fff3cd; border-bottom: 1px solid #e0e0e0; font-size: 0.85rem;">
            <strong>Planning Backwards:</strong> Select flights TO ${origin}
        </div>`;
    }
    if (AppState.filteredDestination) {
        headerHTML += `<div style="padding: 0.5rem; background: #f0f4ff; border-bottom: 1px solid #e0e0e0; display: flex; justify-content: space-between; align-items: center;">
            <span style="font-size: 0.85rem;">Filtered: <strong>${AppState.filteredDestination}</strong></span>
            <button onclick="clearDestinationFilter()" style="padding: 2px 8px; background: #667eea; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 0.75rem;">Clear</button>
        </div>`;
    }
    
    // Build flight list
    renderFlightListItems(flights, headerHTML, direction, targetDateRange);
}

function renderFlightList(flights, origin, direction, targetDateRange) {
    // Build header
    let headerHTML = '';
    if (targetDateRange) {
        headerHTML += `<div style="padding: 0.5rem; background: #e8f5e9; border-bottom: 1px solid #e0e0e0; font-size: 0.85rem;">
            <strong>Showing flights for next 30 days.</strong> Green border = within "days to stay" range.
        </div>`;
    }
    if (direction === 'backward') {
        headerHTML += `<div style="padding: 0.5rem; background: #fff3cd; border-bottom: 1px solid #e0e0e0; font-size: 0.85rem;">
            <strong>Planning Backwards:</strong> Select flights TO ${origin}
        </div>`;
    }
    if (AppState.filteredDestination) {
        headerHTML += `<div style="padding: 0.5rem; background: #f0f4ff; border-bottom: 1px solid #e0e0e0; display: flex; justify-content: space-between; align-items: center;">
            <span style="font-size: 0.85rem;">Filtered: <strong>${AppState.filteredDestination}</strong></span>
            <button onclick="clearDestinationFilter()" style="padding: 2px 8px; background: #667eea; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 0.75rem;">Clear</button>
        </div>`;
    }
    
    renderFlightListItems(flights, headerHTML, direction, targetDateRange);
}

function renderFlightListItems(flights, headerHTML = '', direction = 'forward', targetDateRange = null) {
    const flightList = document.getElementById('flight-list');
    if (!flightList) return;
    
    flightList.innerHTML = headerHTML + flights.map((flight, index) => {
        const hasBusiness = flight.business_miles_int > 0;
        const hasPremium = flight.premium_economy_miles_int > 0;
        const hasEconomy = flight.economy_miles_int > 0;
        
        let cabinClass, miles, carriers;
        if (hasBusiness) {
            cabinClass = 'Business';
            miles = flight.business_miles;
            carriers = flight.business_carriers;
        } else if (hasPremium) {
            cabinClass = 'Premium Economy';
            miles = flight.premium_economy_miles;
            carriers = flight.premium_economy_carriers;
        } else {
            cabinClass = 'Economy';
            miles = flight.economy_miles;
            carriers = flight.economy_carriers;
        }
        
        const availableClasses = [];
        if (hasBusiness) availableClasses.push('Business');
        if (hasPremium) availableClasses.push('Premium');
        if (hasEconomy) availableClasses.push('Economy');
        const classesDisplay = availableClasses.length > 1 ? ` (${availableClasses.join(', ')})` : '';
        
        // Always display flight as origin → destination (the actual route)
        const displayOrigin = flight.origin;
        const displayDest = flight.destination;
        const displayOriginName = flight.origin_name;
        const displayDestName = flight.destination_name;
        
        // For must-visit check: in backward mode, check the origin (where we need to get to next)
        const checkCity = direction === 'backward' ? flight.origin : flight.destination;
        const isMustVisit = AppState.mustVisitCities.includes(checkCity);
        const mustVisitBadge = isMustVisit ? '<span class="flight-badge" style="background: #FF6B6B; color: white;">Must Visit</span>' : '';
        
        let isWithinRange = false;
        if (targetDateRange) {
            const flightDate = new Date(flight.date);
            isWithinRange = flightDate >= targetDateRange.start && flightDate <= targetDateRange.end;
        }
        
        const borderStyle = isWithinRange ? 'border: 3px solid #4CAF50;' : '';
        const rangeIndicator = isWithinRange ? '<span style="color: #4CAF50; font-size: 0.75rem; margin-left: 0.5rem;">✓ In Range</span>' : '';
        
        const escapedBusinessCarriers = (flight.business_carriers || '').replace(/'/g, "\\'");
        const escapedPremiumCarriers = (flight.premium_economy_carriers || '').replace(/'/g, "\\'");
        const escapedEconomyCarriers = (flight.economy_carriers || '').replace(/'/g, "\\'");
        
        // Use original index if available (for filtered flights), otherwise use current index
        const flightIndex = flight._originalIndex !== undefined ? flight._originalIndex : index;
        
        return `
            <div class="flight-item" 
                 data-flight-index="${flightIndex}"
                 style="${borderStyle}"
                 onmouseenter="highlightRoute('${flight.origin}', '${flight.destination}')"
                 onmouseleave="clearHighlight()"
                 onclick="selectFlight(${flightIndex}, '${flight.origin}', '${flight.destination}', '${flight.date}', ${flight.is_direct}, ${flight.num_stops}, ${flight.business_miles_int || 0}, ${flight.premium_economy_miles_int || 0}, ${flight.economy_miles_int || 0}, '${escapedBusinessCarriers}', '${escapedPremiumCarriers}', '${escapedEconomyCarriers}')">
                <div class="flight-header">
                    <div>
                        <span class="flight-route">${displayOrigin} → ${displayDest} ${mustVisitBadge}${rangeIndicator}</span>
                        <div class="flight-date">${formatDate(flight.date)}</div>
                    </div>
                    <div>
                        ${flight.is_direct ? '<span class="flight-badge badge-direct">Direct</span>' : `<span class="flight-badge badge-stops">${flight.num_stops} stop${flight.num_stops > 1 ? 's' : ''}</span>`}
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

// =============================================================================
// FLIGHT FILTERING
// =============================================================================

async function loadContinentData(flights, direction) {
    // Get unique airports from flights
    const airports = new Set();
    flights.forEach(flight => {
        // For backward mode, we filter by origin continent; for forward, by destination
        if (direction === 'backward') {
            airports.add(flight.origin);
        } else {
            airports.add(flight.destination);
        }
    });
    
    // Only fetch continents we don't have cached
    const airportsToFetch = Array.from(airports).filter(apt => !AppState.airportContinents[apt]);
    
    if (airportsToFetch.length === 0) return;
    
    try {
        const response = await fetch(`/api/airport-continent?${airportsToFetch.map(a => `airports=${a}`).join('&')}`);
        const data = await response.json();
        
        // Cache the continent data
        Object.assign(AppState.airportContinents, data);
    } catch (error) {
        console.error('Error loading continent data:', error);
    }
}

function applyFlightFilters() {
    // NOTE: This function filters locally without making any API calls
    // It only filters AppState.allFlights which was loaded from a single API call
    // This prevents using up daily API call limits
    
    if (!AppState.allFlights || AppState.allFlights.length === 0) {
        return;
    }
    
    const continentFilter = document.getElementById('filter-continent')?.value || '';
    const dateFrom = document.getElementById('filter-date-start')?.value || '';
    const dateTo = document.getElementById('filter-date-end')?.value || '';
    const cabinFilter = document.getElementById('filter-class')?.value || '';
    const stopsFilter = document.getElementById('filter-stops')?.value || '';
    
    const direction = AppState.planningDirection || 'forward';
    
    // Map flights to include original index before filtering
    const flightsWithIndex = AppState.allFlights.map((flight, originalIndex) => ({
        ...flight,
        _originalIndex: originalIndex
    }));
    
    let filtered = flightsWithIndex.filter(flight => {
        // Continent filter
        if (continentFilter) {
            const airport = direction === 'backward' ? flight.origin : flight.destination;
            const continent = AppState.airportContinents[airport];
            if (continent !== continentFilter) {
                return false;
            }
        }
        
        // Date range filter
        if (dateFrom || dateTo) {
            const flightDate = new Date(flight.date);
            flightDate.setHours(0, 0, 0, 0);
            
            if (dateFrom) {
                const fromDate = new Date(dateFrom);
                fromDate.setHours(0, 0, 0, 0);
                if (flightDate < fromDate) return false;
            }
            
            if (dateTo) {
                const toDate = new Date(dateTo);
                toDate.setHours(0, 0, 0, 0);
                if (flightDate > toDate) return false;
            }
        }
        
        // Cabin class filter
        if (cabinFilter) {
            if (cabinFilter === 'business' && flight.business_miles_int === 0) return false;
            if (cabinFilter === 'premium' && flight.business_miles_int === 0 && flight.premium_economy_miles_int === 0) return false;
            if (cabinFilter === 'economy' && flight.economy_miles_int === 0) return false;
        }
        
        // Stops filter
        if (stopsFilter) {
            if (stopsFilter === 'direct' && !flight.is_direct) return false;
            if (stopsFilter === '1-stop' && (flight.is_direct || flight.num_stops !== 1)) return false;
            if (stopsFilter === '2+stops' && flight.num_stops < 2) return false;
        }
        
        return true;
    });
    
    // Update displayed flights
    AppState.currentFlights = filtered;
    
    // Re-render without resetting allFlights
    const targetDateRange = calculateTargetDateRange();
    renderFlightList(filtered, AppState.currentOrigin, direction, targetDateRange);
    displayFlightsOnMap(filtered, AppState.currentOrigin, direction, targetDateRange);
}

function clearFlightFilters() {
    // Reset filter controls
    document.getElementById('filter-continent').value = '';
    document.getElementById('filter-date-start').value = '';
    document.getElementById('filter-date-end').value = '';
    document.getElementById('filter-class').value = '';
    document.getElementById('filter-stops').value = '';
    
    // Show all flights
    AppState.currentFlights = AppState.allFlights || [];
    
    // Re-render
    const targetDateRange = calculateTargetDateRange();
    const direction = AppState.planningDirection || 'forward';
    displayFlights(AppState.currentFlights, AppState.currentOrigin, true, direction, targetDateRange);
    displayFlightsOnMap(AppState.currentFlights, AppState.currentOrigin, direction, targetDateRange);
}

// Make functions globally accessible
window.applyFlightFilters = applyFlightFilters;
window.clearFlightFilters = clearFlightFilters;

async function displayFlightsOnMap(flights, origin, direction = 'forward', targetDateRange = null) {
    clearFlightMarkers();
    AppState.currentFlights = flights;
    
    // For backward planning, we show origin airports (where flights come FROM to reach our target)
    // For forward planning, we show destination airports (where flights go TO from our location)
    const markerAirports = direction === 'backward' 
        ? flights.map(f => f.origin)  // Show where flights come FROM
        : flights.map(f => f.destination);  // Show where flights go TO
    
    const airports = [origin, ...markerAirports];
    const coords = await getAirportCoords([...new Set(airports)]);
    
    // Add the main airport marker (our target in backward, our location in forward)
    if (coords[origin]) {
        const markerLabel = direction === 'backward' ? 'Target' : 'You';
        const originMarker = L.marker([coords[origin].lat, coords[origin].lon], {
            icon: L.divIcon({
                className: 'origin-marker',
                html: `<div style="background: #667eea; color: white; border-radius: 50%; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; font-weight: bold; border: 3px solid white; box-shadow: 0 2px 8px rgba(0,0,0,0.3);">${origin}</div>`,
                iconSize: [30, 30],
                iconAnchor: [15, 15]
            })
        }).addTo(AppState.map);
        
        originMarker.bindPopup(`<strong>${origin}</strong><br>${coords[origin].name}<br><em>${direction === 'backward' ? 'Your destination' : 'Your location'}</em>`);
        AppState.flightMarkers.push(originMarker);
    }
    
    // Group flights by the airport we want to show markers for
    const flightsByAirport = {};
    flights.forEach(flight => {
        // For backward: group by origin (where flights come from)
        // For forward: group by destination (where flights go to)
        const markerAirport = direction === 'backward' ? flight.origin : flight.destination;
        if (!flightsByAirport[markerAirport]) flightsByAirport[markerAirport] = [];
        flightsByAirport[markerAirport].push(flight);
    });
    
    // Add markers for each airport we can fly to/from
    Object.entries(flightsByAirport).forEach(([airport, airportFlights]) => {
        if (!coords[airport]) return;
        
        const hasBusiness = airportFlights.some(f => f.business_miles_int > 0);
        const hasPremium = airportFlights.some(f => f.premium_economy_miles_int > 0);
        
        let markerColor = hasBusiness ? '#667eea' : hasPremium ? '#4CAF50' : '#FF9800';
        
        const hasFlightsInRange = targetDateRange && airportFlights.some(f => {
            const flightDate = new Date(f.date);
            return flightDate >= targetDateRange.start && flightDate <= targetDateRange.end;
        });
        
        const borderColor = hasFlightsInRange ? '#4CAF50' : 'white';
        const borderWidth = hasFlightsInRange ? '4px' : '2px';
        
        const originalIcon = L.divIcon({
            className: 'destination-marker',
            html: `<div style="background: ${markerColor}; color: white; border-radius: 50%; width: 25px; height: 25px; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 0.7rem; border: ${borderWidth} solid ${borderColor}; box-shadow: 0 2px 6px rgba(0,0,0,0.3);">${airport}</div>`,
            iconSize: [25, 25],
            iconAnchor: [12, 12]
        });
        
        const airportCoords = [coords[airport].lat, coords[airport].lon];
        const mainCoords = [coords[origin].lat, coords[origin].lon];
        
        const marker = L.marker(airportCoords, { icon: originalIcon }).addTo(AppState.map);
        marker._originalIcon = originalIcon;
        marker._inRange = hasFlightsInRange;
        marker._destination = airport;  // Keep this name for filterByDestination compatibility
        marker._cabinClass = hasBusiness ? 'business' : hasPremium ? 'premium' : 'economy';
        
        const cabinInfo = [];
        if (hasBusiness) cabinInfo.push('Business');
        if (hasPremium) cabinInfo.push('Premium Economy');
        if (airportFlights.some(f => f.economy_miles_int > 0)) cabinInfo.push('Economy');
        
        marker.bindPopup(`
            <strong>${airport}</strong><br>
            ${coords[airport].name}<br>
            <strong>Classes:</strong> ${cabinInfo.join(', ')}<br>
            <strong>Flights:</strong> ${airportFlights.length}<br>
            <button onclick="filterByDestination('${airport}'); return false;" style="margin-top: 8px; padding: 4px 8px; background: #667eea; color: white; border: none; border-radius: 4px; cursor: pointer;">View Flights</button>
        `, {
            closeOnClick: false,
            autoClose: false
        });
        marker.bindTooltip(coords[airport].name, { permanent: false, direction: 'top', offset: [0, -10] });
        marker.on('click', () => filterByDestination(airport));
        
        AppState.flightMarkers.push(marker);
        
        // Add route lines
        airportFlights.forEach(flight => {
            const path = getGreatCirclePath(mainCoords, airportCoords);
            const line = L.polyline(path, {
                color: flight.is_direct ? markerColor : '#FF9800',
                weight: 2,
                opacity: 0,
                dashArray: flight.is_direct ? null : '5, 5'
            }).addTo(AppState.map);
            
            line._flightData = flight;
            AppState.routeLines.push({ line, marker, flight });
        });
    });
    
    // Fit bounds
    if (AppState.flightMarkers.length > 0) {
        const group = new L.featureGroup(AppState.flightMarkers);
        const bounds = group.getBounds();
        if (bounds.isValid()) {
            AppState.map.fitBounds(bounds.pad(0.1), { maxZoom: 8 });
        }
    }
}

function filterByDestination(airport) {
    AppState.filteredDestination = airport;
    
    // Open sidebar to show filtered flights
    const sidebar = document.getElementById('flight-sidebar');
    if (sidebar) sidebar.classList.add('open');
    
    // Filter from allFlights (complete dataset) not currentFlights (already filtered)
    const flightsToFilter = AppState.allFlights && AppState.allFlights.length > 0 
        ? AppState.allFlights 
        : AppState.currentFlights;
    
    // For backward planning, filter by origin (where flights come from)
    // For forward planning, filter by destination (where flights go to)
    let filtered = AppState.planningDirection === 'backward'
        ? flightsToFilter.filter(f => f.origin === airport)
        : flightsToFilter.filter(f => f.destination === airport);
    
    // Apply any active sidebar filters on top of the airport filter
    const continentFilter = document.getElementById('filter-continent')?.value || '';
    const dateFrom = document.getElementById('filter-date-start')?.value || '';
    const dateTo = document.getElementById('filter-date-end')?.value || '';
    const cabinFilter = document.getElementById('filter-class')?.value || '';
    const stopsFilter = document.getElementById('filter-stops')?.value || '';
    
    if (continentFilter || dateFrom || dateTo || cabinFilter || stopsFilter) {
        filtered = filtered.filter(flight => {
            const direction = AppState.planningDirection || 'forward';
            
            // Continent filter
            if (continentFilter) {
                const filterAirport = direction === 'backward' ? flight.origin : flight.destination;
                const continent = AppState.airportContinents[filterAirport];
                if (continent !== continentFilter) return false;
            }
            
            // Date range filter
            if (dateFrom || dateTo) {
                const flightDate = new Date(flight.date);
                flightDate.setHours(0, 0, 0, 0);
                if (dateFrom) {
                    const fromDate = new Date(dateFrom);
                    fromDate.setHours(0, 0, 0, 0);
                    if (flightDate < fromDate) return false;
                }
                if (dateTo) {
                    const toDate = new Date(dateTo);
                    toDate.setHours(0, 0, 0, 0);
                    if (flightDate > toDate) return false;
                }
            }
            
            // Cabin class filter
            if (cabinFilter) {
                if (cabinFilter === 'business' && flight.business_miles_int === 0) return false;
                if (cabinFilter === 'premium' && flight.business_miles_int === 0 && flight.premium_economy_miles_int === 0) return false;
                if (cabinFilter === 'economy' && flight.economy_miles_int === 0) return false;
            }
            
            // Stops filter
            if (stopsFilter) {
                if (stopsFilter === 'direct' && !flight.is_direct) return false;
                if (stopsFilter === '1-stop' && (flight.is_direct || flight.num_stops !== 1)) return false;
                if (stopsFilter === '2+stops' && flight.num_stops < 2) return false;
            }
            
            return true;
        });
    }
    
    const targetDateRange = calculateTargetDateRange();
    AppState.currentFlights = filtered;
    
    // Update sidebar with filtered flights (don't re-render map - markers are already correct)
    renderFlightList(filtered, AppState.currentOrigin, AppState.planningDirection, targetDateRange);
    
    // Scroll sidebar to top
    const flightList = document.getElementById('flight-list');
    if (flightList) {
        flightList.scrollTop = 0;
    }
    
    // Close the popup after a brief delay to let user see the sidebar
    setTimeout(() => {
        const marker = AppState.flightMarkers.find(m => m._destination === airport);
        if (marker) {
            marker.closePopup();
        }
    }, 100);
}

function clearDestinationFilter() {
    AppState.filteredDestination = null;
    const targetDateRange = calculateTargetDateRange();
    displayFlights(AppState.currentFlights, AppState.currentOrigin, true, AppState.planningDirection, targetDateRange);
}

// =============================================================================
// FLIGHT SELECTION & TRIP MANAGEMENT
// =============================================================================

async function selectFlight(index, origin, destination, date, isDirect, numStops, businessMiles, premiumEconomyMiles, economyMiles, businessCarriers, premiumEconomyCarriers, economyCarriers) {
    if (AppState.isSelectingFlight) return;
    AppState.isSelectingFlight = true;
    
    try {
        const coords = await getAirportCoords([origin, destination]);
        
        if (!coords[origin] || !coords[destination]) {
            showError('Could not get coordinates for airports');
            return;
        }
        
        const originCoords = [coords[origin].lat, coords[origin].lon];
        const destCoords = [coords[destination].lat, coords[destination].lon];
        const distance = calculateDistance(originCoords, destCoords);
        
        // A flight is always origin → destination, regardless of planning direction
        // In backward mode, we're selecting flights TO our target, but the flight itself
        // still goes from its origin to its destination
        
        // Determine cabin class
        const cabinClass = businessMiles > 0 ? 'Business' : premiumEconomyMiles > 0 ? 'Premium Economy' : 'Economy';
        
        // Create segment - flight goes from origin to destination
        const segment = {
            segment: AppState.selectedSegments.length + 1,
            origin: origin,
            destination: destination,
            date,
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
        
        // Add segment
        if (AppState.planningDirection === 'backward') {
            AppState.selectedSegments.unshift(segment);
            AppState.selectedSegments.forEach((seg, i) => seg.segment = i + 1);
        } else {
            AppState.selectedSegments.push(segment);
        }
        
        // Update global reference
        window.selectedSegments = AppState.selectedSegments;
        
        // Update UI
        redrawSelectedRoutes();
        updateTripSummary();
        updateButtons();
        
        // Mark flight item as selected
        document.querySelectorAll('.flight-item').forEach(item => item.classList.remove('selected'));
        document.querySelector(`[data-flight-index="${index}"]`)?.classList.add('selected');
        
        // Show next flight planning section
        const nextFlightSection = document.getElementById('next-flight-section');
        if (nextFlightSection) nextFlightSection.style.display = 'block';
        
        // Calculate next flight date and airport
        const planningMode = document.getElementById('planning-mode')?.value || 'days';
        const daysToStay = parseInt(document.getElementById('days-to-stay')?.value || '3');
        
        let nextFlightDate = date;
        const nextAirport = AppState.planningDirection === 'backward' ? origin : destination;
        
        if (planningMode === 'days') {
            const currentDate = new Date(date);
            currentDate.setDate(currentDate.getDate() + (AppState.planningDirection === 'backward' ? -daysToStay : daysToStay));
            nextFlightDate = currentDate.toISOString().split('T')[0];
        } else {
            nextFlightDate = document.getElementById('target-date')?.value || nextFlightDate;
        }
        
        // Update target date field
        const targetDateInput = document.getElementById('target-date');
        if (targetDateInput) targetDateInput.value = nextFlightDate;
        
        // Check if trip is complete
        const isComplete = AppState.startingAirports.includes(nextAirport);
        
        if (!isComplete) {
            setTimeout(() => loadFlightsFromAirport(nextAirport, nextFlightDate), 300);
        } else {
            if (nextFlightSection) nextFlightSection.style.display = 'none';
        }
        
    } catch (error) {
        console.error('Error selecting flight:', error);
        showError('Failed to select flight');
    } finally {
        AppState.isSelectingFlight = false;
    }
}

function undoLast() {
    if (AppState.selectedSegments.length === 0) {
        updateButtons();
        return;
    }
    
    // Remove the last segment
    const removedSegment = AppState.selectedSegments.pop();
    window.selectedSegments = AppState.selectedSegments;
    
    // Remove route line
    if (AppState.selectedRouteLines.length > 0) {
        const lastRoute = AppState.selectedRouteLines.pop();
        if (lastRoute?.line && AppState.map.hasLayer(lastRoute.line)) {
            AppState.map.removeLayer(lastRoute.line);
        }
    }
    
    clearHighlight();
    
    // Redraw remaining routes
    if (AppState.selectedSegments.length > 0) {
        redrawSelectedRoutes();
    } else {
        AppState.selectedRouteLines.forEach(({ line }) => {
            if (AppState.map.hasLayer(line)) AppState.map.removeLayer(line);
        });
        AppState.selectedRouteLines = [];
    }
    
    updateTripSummary();
    updateButtons();
    
    // Reload flights
    setTimeout(() => {
        if (AppState.selectedSegments.length > 0) {
            const lastSeg = AppState.selectedSegments[AppState.selectedSegments.length - 1];
            const planningMode = document.getElementById('planning-mode')?.value || 'days';
            const daysToStay = parseInt(document.getElementById('days-to-stay')?.value || '3');
            const isBackward = AppState.planningDirection === 'backward';
            
            let nextFlightDate = lastSeg.date;
            if (planningMode === 'days') {
                const currentDate = new Date(lastSeg.date);
                // Backward: subtract days, Forward: add days
                currentDate.setDate(currentDate.getDate() + (isBackward ? -daysToStay : daysToStay));
                nextFlightDate = currentDate.toISOString().split('T')[0];
            } else {
                nextFlightDate = document.getElementById('target-date')?.value || nextFlightDate;
            }
            
            // For backward planning, use the origin (where we need to fly FROM)
            const nextAirport = isBackward ? lastSeg.origin : lastSeg.destination;
            loadFlightsFromAirport(nextAirport, nextFlightDate);
        } else {
            // Back to start
            const nextFlightSection = document.getElementById('next-flight-section');
            if (nextFlightSection) nextFlightSection.style.display = 'none';
            
            clearFlightMarkers();
            
            const startDate = document.getElementById('start-date').value;
            if (AppState.startingAirports.length > 0 && startDate) {
                loadFlightsFromAirport(AppState.startingAirports[0], startDate);
            }
        }
    }, 50);
}

function clearAll() {
    if (AppState.isLoadingFlights || AppState.isSelectingFlight) return;
    if (!confirm('Clear all segments?')) return;
    
    AppState.selectedSegments = [];
    window.selectedSegments = AppState.selectedSegments;
    
    AppState.selectedRouteLines.forEach(({ line }) => AppState.map.removeLayer(line));
    AppState.selectedRouteLines = [];
    
    const nextFlightSection = document.getElementById('next-flight-section');
    if (nextFlightSection) nextFlightSection.style.display = 'none';
    
    clearMap();
    updateTripSummary();
    updateButtons();
    
    const startDate = document.getElementById('start-date').value;
    if (AppState.startingAirports.length > 0 && startDate) {
        loadFlightsFromAirport(AppState.startingAirports[0], startDate);
    }
}

function editSegmentDate(segmentIndex) {
    if (segmentIndex < 0 || segmentIndex >= AppState.selectedSegments.length) return;
    
    const segment = AppState.selectedSegments[segmentIndex];
    const newDate = prompt(
        `Edit date for Segment ${segment.segment} (${segment.origin} → ${segment.destination}):\n\nCurrent date: ${segment.date}\n\nEnter new date (YYYY-MM-DD):`,
        segment.date
    );
    
    if (!newDate || newDate === segment.date) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate)) {
        showError('Invalid date format. Please use YYYY-MM-DD');
        return;
    }
    
    segment.date = newDate;
    redrawSelectedRoutes();
    updateTripSummary();
    
    if (segmentIndex === AppState.selectedSegments.length - 1) {
        const daysToStay = parseInt(document.getElementById('days-to-stay')?.value || '3');
        const isBackward = AppState.planningDirection === 'backward';
        const nextDate = new Date(newDate);
        nextDate.setDate(nextDate.getDate() + (isBackward ? -daysToStay : daysToStay));
        const nextAirport = isBackward ? segment.origin : segment.destination;
        loadFlightsFromAirport(nextAirport, nextDate.toISOString().split('T')[0]);
    }
}

// =============================================================================
// TRIP SUMMARY & VALIDATION
// =============================================================================

async function updateTripSummary() {
    const summaryDiv = document.getElementById('trip-summary');
    const requirementsDiv = document.getElementById('trip-requirements');
    const requirementsStatus = document.getElementById('requirements-status');
    
    if (AppState.selectedSegments.length === 0) {
        summaryDiv.innerHTML = '<p class="empty-state">No segments selected yet</p>';
        if (requirementsDiv) requirementsDiv.style.display = 'none';
        return;
    }
    
    let totalDistance = 0;
    
    const segmentsHtml = AppState.selectedSegments.map((seg, index) => {
        totalDistance += seg.distance_miles || 0;
        
        const airlineInfo = seg.business_carriers || seg.premium_economy_carriers || seg.economy_carriers || '';
        
        let daysAtDest = '';
        if (index < AppState.selectedSegments.length - 1) {
            const nextSeg = AppState.selectedSegments[index + 1];
            const arrivalDate = new Date(seg.date);
            const departureDate = new Date(nextSeg.date);
            const daysDiff = Math.round((departureDate - arrivalDate) / (1000 * 60 * 60 * 24));
            if (daysDiff >= 0) daysAtDest = ` • ${daysDiff} day${daysDiff !== 1 ? 's' : ''} stay`;
        }
        
        return `
            <div class="trip-segment" data-segment-index="${index}">
                <div class="trip-segment-header">
                    Segment ${seg.segment}: ${seg.origin} → ${seg.destination}
                    <button onclick="editSegmentDate(${index})" style="margin-left: 0.5rem; padding: 2px 6px; background: #667eea; color: white; border: none; border-radius: 3px; cursor: pointer; font-size: 0.7rem;">Edit Date</button>
                </div>
                <div class="trip-segment-details">
                    ${formatDate(seg.date)} • ${seg.cabin_class} • ${seg.distance_miles.toFixed(0)} miles${daysAtDest}<br>
                    ${airlineInfo ? `<small style="color: #666;">Airlines: ${airlineInfo}</small>` : ''}
                </div>
            </div>
        `;
    }).join('');
    
    const remainingMiles = 35000 - totalDistance;
    const remainingClass = remainingMiles >= 0 ? '' : 'validation-error';
    
    // Track must-visit cities
    const visitedAirports = new Set();
    AppState.selectedSegments.forEach(seg => {
        visitedAirports.add(seg.origin);
        visitedAirports.add(seg.destination);
    });
    
    const visitedMustVisit = AppState.mustVisitCities.filter(city => visitedAirports.has(city));
    const missingMustVisit = AppState.mustVisitCities.filter(city => !visitedAirports.has(city));
    
    let mustVisitHtml = '';
    if (AppState.mustVisitCities.length > 0) {
        mustVisitHtml = `
            <div style="margin-top: 0.75rem; padding-top: 0.75rem; border-top: 1px solid #eee;">
                <strong>Must-Visit Cities:</strong><br>
                ${visitedMustVisit.length > 0 ? `<span style="color: #4CAF50;">✓ Visited: ${visitedMustVisit.join(', ')}</span><br>` : ''}
                ${missingMustVisit.length > 0 
                    ? `<span style="color: #f44336;">✗ Missing: ${missingMustVisit.join(', ')}</span>` 
                    : '<span style="color: #4CAF50;">✓ All must-visit cities included!</span>'}
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
    
    // Validate and show requirements
    if (requirementsDiv && requirementsStatus) {
        try {
            const response = await fetch('/api/validate-trip', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ segments: AppState.selectedSegments })
            });
            const validation = await response.json();
            
            if (!validation.error) {
                requirementsStatus.innerHTML = `
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
                        <span style="color: ${!validation.errors.some(e => e.includes('return to origin')) ? '#4CAF50' : '#f44336'};">
                            ${!validation.errors.some(e => e.includes('return to origin')) ? '✓' : '✗'}
                        </span>
                        <strong>Return to Origin:</strong> ${validation.errors.some(e => e.includes('return to origin')) ? 'No' : 'Yes'}
                    </div>
                    ${validation.errors.length > 0 ? `
                        <div style="margin-top: 0.5rem; padding: 0.5rem; background: #ffebee; border-radius: 4px; font-size: 0.75rem;">
                            <strong style="color: #f44336;">Errors:</strong>
                            ${validation.errors.map(e => `<div>• ${e}</div>`).join('')}
                        </div>
                    ` : ''}
                `;
                requirementsDiv.style.display = 'block';
            }
        } catch (error) {
            console.error('Error validating trip:', error);
        }
    }
}

async function copyTripToClipboard() {
    if (AppState.selectedSegments.length === 0) {
        showError('No trip segments to copy');
        return;
    }
    
    let totalDistance = 0;
    let totalBusinessMiles = 0;
    let totalPremiumMiles = 0;
    let totalEconomyMiles = 0;
    
    // Get airport names for better formatting
    const airports = new Set();
    AppState.selectedSegments.forEach(seg => {
        airports.add(seg.origin);
        airports.add(seg.destination);
    });
    
    let airportNames = {};
    try {
        const coords = await getAirportCoords([...airports]);
        airports.forEach(code => {
            if (coords[code]) {
                airportNames[code] = coords[code].name || code;
            } else {
                airportNames[code] = code;
            }
        });
    } catch (error) {
        // Fallback to just codes
        airports.forEach(code => airportNames[code] = code);
    }
    
    // Format date with full details
    function formatDateLong(dateStr) {
        const date = new Date(dateStr);
        const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const months = ['January', 'February', 'March', 'April', 'May', 'June', 
                       'July', 'August', 'September', 'October', 'November', 'December'];
        return `${days[date.getDay()]}, ${months[date.getMonth()]} ${date.getDate()}, ${date.getFullYear}`;
    }
    
    // Build trip text
    let tripText = 'ROUND THE WORLD TRIP\n';
    tripText += '='.repeat(50) + '\n\n';
    
    AppState.selectedSegments.forEach((seg, index) => {
        totalDistance += seg.distance_miles || 0;
        
        if (seg.business_miles_int > 0) totalBusinessMiles += seg.business_miles_int;
        if (seg.premium_economy_miles_int > 0) totalPremiumMiles += seg.premium_economy_miles_int;
        if (seg.economy_miles_int > 0) totalEconomyMiles += seg.economy_miles_int;
        
        const originName = airportNames[seg.origin] || seg.origin;
        const destName = airportNames[seg.destination] || seg.destination;
        
        tripText += `Segment ${seg.segment}: ${seg.origin} → ${seg.destination}\n`;
        tripText += `  ${originName} → ${destName}\n`;
        tripText += `  Date: ${seg.date} (${formatDateLong(seg.date)})\n`;
        tripText += `  Class: ${seg.cabin_class}\n`;
        
        if (seg.business_miles_int > 0) {
            tripText += `  Award Miles: ${seg.business_miles_int.toLocaleString()} (Business)\n`;
            tripText += `  Airlines: ${seg.business_carriers || 'N/A'}\n`;
        } else if (seg.premium_economy_miles_int > 0) {
            tripText += `  Award Miles: ${seg.premium_economy_miles_int.toLocaleString()} (Premium Economy)\n`;
            tripText += `  Airlines: ${seg.premium_economy_carriers || 'N/A'}\n`;
        } else if (seg.economy_miles_int > 0) {
            tripText += `  Award Miles: ${seg.economy_miles_int.toLocaleString()} (Economy)\n`;
            tripText += `  Airlines: ${seg.economy_carriers || 'N/A'}\n`;
        } else {
            tripText += `  Award Miles: N/A\n`;
            tripText += `  Airlines: ${seg.economy_carriers || seg.premium_economy_carriers || seg.business_carriers || 'N/A'}\n`;
        }
        
        tripText += `  Distance: ${(seg.distance_miles || 0).toFixed(0).toLocaleString()} miles\n`;
        tripText += `  Direct: ${seg.is_direct ? 'Yes' : 'No'}`;
        if (!seg.is_direct) {
            tripText += ` (${seg.num_stops} stop${seg.num_stops !== 1 ? 's' : ''})`;
        }
        tripText += '\n';
        
        // Calculate days at destination
        if (index < AppState.selectedSegments.length - 1) {
            const nextSeg = AppState.selectedSegments[index + 1];
            const arrivalDate = new Date(seg.date);
            const departureDate = new Date(nextSeg.date);
            const daysDiff = Math.round((departureDate - arrivalDate) / (1000 * 60 * 60 * 24));
            if (daysDiff >= 0) {
                tripText += `  Days at ${seg.destination}: ${daysDiff} day${daysDiff !== 1 ? 's' : ''}\n`;
            }
        }
        
        tripText += '\n';
    });
    
    // Add summary
    tripText += '-'.repeat(50) + '\n';
    tripText += 'SUMMARY\n';
    tripText += '-'.repeat(50) + '\n';
    tripText += `Total Segments: ${AppState.selectedSegments.length}\n`;
    
    if (totalBusinessMiles > 0) {
        tripText += `Total Business Award Miles: ${totalBusinessMiles.toLocaleString()}\n`;
    }
    if (totalPremiumMiles > 0) {
        tripText += `Total Premium Economy Award Miles: ${totalPremiumMiles.toLocaleString()}\n`;
    }
    if (totalEconomyMiles > 0) {
        tripText += `Total Economy Award Miles: ${totalEconomyMiles.toLocaleString()}\n`;
    }
    
    tripText += `Total Distance: ${totalDistance.toFixed(0).toLocaleString()} miles\n`;
    
    const remainingMiles = 35000 - totalDistance;
    if (remainingMiles >= 0) {
        tripText += `Remaining under 35K limit: ${remainingMiles.toFixed(0).toLocaleString()} miles\n`;
    } else {
        tripText += `⚠️  EXCEEDS 35K LIMIT by ${Math.abs(remainingMiles).toFixed(0).toLocaleString()} miles!\n`;
    }
    
    // Calculate total trip duration
    if (AppState.selectedSegments.length > 1) {
        const startDate = new Date(AppState.selectedSegments[0].date);
        const endDate = new Date(AppState.selectedSegments[AppState.selectedSegments.length - 1].date);
        const totalDays = Math.round((endDate - startDate) / (1000 * 60 * 60 * 24));
        tripText += `Total Trip Duration: ${totalDays} days\n`;
    }
    
    // Copy to clipboard
    try {
        await navigator.clipboard.writeText(tripText);
        
        // Show success feedback
        const copyBtn = document.getElementById('copy-trip-btn');
        if (copyBtn) {
            const originalText = copyBtn.textContent;
            copyBtn.textContent = '✓ Copied!';
            copyBtn.style.background = '#4CAF50';
            setTimeout(() => {
                copyBtn.textContent = originalText;
                copyBtn.style.background = '';
            }, 2000);
        }
    } catch (error) {
        console.error('Failed to copy:', error);
        showError('Failed to copy to clipboard. Please select and copy manually.');
    }
}

function updateButtons() {
    const undoBtn = document.getElementById('undo-btn');
    const clearBtn = document.getElementById('clear-btn');
    const validateBtn = document.getElementById('validate-btn');
    const copyBtn = document.getElementById('copy-trip-btn');
    
    const hasSegments = AppState.selectedSegments.length > 0;
    
    if (undoBtn) {
        undoBtn.disabled = !hasSegments;
        undoBtn.style.opacity = hasSegments ? '1' : '0.5';
    }
    if (clearBtn) clearBtn.disabled = !hasSegments;
    if (validateBtn) validateBtn.disabled = !hasSegments;
    if (copyBtn) {
        copyBtn.disabled = !hasSegments;
        copyBtn.style.opacity = hasSegments ? '1' : '0.5';
    }
}

async function validateTrip() {
    try {
        const response = await fetch('/api/validate-trip', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ segments: AppState.selectedSegments })
        });
        
        const validation = await response.json();
        const modal = document.getElementById('validation-modal');
        const resultsDiv = document.getElementById('validation-results');
        
        let html = validation.valid 
            ? '<div class="validation-result validation-valid">✓ Trip is VALID for oneworld RTW ticket!</div>'
            : `<div class="validation-result validation-error">❌ Trip has validation errors:</div>${validation.errors.map(e => `<div class="validation-error">• ${e}</div>`).join('')}`;
        
        if (validation.warnings?.length > 0) {
            html += `<div class="validation-result validation-warning">⚠️ Warnings:</div>${validation.warnings.map(w => `<div class="validation-warning">• ${w}</div>`).join('')}`;
        }
        
        html += `<div class="validation-summary">
            <div class="validation-summary-item">Total Segments: ${validation.num_segments}</div>
            <div class="validation-summary-item">Continents: ${validation.num_continents} ${validation.continents_visited.join(', ')}</div>
            <div class="validation-summary-item">Atlantic Crossed: ${validation.atlantic_crossed ? '✓' : '✗'}</div>
            <div class="validation-summary-item">Pacific Crossed: ${validation.pacific_crossed ? '✓' : '✗'}</div>
            <div class="validation-summary-item">Total Distance: ${validation.total_distance_miles.toFixed(0)} miles</div>
            <div class="validation-summary-item">Total Days: ${validation.total_days}</div>
        </div>`;
        
        resultsDiv.innerHTML = html;
        modal.classList.add('show');
    } catch (error) {
        console.error('Error validating trip:', error);
        showError('Failed to validate trip');
    }
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function expandDateRange() {
    const dateRangeSelect = document.getElementById('date-range');
    const currentValue = parseInt(dateRangeSelect.value);
    if (currentValue < 5) {
        dateRangeSelect.value = Math.min(currentValue + 2, 5);
        if (AppState.currentOrigin && AppState.currentDate) {
            loadFlightsFromAirport(AppState.currentOrigin, AppState.currentDate);
        }
    }
}

async function showNearbyAirports(airport) {
    try {
        const response = await fetch(`/api/nearby-airports?airport=${airport}`);
        const data = await response.json();
        
        if (data.airports?.length > 0) {
            const list = data.airports.map(a => 
                `<button class="btn btn-secondary" style="width: 100%; margin-bottom: 0.5rem;" onclick="loadFlightsFromAirport('${a.code}', '${AppState.currentDate}')">${a.code} (${a.name}) - ${a.distance} miles</button>`
            ).join('');
            
            document.getElementById('flight-list').innerHTML = `<h4>Nearby Airports:</h4>${list}`;
        }
    } catch (error) {
        console.error('Error loading nearby airports:', error);
    }
}

// =============================================================================
// EVENT LISTENERS
// =============================================================================

document.addEventListener('DOMContentLoaded', () => {
    initMap();
    
    // Load Flights button
    document.getElementById('load-flights-btn').addEventListener('click', async () => {
        const airports = document.getElementById('starting-airports').value
            .split(',').map(a => a.trim().toUpperCase()).filter(a => a);
        const direction = document.getElementById('planning-direction')?.value || 'forward';
        const date = direction === 'backward' 
            ? (document.getElementById('end-date')?.value || document.getElementById('start-date')?.value)
            : document.getElementById('start-date')?.value;
        
        if (airports.length > 0 && date) {
            AppState.startingAirports = airports;
            await zoomToAirport(airports[0], 6);
            loadFlightsFromAirport(airports[0], date);
        } else {
            showError('Please enter a starting airport and date');
        }
    });
    
    // Airport input blur - preview zoom
    document.getElementById('starting-airports').addEventListener('blur', async (e) => {
        const airports = e.target.value.split(',').map(a => a.trim().toUpperCase()).filter(a => a);
        if (airports.length > 0) await zoomToAirport(airports[0], 6);
    });
    
    // Filter changes - reload flights when any filter changes
    ['date-range', 'cabin-filter', 'miles-program'].forEach(id => {
        document.getElementById(id)?.addEventListener('change', () => {
            if (AppState.currentOrigin && AppState.currentDate) {
                loadFlightsFromAirport(AppState.currentOrigin, AppState.currentDate);
            }
        });
    });
    
    // Planning mode toggle
    const planningModeSelect = document.getElementById('planning-mode');
    const daysToStayGroup = document.getElementById('days-to-stay-group');
    const targetDateGroup = document.getElementById('target-date-group');
    
    planningModeSelect?.addEventListener('change', (e) => {
        if (e.target.value === 'days') {
            daysToStayGroup.style.display = 'block';
            targetDateGroup.style.display = 'none';
        } else {
            daysToStayGroup.style.display = 'none';
            targetDateGroup.style.display = 'block';
        }
    });
    
    // Days to stay / target date changes
    const updateFlightsForPlanning = debounce(() => {
        if (AppState.selectedSegments.length > 0 && AppState.currentOrigin) {
            const lastSegment = AppState.selectedSegments[AppState.selectedSegments.length - 1];
            const planningMode = planningModeSelect?.value || 'days';
            const isBackward = AppState.planningDirection === 'backward';
            
            let nextFlightDate;
            if (planningMode === 'days') {
                const daysToStay = parseInt(document.getElementById('days-to-stay')?.value || '3');
                const lastDate = new Date(lastSegment.date);
                // Backward: subtract days, Forward: add days
                lastDate.setDate(lastDate.getDate() + (isBackward ? -daysToStay : daysToStay));
                nextFlightDate = lastDate.toISOString().split('T')[0];
            } else {
                nextFlightDate = document.getElementById('target-date')?.value;
            }
            
            if (nextFlightDate) {
                document.getElementById('target-date').value = nextFlightDate;
                loadFlightsFromAirport(AppState.currentOrigin, nextFlightDate);
            }
        }
    }, 300);
    
    document.getElementById('days-to-stay')?.addEventListener('input', updateFlightsForPlanning);
    document.getElementById('target-date')?.addEventListener('change', updateFlightsForPlanning);
    
    // Action buttons
    document.getElementById('undo-btn')?.addEventListener('click', undoLast);
    document.getElementById('clear-btn')?.addEventListener('click', clearAll);
    document.getElementById('copy-trip-btn')?.addEventListener('click', copyTripToClipboard);
    document.getElementById('validate-btn')?.addEventListener('click', validateTrip);
    
    // Sidebar close
    document.getElementById('close-sidebar')?.addEventListener('click', () => {
        document.getElementById('flight-sidebar').classList.remove('open');
    });
    
    // Flight filter event listeners - auto-apply on change
    ['filter-continent', 'filter-date-start', 'filter-date-end', 'filter-class', 'filter-stops'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('change', () => {
                applyFlightFilters();
            });
            // For date inputs, also listen to input events with debounce
            if (id.startsWith('filter-date')) {
                el.addEventListener('input', () => {
                    clearTimeout(window.filterTimeout);
                    window.filterTimeout = setTimeout(() => {
                        applyFlightFilters();
                    }, 300);
                });
            }
        }
    });
    
    // Modal close
    document.querySelector('.close-modal')?.addEventListener('click', () => {
        document.getElementById('validation-modal').classList.remove('show');
    });
    
    document.getElementById('validation-modal')?.addEventListener('click', (e) => {
        if (e.target.id === 'validation-modal') e.target.classList.remove('show');
    });
});

// =============================================================================
// GLOBAL EXPORTS
// =============================================================================

window.loadFlightsFromAirport = loadFlightsFromAirport;
window.highlightRoute = highlightRoute;
window.clearHighlight = clearHighlight;
window.selectFlight = selectFlight;
window.expandDateRange = expandDateRange;
window.showNearbyAirports = showNearbyAirports;
window.undoLast = undoLast;
window.clearAll = clearAll;
window.copyTripToClipboard = copyTripToClipboard;
window.validateTrip = validateTrip;
window.filterByDestination = filterByDestination;
window.clearDestinationFilter = clearDestinationFilter;
window.editSegmentDate = editSegmentDate;

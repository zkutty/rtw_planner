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
    _pendingCoordFetches: {},  // airport key → Promise (deduplicates in-flight requests)

    // Filtering state
    allFlights: [],  // Unfiltered flights
    airportContinents: {},  // Cache for airport continent data

    // Map marker pool: airport code → { marker, routeLines[] }
    markerPool: {},

    // Lazy polyline cache: "${origin}-${destination}" → L.Polyline
    // Lines are created on first hover and reused, never pre-built.
    _lineCache: new Map(),

    // Last-rendered flight fingerprint for skip-if-unchanged guard
    _lastRenderedFlightKey: null
};

// Expose for backwards compatibility and debugging
window.selectedSegments = AppState.selectedSegments;

// =============================================================================
// CLIENT-SIDE RTW VALIDATOR (mirrors lib/interactive_rtw_planner.py logic)
// Eliminates the /api/validate-trip round-trip on every segment change.
// =============================================================================

const RTWValidator = (() => {
    const CONTINENTS = {
        'North America': new Set(['JFK','EWR','LAX','SFO','ORD','MIA','DFW','ATL','BOS','SEA','YYZ','YVR','MEX','CUN','CLT','PHL','IAH','DEN','PHX','LAS']),
        'South America': new Set(['GRU','GIG','EZE','LIM','BOG','SCL','MVD','ASU']),
        'Europe':        new Set(['LHR','LGW','CDG','FRA','AMS','MAD','FCO','MUC','ZRH','VIE','CPH','ARN','OSL','HEL','DUB','LIS','ATH','BCN','MXP']),
        'Asia':          new Set(['HKG','NRT','HND','ICN','PEK','PVG','SIN','BKK','KUL','TPE','DEL','BOM','DXB','DOH','AUH','IST']),
        'Oceania':       new Set(['SYD','MEL','BNE','PER','AKL','WLG','NAN','PPT']),
        'Africa':        new Set(['JNB','CPT','CAI','ADD','NBO','DAR','CMN'])
    };

    function getContinent(code) {
        code = code.toUpperCase();
        for (const [name, set] of Object.entries(CONTINENTS)) {
            if (set.has(code)) return name;
        }
        return null;
    }

    function getZone(code) {
        const c = getContinent(code);
        if (!c) return null;
        if (c === 'North America' || c === 'South America') return 'Americas';
        if (c === 'Europe' || c === 'Africa') return 'Europe/Africa';
        if (c === 'Asia' || c === 'Oceania') return 'Asia/Oceania';
        return null;
    }

    function isAtlantic(o, d) {
        const oz = getZone(o), dz = getZone(d);
        return oz && dz && ((oz === 'Americas' && dz === 'Europe/Africa') || (oz === 'Europe/Africa' && dz === 'Americas'));
    }

    function isPacific(o, d) {
        const oz = getZone(o), dz = getZone(d);
        return oz && dz && ((oz === 'Americas' && dz === 'Asia/Oceania') || (oz === 'Asia/Oceania' && dz === 'Americas'));
    }

    function validate(segments) {
        if (!segments || segments.length === 0) {
            return { valid: false, errors: ['No segments in trip'], warnings: [], num_segments: 0, num_continents: 0, continents_visited: [], atlantic_crossed: false, pacific_crossed: false, total_distance_miles: 0, remaining_miles: 35000 };
        }

        const errors = [], warnings = [];
        const n = segments.length;

        // Rule 1: segment count
        if (n < 3) errors.push(`Minimum 3 segments required, found ${n}`);
        else if (n > 16) errors.push(`Maximum 16 segments allowed, found ${n}`);

        // Rule 2: return to origin
        const origin = segments[0].origin.toUpperCase();
        const finalDest = segments[n - 1].destination.toUpperCase();
        if (finalDest !== origin) errors.push(`Must return to origin (${origin}), final destination is ${finalDest}`);

        // Rule 3 & 4: ocean crossings
        let atlanticCount = 0, pacificCount = 0;
        for (const seg of segments) {
            const o = seg.origin.toUpperCase(), d = seg.destination.toUpperCase();
            if (isAtlantic(o, d)) atlanticCount++;
            if (isPacific(o, d)) pacificCount++;
        }
        if (atlanticCount === 0) errors.push('Must cross Atlantic Ocean at least once');
        if (pacificCount === 0) errors.push('Must cross Pacific Ocean at least once');
        if (atlanticCount > 1) errors.push(`Only one Atlantic crossing permitted, found ${atlanticCount}`);
        if (pacificCount > 1) errors.push(`Only one Pacific crossing permitted, found ${pacificCount}`);

        // Rule 5: continents
        const continentsVisited = new Set();
        for (const seg of segments) {
            const oc = getContinent(seg.origin), dc = getContinent(seg.destination);
            if (oc) continentsVisited.add(oc);
            if (dc) continentsVisited.add(dc);
        }
        const numContinents = continentsVisited.size;
        if (numContinents < 3) warnings.push(`Only ${numContinents} continent(s) visited. RTW fare based on 3-6 continents.`);
        else if (numContinents > 6) warnings.push(`${numContinents} continents visited (max 6 for fare calculation)`);

        // Distance
        const RTW_LIMIT = 35000;
        const totalDistance = segments.reduce((sum, s) => sum + (s.distance_miles || 0), 0);
        if (totalDistance > RTW_LIMIT) errors.push(`Total distance (${totalDistance.toFixed(0)} miles) exceeds 35,000 mile limit`);
        else if (totalDistance > RTW_LIMIT * 0.95) warnings.push(`Total distance (${totalDistance.toFixed(0)} miles) is close to 35,000 mile limit`);

        // Stopovers
        const stopovers = [];
        for (let i = 0; i < segments.length - 1; i++) {
            const curr = new Date(segments[i].date), next = new Date(segments[i + 1].date);
            const hours = (next - curr) / 3600000;
            if (hours > 24) stopovers.push({ airport: segments[i].destination, days: hours / 24, segment: i + 1 });
        }

        const totalDays = segments.length > 1
            ? Math.round((new Date(segments[n - 1].date) - new Date(segments[0].date)) / 86400000)
            : 0;

        return {
            valid: errors.length === 0,
            errors, warnings,
            num_segments: n,
            num_continents: numContinents,
            continents_visited: [...continentsVisited].sort(),
            atlantic_crossed: atlanticCount > 0,
            pacific_crossed: pacificCount > 0,
            stopovers, total_days: totalDays,
            total_distance_miles: totalDistance,
            remaining_miles: RTW_LIMIT - totalDistance
        };
    }

    return { validate, getContinent };
})();

// =============================================================================
// CACHED DOM REFERENCES (populated in DOMContentLoaded)
// =============================================================================

const DOM = {};

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
 * Show a non-blocking in-app toast notification (replaces alert())
 */
function showError(message) {
    let toast = document.getElementById('_appToast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = '_appToast';
        toast.className = 'app-toast';
        document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('visible');
    clearTimeout(toast._hideTimer);
    toast._hideTimer = setTimeout(() => toast.classList.remove('visible'), 3500);
}

/**
 * Show an in-app confirm dialog (replaces confirm()).
 * Returns a Promise<boolean>.
 */
function showConfirm(message) {
    return new Promise(resolve => {
        const overlay = document.createElement('div');
        overlay.className = 'app-confirm-overlay';
        overlay.innerHTML = `
            <div class="app-confirm-box">
                <p>${message}</p>
                <div class="app-confirm-actions">
                    <button class="btn-cancel">Cancel</button>
                    <button class="btn-confirm">Confirm</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        overlay.querySelector('.btn-cancel').addEventListener('click', () => {
            document.body.removeChild(overlay);
            resolve(false);
        });
        overlay.querySelector('.btn-confirm').addEventListener('click', () => {
            document.body.removeChild(overlay);
            resolve(true);
        });
    });
}

/**
 * Get airport coordinates (with caching and in-flight request deduplication)
 */
async function getAirportCoords(airports) {
    // Split into already-cached, already-pending, and truly new
    const pending = AppState._pendingCoordFetches;
    const toFetch = airports.filter(a => !AppState.airportCoordsCache[a] && !pending[a]);

    if (toFetch.length > 0) {
        const fetchPromise = fetch(`/api/airport-coords?${toFetch.map(a => `airports=${a}`).join('&')}`)
            .then(r => r.json())
            .then(coords => {
                Object.assign(AppState.airportCoordsCache, coords);
                toFetch.forEach(a => delete pending[a]);
            })
            .catch(err => {
                console.error('Error fetching coordinates:', err);
                toFetch.forEach(a => delete pending[a]);
            });
        // Register the same promise for all airports in this batch
        toFetch.forEach(a => { pending[a] = fetchPromise; });
        await fetchPromise;
    }

    // Also await any already-pending fetches for airports we need
    const stillPending = airports.filter(a => pending[a]);
    if (stillPending.length > 0) {
        await Promise.all([...new Set(stillPending.map(a => pending[a]))]);
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

    // Remove any cached route lines from the map
    AppState._lineCache.forEach(line => {
        if (AppState.map.hasLayer(line)) AppState.map.removeLayer(line);
    });
    AppState._lineCache.clear();

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

        if (route) {
            if (AppState.currentHighlightedRoute && AppState.currentHighlightedRoute !== routeKey) {
                clearHighlight();
            }

            requestAnimationFrame(() => {
                // Create line lazily on first hover, reuse on subsequent hovers
                let line = AppState._lineCache.get(routeKey);
                if (!line) {
                    const isDirect = route.flight.is_direct;
                    const color = route.marker._cabinClass === 'business' ? '#667eea'
                        : route.marker._cabinClass === 'premium' ? '#4CAF50' : '#FF9800';
                    const path = getGreatCirclePath(route._mainCoords, route._airportCoords);
                    line = L.polyline(path, {
                        color,
                        weight: 4,
                        opacity: 0.9,
                        dashArray: isDirect ? null : '5, 5'
                    }).addTo(AppState.map);
                    AppState._lineCache.set(routeKey, line);
                } else {
                    line.setStyle({ opacity: 0.9, weight: 4 });
                    if (!AppState.map.hasLayer(line)) line.addTo(AppState.map);
                }
                AppState.hoverLine = line;

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
            // Remove from map (lazy lines are not permanently on the map)
            if (AppState.map.hasLayer(AppState.hoverLine)) {
                AppState.map.removeLayer(AppState.hoverLine);
            }
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
    
    const loadBtn = DOM.loadFlightsBtn;
    if (loadBtn) {
        loadBtn.disabled = true;
        loadBtn.textContent = 'Loading...';
    }

    // Show loading overlay
    const loadingOverlay = DOM.loadingOverlay;
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
    const flightList = DOM.flightList || document.getElementById('flight-list');
    if (!flightList) return;

    // Skip full re-render if the same flights are already displayed
    const key = flights.map(f => `${f.origin}${f.destination}${f.date}`).join('|') + '|' + direction;
    if (key === AppState._lastRenderedFlightKey && !targetDateRange) return;
    AppState._lastRenderedFlightKey = key;
    
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
                 data-origin="${flight.origin}"
                 data-dest="${flight.destination}"
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
        
        // Store route metadata for lazy line creation on hover
        airportFlights.forEach(flight => {
            AppState.routeLines.push({ marker, flight, _mainCoords: mainCoords, _airportCoords: airportCoords });
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
        
        // Save state for undo before modifying
        UndoRedo.pushUndo();

        // Add segment
        if (AppState.planningDirection === 'backward') {
            AppState.selectedSegments.unshift(segment);
            AppState.selectedSegments.forEach((seg, i) => seg.segment = i + 1);
        } else {
            AppState.selectedSegments.push(segment);
        }

        // Update global reference
        window.selectedSegments = AppState.selectedSegments;

        // Persist to localStorage
        TripStorage.save();

        // Update UI
        redrawSelectedRoutes();
        updateTripSummary();
        updateProgressBar();
        updateButtons();
        
        // Update table view if active
        if (document.getElementById('table-view-container')?.classList.contains('active')) {
            updateSelectedFlightsTable();
        }
        
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

    // Use undo/redo stack for full state restoration
    UndoRedo.undo();

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
    updateProgressBar();
    updateButtons();
    TripStorage.save();

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
                currentDate.setDate(currentDate.getDate() + (isBackward ? -daysToStay : daysToStay));
                nextFlightDate = currentDate.toISOString().split('T')[0];
            } else {
                nextFlightDate = document.getElementById('target-date')?.value || nextFlightDate;
            }

            const nextAirport = isBackward ? lastSeg.origin : lastSeg.destination;
            loadFlightsFromAirport(nextAirport, nextFlightDate);
        } else {
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

function redoLast() {
    UndoRedo.redo();
    TripStorage.save();
}

async function clearAll() {
    if (AppState.isLoadingFlights || AppState.isSelectingFlight) return;
    if (!(await showConfirm('Clear all segments?'))) return;

    // Save state for undo before clearing
    UndoRedo.pushUndo();

    AppState.selectedSegments = [];
    window.selectedSegments = AppState.selectedSegments;

    AppState.selectedRouteLines.forEach(({ line }) => AppState.map.removeLayer(line));
    AppState.selectedRouteLines = [];

    const nextFlightSection = document.getElementById('next-flight-section');
    if (nextFlightSection) nextFlightSection.style.display = 'none';

    clearMap();
    updateTripSummary();
    updateProgressBar();
    updateButtons();
    TripStorage.save();

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

    UndoRedo.pushUndo();
    segment.date = newDate;
    TripStorage.save();
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

function updateTripSummary() {
    const summaryDiv = DOM.tripSummary || document.getElementById('trip-summary');
    const requirementsDiv = DOM.tripRequirements || document.getElementById('trip-requirements');
    const requirementsStatus = DOM.requirementsStatus || document.getElementById('requirements-status');
    
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
    
    // Validate using client-side validator (no API call needed)
    if (requirementsDiv && requirementsStatus) {
        const validation = RTWValidator.validate(AppState.selectedSegments);
        const returnsToOrigin = !validation.errors.some(e => e.includes('return to origin'));
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
                <span style="color: ${returnsToOrigin ? '#4CAF50' : '#f44336'};">
                    ${returnsToOrigin ? '✓' : '✗'}
                </span>
                <strong>Return to Origin:</strong> ${returnsToOrigin ? 'Yes' : 'No'}
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

    // Keep progress bar in sync
    updateProgressBar();
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
    const exportBtn = document.getElementById('export-trip-btn');

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
    if (exportBtn) {
        exportBtn.disabled = !hasSegments;
        exportBtn.style.opacity = hasSegments ? '1' : '0.5';
    }
    UndoRedo._updateButtons();
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
    // Cache frequently-accessed DOM elements to avoid repeated querySelector lookups
    DOM.flightList        = document.getElementById('flight-list');
    DOM.tripSummary       = document.getElementById('trip-summary');
    DOM.tripRequirements  = document.getElementById('trip-requirements');
    DOM.requirementsStatus = document.getElementById('requirements-status');
    DOM.loadingOverlay    = document.getElementById('loading-overlay');
    DOM.loadFlightsBtn    = document.getElementById('load-flights-btn');

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

    // Touch support for flight item route highlighting (mirrors mouse hover behaviour)
    // Uses event delegation on the flight list container so it works for dynamically rendered items.
    const flightListEl = DOM.flightList;
    if (flightListEl) {
        flightListEl.addEventListener('touchstart', e => {
            const item = e.target.closest('.flight-item[data-flight-index]');
            if (!item) return;
            const origin = item.getAttribute('data-origin');
            const dest = item.getAttribute('data-dest');
            if (origin && dest) highlightRoute(origin, dest);
        }, { passive: true });

        flightListEl.addEventListener('touchend', () => {
            clearHighlight();
        }, { passive: true });
    }
    
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
    
    // Tab navigation
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tabName = btn.dataset.tab;
            switchTab(tabName);
        });
    });
    
    // Dark mode
    DarkMode.init();
    document.getElementById('dark-mode-toggle')?.addEventListener('click', DarkMode.toggle);

    // Redo button
    document.getElementById('redo-btn')?.addEventListener('click', redoLast);

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        // Ctrl/Cmd+Z = undo, Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y = redo
        if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
            e.preventDefault();
            undoLast();
        } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
            e.preventDefault();
            redoLast();
        }
    });

    // Save/load trip buttons
    document.getElementById('save-trip-btn')?.addEventListener('click', () => {
        TripStorage.save();
        const btn = document.getElementById('save-trip-btn');
        if (btn) { const orig = btn.textContent; btn.textContent = '✓ Saved!'; setTimeout(() => btn.textContent = orig, 1500); }
    });
    document.getElementById('export-trip-btn')?.addEventListener('click', exportTrip);
    document.getElementById('import-trip-input')?.addEventListener('change', (e) => {
        if (e.target.files[0]) importTrip(e.target.files[0]);
        e.target.value = '';
    });

    // Restore saved trip from localStorage (if any)
    const restored = TripStorage.restore();
    if (restored) {
        updateProgressBar();
    }

    // Table view initialization
    initTableView();
});

// =============================================================================
// TRIP PERSISTENCE (localStorage save/load)
// =============================================================================

const TripStorage = (() => {
    const STORAGE_KEY = 'rtw_planner_trip';
    const SETTINGS_KEY = 'rtw_planner_settings';

    function save() {
        if (AppState.selectedSegments.length === 0) {
            localStorage.removeItem(STORAGE_KEY);
            return;
        }
        const data = {
            segments: AppState.selectedSegments,
            savedAt: new Date().toISOString(),
            settings: {
                startingAirports: AppState.startingAirports,
                startDate: document.getElementById('start-date')?.value,
                endDate: document.getElementById('end-date')?.value,
                mustVisitCities: document.getElementById('must-visit-cities')?.value,
                planningDirection: document.getElementById('planning-direction')?.value,
                milesProgram: document.getElementById('miles-program')?.value,
                cabinFilter: document.getElementById('cabin-filter')?.value,
                dateRange: document.getElementById('date-range')?.value
            }
        };
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        } catch (e) {
            console.warn('Failed to save trip to localStorage:', e);
        }
    }

    function load() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return null;
            return JSON.parse(raw);
        } catch (e) {
            console.warn('Failed to load trip from localStorage:', e);
            return null;
        }
    }

    function clear() {
        localStorage.removeItem(STORAGE_KEY);
    }

    function restore() {
        const data = load();
        if (!data || !data.segments || data.segments.length === 0) return false;

        // Restore settings first
        const s = data.settings || {};
        if (s.startDate) { const el = document.getElementById('start-date'); if (el) el.value = s.startDate; }
        if (s.endDate) { const el = document.getElementById('end-date'); if (el) el.value = s.endDate; }
        if (s.mustVisitCities) { const el = document.getElementById('must-visit-cities'); if (el) el.value = s.mustVisitCities; }
        if (s.planningDirection) { const el = document.getElementById('planning-direction'); if (el) el.value = s.planningDirection; }
        if (s.milesProgram) { const el = document.getElementById('miles-program'); if (el) el.value = s.milesProgram; }
        if (s.cabinFilter) { const el = document.getElementById('cabin-filter'); if (el) el.value = s.cabinFilter; }
        if (s.dateRange) { const el = document.getElementById('date-range'); if (el) el.value = s.dateRange; }

        if (s.startingAirports) AppState.startingAirports = s.startingAirports;
        if (s.planningDirection) AppState.planningDirection = s.planningDirection;

        // Restore segments
        AppState.selectedSegments = data.segments;
        window.selectedSegments = AppState.selectedSegments;

        redrawSelectedRoutes();
        updateTripSummary();
        updateProgressBar();
        updateButtons();
        return true;
    }

    return { save, load, clear, restore };
})();

function exportTrip() {
    if (AppState.selectedSegments.length === 0) {
        showError('No trip to export');
        return;
    }
    const data = {
        segments: AppState.selectedSegments,
        exportedAt: new Date().toISOString()
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rtw-trip-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
}

function importTrip(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = JSON.parse(e.target.result);
            if (!data.segments || !Array.isArray(data.segments) || data.segments.length === 0) {
                showError('Invalid trip file: no segments found');
                return;
            }
            AppState.selectedSegments = data.segments;
            window.selectedSegments = AppState.selectedSegments;
            redrawSelectedRoutes();
            updateTripSummary();
            updateProgressBar();
            updateButtons();
            TripStorage.save();
            showError('Trip imported successfully!');
        } catch (err) {
            showError('Failed to parse trip file');
        }
    };
    reader.readAsText(file);
}

// =============================================================================
// UNDO / REDO STACK
// =============================================================================

const UndoRedo = (() => {
    const undoStack = [];
    const redoStack = [];
    const MAX_HISTORY = 50;

    function snapshot() {
        return JSON.parse(JSON.stringify(AppState.selectedSegments));
    }

    function pushUndo() {
        undoStack.push(snapshot());
        if (undoStack.length > MAX_HISTORY) undoStack.shift();
        // Any new action clears the redo stack
        redoStack.length = 0;
        _updateButtons();
    }

    function undo() {
        if (undoStack.length === 0) return;
        redoStack.push(snapshot());
        const prev = undoStack.pop();
        _applyState(prev);
        _updateButtons();
    }

    function redo() {
        if (redoStack.length === 0) return;
        undoStack.push(snapshot());
        const next = redoStack.pop();
        _applyState(next);
        _updateButtons();
    }

    function _applyState(segments) {
        AppState.selectedSegments = segments;
        window.selectedSegments = AppState.selectedSegments;
        redrawSelectedRoutes();
        updateTripSummary();
        updateProgressBar();
        updateButtons();
        TripStorage.save();
    }

    function _updateButtons() {
        const undoBtn = document.getElementById('undo-btn');
        const redoBtn = document.getElementById('redo-btn');
        if (undoBtn) {
            undoBtn.disabled = undoStack.length === 0 && AppState.selectedSegments.length === 0;
        }
        if (redoBtn) {
            redoBtn.disabled = redoStack.length === 0;
            redoBtn.style.opacity = redoStack.length > 0 ? '1' : '0.5';
        }
    }

    function clear() {
        undoStack.length = 0;
        redoStack.length = 0;
        _updateButtons();
    }

    return { pushUndo, undo, redo, clear, _updateButtons };
})();

// =============================================================================
// VISUAL PROGRESS BAR
// =============================================================================

function updateProgressBar() {
    const bar = document.getElementById('trip-progress-bar');
    if (!bar) return;

    const segments = AppState.selectedSegments;
    if (segments.length === 0) {
        bar.style.display = 'none';
        return;
    }
    bar.style.display = 'block';

    const validation = RTWValidator.validate(segments);
    const totalDistance = validation.total_distance_miles;
    const distancePct = Math.min((totalDistance / 35000) * 100, 100);
    const segmentPct = Math.min((validation.num_segments / 3) * 100, 100);
    const continentPct = Math.min((validation.num_continents / 3) * 100, 100);

    // Distance bar
    const distFill = bar.querySelector('.progress-distance-fill');
    const distLabel = bar.querySelector('.progress-distance-label');
    if (distFill) {
        distFill.style.width = distancePct + '%';
        distFill.className = 'progress-fill progress-distance-fill' + (totalDistance > 35000 ? ' over-limit' : totalDistance > 33250 ? ' near-limit' : '');
    }
    if (distLabel) distLabel.textContent = `${Math.round(totalDistance).toLocaleString()} / 35,000 mi`;

    // Checklist items
    const items = bar.querySelectorAll('.progress-check');
    items.forEach(item => {
        const check = item.dataset.check;
        let done = false;
        if (check === 'segments') done = validation.num_segments >= 3;
        else if (check === 'atlantic') done = validation.atlantic_crossed;
        else if (check === 'pacific') done = validation.pacific_crossed;
        else if (check === 'continents') done = validation.num_continents >= 3;
        else if (check === 'return') done = !validation.errors.some(e => e.includes('return to origin'));
        item.classList.toggle('done', done);
    });
}

// =============================================================================
// DARK MODE
// =============================================================================

const DarkMode = (() => {
    const STORAGE_KEY = 'rtw_planner_dark_mode';

    function isEnabled() {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored !== null) return stored === 'true';
        return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }

    function apply(enabled) {
        document.documentElement.classList.toggle('dark', enabled);
        document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', enabled ? 'dark' : 'light');
        localStorage.setItem(STORAGE_KEY, String(enabled));
        const btn = document.getElementById('dark-mode-toggle');
        if (btn) btn.textContent = enabled ? '☀️' : '🌙';
    }

    function toggle() {
        apply(!document.documentElement.classList.contains('dark'));
    }

    function init() {
        apply(isEnabled());
    }

    return { init, toggle };
})();

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
window.clearTableFilters = clearTableFilters;
window.exportTrip = exportTrip;
window.importTrip = importTrip;
window.redoLast = redoLast;

// =============================================================================
// TABLE VIEW FUNCTIONALITY
// =============================================================================

// Table view state
const TableViewState = {
    availableFlights: [],
    filteredFlights: [],
    currentOrigin: null,
    currentDate: null,
    loadingFlights: false
};

// Tab switching
function switchTab(tabName) {
    // Update tab buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
        if (btn.dataset.tab === tabName) {
            btn.classList.add('active');
            btn.style.color = 'white';
            btn.style.borderBottomColor = 'white';
        } else {
            btn.classList.remove('active');
            btn.style.color = 'rgba(255,255,255,0.7)';
            btn.style.borderBottomColor = 'transparent';
        }
    });
    
    // Show/hide view containers
    if (tabName === 'map-view') {
        document.getElementById('map-view-container').classList.add('active');
        document.getElementById('map-view-container').style.display = 'flex';
        document.getElementById('table-view-container').classList.remove('active');
        document.getElementById('table-view-container').style.display = 'none';
    } else if (tabName === 'table-view') {
        document.getElementById('table-view-container').classList.add('active');
        document.getElementById('table-view-container').style.display = 'flex';
        document.getElementById('map-view-container').classList.remove('active');
        document.getElementById('map-view-container').style.display = 'none';
        
        // Update selected flights table when switching to table view
        updateSelectedFlightsTable();
        
        // If we have segments but no available flights loaded, load from last segment
        // Table view is always forward-looking
        if (AppState.selectedSegments.length > 0 && TableViewState.availableFlights.length === 0) {
            const lastSegment = AppState.selectedSegments[AppState.selectedSegments.length - 1];
            const nextOrigin = lastSegment.destination;
            const daysToStay = parseInt(document.getElementById('days-to-stay')?.value || '3');
            const lastDate = new Date(lastSegment.date);
            
            let nextDate = new Date(lastDate);
            nextDate.setDate(nextDate.getDate() + daysToStay);
            
            document.getElementById('table-filter-origin').value = nextOrigin;
            loadFlightsForTableView(nextOrigin, nextDate.toISOString().split('T')[0], 'forward');
        }
    }
}

// Initialize table view
function initTableView() {
    console.log('Initializing table view...');
    
    // Load initial flights button - ALWAYS use forward direction for table view
    const loadBtn = document.getElementById('table-load-flights-btn');
    if (loadBtn) {
        console.log('Found table-load-flights-btn, attaching event listener');
        loadBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            console.log('Load Initial Flights button clicked');
            try {
                // Use pre-seeded values from filters (which are set from map page defaults)
                const origin = document.getElementById('table-filter-origin')?.value?.trim().toUpperCase() || 
                              (document.getElementById('starting-airports')?.value?.split(',')[0]?.trim().toUpperCase() || 'JFK');
                const startDate = document.getElementById('start-date')?.value || '2026-03-27';
                // Table view is ALWAYS forward-looking
                const direction = 'forward';
                
                console.log(`Loading flights for table view: origin=${origin}, date=${startDate}, direction=${direction}`);
                await loadFlightsForTableView(origin, startDate, direction);
            } catch (error) {
                console.error('Error in load button handler:', error);
                showError('Failed to load flights: ' + error.message);
            }
        });
    } else {
        console.error('table-load-flights-btn not found!');
    }
    
    // Table clear all button
    document.getElementById('table-clear-all-btn')?.addEventListener('click', async () => {
        if (AppState.selectedSegments.length > 0 && await showConfirm('Clear all selected flights?')) {
            clearAll();
            updateSelectedFlightsTable();
            TableViewState.availableFlights = [];
            TableViewState.filteredFlights = [];
            updateAvailableFlightsTable();
        }
    });
    
    // Table filter listeners
    // Origin filter triggers new API call (independent search)
    const originFilterEl = document.getElementById('table-filter-origin');
    if (originFilterEl) {
        originFilterEl.addEventListener('change', async () => {
            const origin = originFilterEl.value.trim().toUpperCase();
            if (origin && origin.length >= 3) {
                const startDate = document.getElementById('start-date')?.value || '2026-03-27';
                console.log('Origin filter changed, loading flights from:', origin);
                await loadFlightsForTableView(origin, startDate, 'forward');
            }
        });
        originFilterEl.addEventListener('input', debounce(async () => {
            const origin = originFilterEl.value.trim().toUpperCase();
            if (origin && origin.length >= 3) {
                const startDate = document.getElementById('start-date')?.value || '2026-03-27';
                console.log('Origin filter input, loading flights from:', origin);
                await loadFlightsForTableView(origin, startDate, 'forward');
            }
        }, 800)); // Longer delay for API calls
    }
    
    // Other filters just filter existing data (no API calls)
    ['table-filter-destination', 'table-filter-date', 
     'table-filter-class', 'table-filter-airline', 'table-filter-continent'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('change', applyTableFilters);
            if (id === 'table-filter-date' || id === 'table-filter-airline' || id === 'table-filter-destination') {
                el.addEventListener('input', debounce(applyTableFilters, 300));
            }
        }
    });
    
    // Expand/collapse flights table
    const expandBtn = document.getElementById('expand-flights-table-btn');
    const tableContainer = document.getElementById('available-flights-table-container');
    const expandIcon = document.getElementById('expand-flights-icon');
    const expandText = document.getElementById('expand-flights-text');
    
    if (expandBtn && tableContainer && expandIcon && expandText) {
        console.log('Setting up expand button');
        expandBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            console.log('Expand button clicked');
            const isExpanded = tableContainer.classList.contains('expanded');
            
            if (isExpanded) {
                // Collapse
                tableContainer.classList.remove('expanded');
                tableContainer.style.maxHeight = '400px';
                if (expandIcon) expandIcon.textContent = '⬍';
                if (expandText) expandText.textContent = 'Expand';
            } else {
                // Expand to full screen
                tableContainer.classList.add('expanded');
                tableContainer.style.maxHeight = 'calc(100vh - 300px)';
                if (expandIcon) expandIcon.textContent = '⬌';
                if (expandText) expandText.textContent = 'Collapse';
            }
        });
    } else {
        console.error('Expand button elements not found:', { expandBtn, tableContainer, expandIcon, expandText });
    }
    
    // Pre-seed filters with default values from map page
    const startingAirports = document.getElementById('starting-airports')?.value?.split(',') || ['JFK'];
    
    const originFilter = document.getElementById('table-filter-origin');
    
    if (originFilter) originFilter.value = startingAirports[0].trim().toUpperCase();
    // Date filter is optional - leave empty by default
}

// Load flights for table view
async function loadFlightsForTableView(origin, date, direction) {
    console.log('loadFlightsForTableView called', { origin, date, direction });
    
    if (TableViewState.loadingFlights) {
        console.log('Already loading, skipping...');
        return;
    }
    
    TableViewState.loadingFlights = true;
    TableViewState.currentOrigin = origin;
    TableViewState.currentDate = date;
    
    const btn = document.getElementById('table-load-flights-btn');
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Loading...';
    }
    
    try {
        const endpoint = direction === 'backward' ? '/api/flights-to' : '/api/flights';
        const milesProgram = document.getElementById('miles-program')?.value || 'qantas';
        const dateRange = parseInt(document.getElementById('date-range')?.value || '1');
        
        const params = direction === 'backward'
            ? `destination=${origin}&date=${date}&date_range=${dateRange}&source=${milesProgram}`
            : `origin=${origin}&date=${date}&date_range=${dateRange}&source=${milesProgram}`;
        
        const url = `${endpoint}?${params}`;
        console.log('Fetching from:', url);
        
        const response = await fetch(url);
        console.log('Response status:', response.status);
        
        const data = await response.json();
        console.log('Response data:', data);
        
        if (data.error) {
            showError(data.error);
            console.error('API error:', data.error);
            // Don't return here - let finally block reset button state
            TableViewState.availableFlights = [];
            TableViewState.filteredFlights = [];
            updateAvailableFlightsTable();
            return;
        }
        
        let flights = data.flights || [];
        console.log(`Received ${flights.length} flights from API`);
        
        // Filter OneWorld flights
        flights = filterOneWorldFlights(flights);
        console.log(`After OneWorld filter: ${flights.length} flights`);
        
        // Load continent data for filtering
        await loadContinentData(flights, direction);
        
        // Store flights
        TableViewState.availableFlights = flights;
        TableViewState.filteredFlights = flights;
        
        // Don't clear origin filter - keep it set to the origin we just loaded
        // Update available flights table
        updateAvailableFlightsTable();
        
        console.log(`Table view: Loaded ${flights.length} flights from ${origin} on ${date}`);
        
    } catch (error) {
        console.error('Error loading flights:', error);
        showError('Failed to load flights');
    } finally {
        TableViewState.loadingFlights = false;
        if (btn) {
            btn.disabled = false;
            btn.textContent = 'Load Initial Flights';
        }
    }
}

// Apply table filters
function applyTableFilters() {
    let filtered = [...TableViewState.availableFlights];
    
    const origin = document.getElementById('table-filter-origin')?.value?.trim().toUpperCase();
    const destination = document.getElementById('table-filter-destination')?.value?.trim().toUpperCase();
    const dateFilter = document.getElementById('table-filter-date')?.value?.trim();
    const classFilter = document.getElementById('table-filter-class')?.value;
    const airlineFilter = document.getElementById('table-filter-airline')?.value?.toLowerCase();
    const continentFilter = document.getElementById('table-filter-continent')?.value;
    
    // Origin filter - filters by the origin airport of flights (where they depart from)
    if (origin) {
        filtered = filtered.filter(flight => {
            return flight.origin === origin;
        });
    }
    
    // Destination filter - filters by the destination airport of flights
    if (destination) {
        filtered = filtered.filter(flight => {
            return flight.destination === destination;
        });
    }
    
    // Text-based date filter - matches any part of the date string (optional)
    if (dateFilter) {
        filtered = filtered.filter(flight => {
            const flightDateStr = flight.date || '';
            if (!flightDateStr) return false;
            
            // Normalize both strings for comparison (remove dashes, spaces)
            const normalizedFilter = dateFilter.replace(/[-\s]/g, '').toLowerCase();
            const normalizedDate = flightDateStr.replace(/[-\s]/g, '').toLowerCase();
            
            // Check if normalized filter is contained in normalized date
            // Supports formats like: "2026-03", "03-15", "2026-03-15", "03", "15", "20260315", etc.
            if (normalizedDate.includes(normalizedFilter)) {
                return true;
            }
            
            // Also try formatted date strings
            try {
                const flightDate = new Date(flightDateStr);
                const formattedDate = flightDate.toISOString().split('T')[0]; // YYYY-MM-DD
                const formattedUS = flightDate.toLocaleDateString('en-US'); // M/D/YYYY
                
                if (formattedDate.includes(dateFilter) || formattedUS.includes(dateFilter)) {
                    return true;
                }
            } catch (e) {
                // Invalid date, skip formatted check
            }
            
            return false;
        });
    }
    
    // Class filter
    if (classFilter) {
        filtered = filtered.filter(flight => {
            if (classFilter === 'business' && flight.business_miles_int === 0) return false;
            if (classFilter === 'premium' && flight.business_miles_int === 0 && flight.premium_economy_miles_int === 0) return false;
            if (classFilter === 'economy' && flight.economy_miles_int === 0) return false;
            return true;
        });
    }
    
    // Airline filter
    if (airlineFilter) {
        filtered = filtered.filter(flight => {
            const carriers = [
                flight.business_carriers || '',
                flight.premium_economy_carriers || '',
                flight.economy_carriers || ''
            ].join(' ').toLowerCase();
            
            return carriers.includes(airlineFilter);
        });
    }
    
    // Continent filter - table view is always forward-looking, so filter by destination continent
    if (continentFilter) {
        filtered = filtered.filter(flight => {
            const continent = AppState.airportContinents[flight.destination];
            // If continent data not loaded yet, include the flight (will be filtered when data loads)
            if (!continent) return true;
            return continent === continentFilter;
        });
    }
    
    TableViewState.filteredFlights = filtered;
    updateAvailableFlightsTable();
}

// Clear table filters
function clearTableFilters() {
    document.getElementById('table-filter-origin').value = '';
    document.getElementById('table-filter-destination').value = '';
    document.getElementById('table-filter-date').value = '';
    document.getElementById('table-filter-class').value = '';
    document.getElementById('table-filter-airline').value = '';
    document.getElementById('table-filter-continent').value = '';
    
    TableViewState.filteredFlights = [...TableViewState.availableFlights];
    updateAvailableFlightsTable();
}

// Update available flights table
function updateAvailableFlightsTable() {
    const tbody = document.getElementById('available-flights-tbody');
    const countSpan = document.getElementById('table-flights-count');
    
    if (!tbody) {
        console.error('available-flights-tbody not found!');
        return;
    }
    
    const flights = TableViewState.filteredFlights || [];
    console.log(`Updating available flights table with ${flights.length} flights`);
    
    if (countSpan) {
        countSpan.textContent = `(${flights.length} flight${flights.length !== 1 ? 's' : ''})`;
    }
    
    if (flights.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 2rem; color: #999;">No flights found. Adjust filters or load flights.</td></tr>';
        return;
    }
    
    tbody.innerHTML = flights.map((flight, index) => {
        const hasBusiness = flight.business_miles_int > 0;
        const hasPremium = flight.premium_economy_miles_int > 0;
        const hasEconomy = flight.economy_miles_int > 0;
        
        let cabinClass, miles, carriers;
        if (hasBusiness) {
            cabinClass = 'Business';
            miles = flight.business_miles_int;
            carriers = flight.business_carriers || 'N/A';
        } else if (hasPremium) {
            cabinClass = 'Premium Economy';
            miles = flight.premium_economy_miles_int;
            carriers = flight.premium_economy_carriers || 'N/A';
        } else {
            cabinClass = 'Economy';
            miles = flight.economy_miles_int;
            carriers = flight.economy_carriers || 'N/A';
        }
        
        // Table view is always forward-looking, so always show origin → destination
        const route = `${flight.origin} → ${flight.destination}`;
        
        return `
            <tr>
                <td><strong>${route}</strong></td>
                <td>${formatDate(flight.date)}</td>
                <td>${cabinClass}</td>
                <td>${miles ? miles.toLocaleString() : 'N/A'}</td>
                <td>${flight.distance_miles ? flight.distance_miles.toFixed(0) : 'N/A'} mi</td>
                <td>${carriers}</td>
                <td>${flight.is_direct ? 'Yes' : `${flight.num_stops} stop${flight.num_stops !== 1 ? 's' : ''}`}</td>
                <td>
                    <button class="action-btn btn-select" onclick="selectFlightFromTable(${index})">Select</button>
                </td>
            </tr>
        `;
    }).join('');
}

// Select flight from table
async function selectFlightFromTable(index) {
    const flight = TableViewState.filteredFlights[index];
    if (!flight) return;
    
    const direction = AppState.planningDirection || 'forward';
    
    // Use existing selectFlight function but with table-specific logic
    const cabinMiles = flight.business_miles_int || flight.premium_economy_miles_int || flight.economy_miles_int || 0;
    const businessMiles = flight.business_miles_int || 0;
    const premiumMiles = flight.premium_economy_miles_int || 0;
    const economyMiles = flight.economy_miles_int || 0;
    
    // Use -1 as index since we're selecting from table, not sidebar
    await selectFlight(
        -1,
        flight.origin,
        flight.destination,
        flight.date,
        flight.is_direct,
        flight.num_stops || 0,
        businessMiles,
        premiumMiles,
        economyMiles,
        flight.business_carriers || '',
        flight.premium_economy_carriers || '',
        flight.economy_carriers || ''
    );
    
    // Update selected flights table
    updateSelectedFlightsTable();
    
    // Auto-load next flights from destination - table view is always forward-looking
    const nextOrigin = flight.destination;
    const daysToStay = parseInt(document.getElementById('days-to-stay')?.value || '3');
    const flightDate = new Date(flight.date);
    
    let nextDate = new Date(flightDate);
    nextDate.setDate(nextDate.getDate() + daysToStay);
    
    // Update origin filter and load next flights (always forward)
    document.getElementById('table-filter-origin').value = nextOrigin;
    await loadFlightsForTableView(nextOrigin, nextDate.toISOString().split('T')[0], 'forward');
}

// Update selected flights table
function updateSelectedFlightsTable() {
    const tbody = document.getElementById('selected-flights-tbody');
    if (!tbody) return;
    
    const segments = AppState.selectedSegments || [];
    
    if (segments.length === 0) {
        tbody.innerHTML = '<tr><td colspan="10" style="text-align: center; padding: 2rem; color: #999;">No flights selected yet</td></tr>';
        return;
    }
    
    let cumulativeDistance = 0;
    
    tbody.innerHTML = segments.map((seg, index) => {
        cumulativeDistance += seg.distance_miles || 0;
        
        // Calculate arrival date - most flights arrive same day, long flights may arrive next day
        const departureDate = new Date(seg.date);
        const arrivalDate = new Date(departureDate);
        const flightHours = Math.ceil((seg.distance_miles || 0) / 500);
        arrivalDate.setHours(arrivalDate.getHours() + flightHours);
        
        // If flight duration would push into next day, set to next day
        if (arrivalDate.getDate() !== departureDate.getDate()) {
            // Already next day, keep it
        } else if (flightHours > 12) {
            // Very long flight, likely arrives next day
            arrivalDate.setDate(arrivalDate.getDate() + 1);
            arrivalDate.setHours(6, 0, 0, 0); // Typical arrival time
        }
        
        // Calculate time at location (from arrival date to next departure)
        let timeAtLocation = 'N/A';
        if (index < segments.length - 1) {
            const nextSegment = segments[index + 1];
            const nextDeparture = new Date(nextSegment.date);
            nextDeparture.setHours(0, 0, 0, 0);
            
            // Use arrival date (reset hours for comparison)
            const arrivalDateOnly = new Date(arrivalDate);
            arrivalDateOnly.setHours(0, 0, 0, 0);
            
            const daysDiff = Math.round((nextDeparture - arrivalDateOnly) / (1000 * 60 * 60 * 24));
            if (daysDiff >= 0) {
                timeAtLocation = `${daysDiff} day${daysDiff !== 1 ? 's' : ''}`;
            } else {
                timeAtLocation = '0 days';
            }
        }
        
        const airlineInfo = seg.business_carriers || seg.premium_economy_carriers || seg.economy_carriers || 'N/A';
        const arrivalDateStr = arrivalDate.toISOString().split('T')[0];
        
        // Get airport names (will be loaded asynchronously, show codes for now)
        const originName = AppState.airportCoordsCache[seg.origin]?.name || seg.origin;
        const destName = AppState.airportCoordsCache[seg.destination]?.name || seg.destination;
        
        return `
            <tr class="selected-flight">
                <td>${index + 1}</td>
                <td>
                    <strong>${seg.origin} → ${seg.destination}</strong><br>
                    <small style="color: #666;">${originName} → ${destName}</small>
                </td>
                <td>${formatDate(seg.date)}<br><small style="color: #666;">${seg.date}</small></td>
                <td>${formatDate(arrivalDateStr)}<br><small style="color: #666;">${arrivalDateStr}</small></td>
                <td>${timeAtLocation}</td>
                <td>${(seg.distance_miles || 0).toFixed(0)} mi</td>
                <td>${cumulativeDistance.toFixed(0)} mi</td>
                <td>${seg.cabin_class || 'N/A'}</td>
                <td><small>${airlineInfo}</small></td>
                <td>
                    <button class="action-btn btn-remove" onclick="removeFlightFromTable(${index})" title="Remove this flight and all after it">Remove</button>
                </td>
            </tr>
        `;
    }).join('');
    
    // Enable/disable clear button
    const clearBtn = document.getElementById('table-clear-all-btn');
    if (clearBtn) {
        clearBtn.disabled = segments.length === 0;
    }
}

// Remove flight from table (keeping earlier ones)
function removeFlightFromTable(segmentIndex) {
    if (segmentIndex < 0 || segmentIndex >= AppState.selectedSegments.length) return;
    
    // Remove this segment and all after it
    const segmentsToRemove = AppState.selectedSegments.length - segmentIndex;
    for (let i = 0; i < segmentsToRemove; i++) {
        AppState.selectedSegments.pop();
    }
    
    // Update global reference
    window.selectedSegments = AppState.selectedSegments;
    
    // Update UI
    updateSelectedFlightsTable();
    updateTripSummary();
    updateButtons();
    redrawSelectedRoutes();
    
    // Reload flights from the last remaining segment's destination - table view is always forward
    if (AppState.selectedSegments.length > 0) {
        const lastSegment = AppState.selectedSegments[AppState.selectedSegments.length - 1];
        const nextOrigin = lastSegment.destination;
        const daysToStay = parseInt(document.getElementById('days-to-stay')?.value || '3');
        const lastDate = new Date(lastSegment.date);
        
        let nextDate = new Date(lastDate);
        nextDate.setDate(nextDate.getDate() + daysToStay);
        
        document.getElementById('table-filter-origin').value = nextOrigin;
        loadFlightsForTableView(nextOrigin, nextDate.toISOString().split('T')[0], 'forward');
    } else {
        // Clear available flights if no segments remain
        TableViewState.availableFlights = [];
        TableViewState.filteredFlights = [];
        updateAvailableFlightsTable();
    }
}

// Make functions globally accessible
window.switchTab = switchTab;
window.selectFlightFromTable = selectFlightFromTable;
window.removeFlightFromTable = removeFlightFromTable;

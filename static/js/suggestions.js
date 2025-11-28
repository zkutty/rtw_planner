// Trip Suggestions Page JavaScript

document.addEventListener('DOMContentLoaded', () => {
    const searchBtn = document.getElementById('search-btn');
    const loadingDiv = document.getElementById('loading');
    const errorDiv = document.getElementById('error-message');
    const resultsDiv = document.getElementById('suggestions-results');
    
    searchBtn.addEventListener('click', async () => {
        // Get form values
        const startAirports = document.getElementById('start-airports').value
            .split(',')
            .map(a => a.trim().toUpperCase())
            .filter(a => a);
        const endAirports = document.getElementById('end-airports').value
            .split(',')
            .map(a => a.trim().toUpperCase())
            .filter(a => a);
        const startDate = document.getElementById('start-date').value;
        const endDate = document.getElementById('end-date').value || null;
        const mustVisit = document.getElementById('must-visit').value
            .split(',')
            .map(a => a.trim().toUpperCase())
            .filter(a => a);
        const minStopovers = parseInt(document.getElementById('min-stopovers').value) || 3;
        const maxStopovers = parseInt(document.getElementById('max-stopovers').value) || 5;
        const maxSegments = parseInt(document.getElementById('max-segments').value) || 16;
        
        // Validate inputs
        if (startAirports.length === 0 || !startDate) {
            showError('Please enter at least one start airport and a start date');
            return;
        }
        
        if (endAirports.length === 0) {
            endAirports.push(...startAirports); // Default to same as start
        }
        
        // Show loading
        searchBtn.disabled = true;
        loadingDiv.style.display = 'block';
        errorDiv.style.display = 'none';
        resultsDiv.innerHTML = '';
        
        // Start progress animation
        let progress = 0;
        const progressBar = document.getElementById('progress-bar');
        const progressText = document.getElementById('progress-text');
        const progressInterval = setInterval(() => {
            progress = Math.min(progress + Math.random() * 10, 90);
            progressBar.style.width = progress + '%';
            progressBar.textContent = Math.round(progress) + '%';
            
            if (progress < 30) {
                progressText.textContent = 'Loading flight data...';
            } else if (progress < 60) {
                progressText.textContent = 'Searching for valid routes...';
            } else if (progress < 90) {
                progressText.textContent = 'Validating trips...';
            }
        }, 500);
        
        try {
            const response = await fetch('/api/suggest-trips', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    start_airports: startAirports,
                    end_airports: endAirports,
                    start_date: startDate,
                    end_date: endDate,
                    must_visit_cities: mustVisit,
                    min_stopovers: minStopovers,
                    max_stopovers: maxStopovers,
                    max_segments: maxSegments
                })
            });
            
            // Complete progress
            clearInterval(progressInterval);
            progressBar.style.width = '100%';
            progressBar.textContent = '100%';
            progressText.textContent = 'Finalizing results...';
            
            const data = await response.json();
            
            if (data.error) {
                showError(data.error);
                return;
            }
            
            if (!data.suggestions || data.suggestions.length === 0) {
                resultsDiv.innerHTML = `
                    <div class="no-results">
                        <h3>No trips found</h3>
                        <p>Try adjusting your parameters or date range.</p>
                    </div>
                `;
                return;
            }
            
            // Display suggestions
            displaySuggestions(data.suggestions);
            
        } catch (error) {
            console.error('Error fetching suggestions:', error);
            clearInterval(progressInterval);
            showError('Failed to fetch trip suggestions. Please try again.');
        } finally {
            searchBtn.disabled = false;
            setTimeout(() => {
                loadingDiv.style.display = 'none';
            }, 500);
        }
    });
    
    function showError(message) {
        errorDiv.textContent = message;
        errorDiv.style.display = 'block';
    }
    
    function displaySuggestions(suggestions) {
        resultsDiv.innerHTML = suggestions.map((trip, index) => {
            const segments = trip.segments || [];
            const stopovers = trip.stopovers || [];
            
            // Calculate cabin class distribution
            const businessCount = segments.filter(s => s.cabin_class === 'Business').length;
            const premiumCount = segments.filter(s => s.cabin_class === 'Premium Economy').length;
            const economyCount = segments.filter(s => s.cabin_class === 'Economy').length;
            
            return `
                <div class="suggestion-card">
                    <div class="suggestion-header">
                        <h3 class="suggestion-title">Trip Option ${index + 1}</h3>
                        <span class="suggestion-badge">Valid RTW Trip</span>
                    </div>
                    
                    <div class="suggestion-stats">
                        <div class="stat-item">
                            <div class="stat-label">Total Segments</div>
                            <div class="stat-value">${segments.length}</div>
                        </div>
                        <div class="stat-item">
                            <div class="stat-label">Stopovers (24h+)</div>
                            <div class="stat-value">${stopovers.length}</div>
                        </div>
                        <div class="stat-item">
                            <div class="stat-label">Total Distance</div>
                            <div class="stat-value">${trip.total_distance_miles.toFixed(0)} mi</div>
                        </div>
                        <div class="stat-item">
                            <div class="stat-label">Total Days</div>
                            <div class="stat-value">${trip.total_days || 'N/A'}</div>
                        </div>
                        <div class="stat-item">
                            <div class="stat-label">Business</div>
                            <div class="stat-value">${businessCount}</div>
                        </div>
                        <div class="stat-item">
                            <div class="stat-label">Premium</div>
                            <div class="stat-value">${premiumCount}</div>
                        </div>
                        <div class="stat-item">
                            <div class="stat-label">Economy</div>
                            <div class="stat-value">${economyCount}</div>
                        </div>
                    </div>
                    
                    <div class="suggestion-segments">
                        <h4 style="margin-bottom: 0.75rem; color: #333;">Route:</h4>
                        ${segments.map((seg, segIndex) => {
                            const cabinClass = seg.cabin_class || 'Economy';
                            const cabinClassLower = cabinClass.toLowerCase().replace(' ', '-');
                            const dateObj = new Date(seg.date);
                            const dateStr = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                            
                            // Check if this is a stopover (next segment is more than 24h away)
                            let stopoverInfo = '';
                            if (segIndex < segments.length - 1) {
                                const nextSeg = segments[segIndex + 1];
                                const arrivalDate = new Date(seg.date);
                                const departureDate = new Date(nextSeg.date);
                                const hoursDiff = (departureDate - arrivalDate) / (1000 * 60 * 60);
                                if (hoursDiff >= 24) {
                                    const days = Math.floor(hoursDiff / 24);
                                    stopoverInfo = ` • ${days} day${days > 1 ? 's' : ''} stay`;
                                } else {
                                    stopoverInfo = ' • Connection';
                                }
                            }
                            
                            return `
                                <div class="segment-item">
                                    <div class="segment-route">
                                        ${seg.origin} → ${seg.destination}
                                        <span class="cabin-badge cabin-${cabinClassLower}">${cabinClass}</span>
                                    </div>
                                    <div class="segment-details">
                                        ${dateStr} • ${seg.distance_miles.toFixed(0)} miles${stopoverInfo}
                                    </div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                    
                    ${trip.validation ? `
                        <div style="margin-top: 1rem; padding: 0.75rem; background: #e8f5e9; border-radius: 4px; font-size: 0.9rem;">
                            <strong>✓ Validated:</strong> ${trip.validation.num_continents} continents, 
                            ${trip.validation.atlantic_crossed ? 'Atlantic' : ''} 
                            ${trip.validation.pacific_crossed ? 'Pacific' : ''} crossed
                        </div>
                    ` : ''}
                </div>
            `;
        }).join('');
    }
});


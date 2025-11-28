#!/usr/bin/env python3
"""
Flask web application for interactive RTW trip planning
"""
from flask import Flask, render_template, jsonify, request
from flask_cors import CORS
import os
from interactive_rtw_planner import InteractiveRTWPlanner, OneWorldRTWValidator
from datetime import datetime, timedelta
import json

app = Flask(__name__)
CORS(app)

# Global planner instance
planner = None

def init_planner():
    """Initialize the planner with CSV data"""
    global planner
    csv_file = os.environ.get('CSV_FILE', 'seats.aero qantas Export.csv')
    if os.path.exists(csv_file):
        planner = InteractiveRTWPlanner(csv_file)
        return True
    return False

@app.route('/')
def index():
    """Serve the main page"""
    return render_template('index.html')

@app.route('/suggestions')
def suggestions():
    """Serve the trip suggestions page"""
    return render_template('suggestions.html')

@app.route('/api/flights', methods=['GET'])
def get_flights():
    """Get available flights from an airport"""
    if not planner:
        return jsonify({'error': 'Planner not initialized'}), 500
    
    origin = request.args.get('origin', '').upper()
    target_date = request.args.get('date', '')
    date_range = int(request.args.get('date_range', 2))
    cabin_class = request.args.get('cabin_class', None)  # 'business', 'economy', or None for all
    
    if not origin or not target_date:
        return jsonify({'error': 'Origin and date required'}), 400
    
    try:
        flights = planner.get_flights_from_airport(origin, target_date, date_range_days=date_range)
        
        # Filter by cabin class if specified
        if cabin_class:
            filtered_flights = []
            for flight in flights:
                if cabin_class == 'business' and flight.get('business_miles_int', 0) > 0:
                    filtered_flights.append(flight)
                elif cabin_class == 'premium':
                    # Include if has business OR premium economy (excludes economy-only flights)
                    if flight.get('business_miles_int', 0) > 0 or flight.get('premium_economy_miles_int', 0) > 0:
                        filtered_flights.append(flight)
                elif cabin_class == 'economy' and flight.get('economy_miles_int', 0) > 0:
                    filtered_flights.append(flight)
            flights = filtered_flights
        
        # Format flights for frontend
        formatted_flights = []
        for flight in flights:
            formatted_flights.append({
                'origin': flight['origin'],
                'destination': flight['destination'],
                'date': flight['date'],
                'date_diff': flight['date_diff'],
                'is_direct': flight.get('is_direct', False),
                'num_stops': flight.get('num_stops', 0),
                'business_seats': flight.get('business_seats', 0),
                'business_miles': flight.get('business_miles'),
                'business_miles_int': flight.get('business_miles_int', 0),
                'premium_economy_seats': flight.get('premium_economy_seats', 0),
                'premium_economy_miles': flight.get('premium_economy_miles'),
                'premium_economy_miles_int': flight.get('premium_economy_miles_int', 0),
                'economy_seats': flight.get('economy_seats', 0),
                'economy_miles': flight.get('economy_miles'),
                'economy_miles_int': flight.get('economy_miles_int', 0),
                'business_carriers': flight.get('business_carriers'),
                'premium_economy_carriers': flight.get('premium_economy_carriers'),
                'economy_carriers': flight.get('economy_carriers'),
                'origin_name': planner.get_airport_name(flight['origin']),
                'destination_name': planner.get_airport_name(flight['destination'])
            })
        
        return jsonify({
            'flights': formatted_flights,
            'count': len(formatted_flights)
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/flights-to', methods=['GET'])
def get_flights_to():
    """Get available flights TO an airport (for backwards planning)"""
    if not planner:
        return jsonify({'error': 'Planner not initialized'}), 500
    
    destination = request.args.get('destination', '').upper()
    target_date = request.args.get('date', '')
    date_range = int(request.args.get('date_range', 2))
    cabin_class = request.args.get('cabin_class', None)
    
    if not destination or not target_date:
        return jsonify({'error': 'Destination and date required'}), 400
    
    try:
        # Search for flights TO this destination by searching all origins
        # This is less efficient but works with the current CSV structure
        all_flights = []
        
        # Get all unique origins from the CSV data
        # We'll need to search through the data to find flights TO the destination
        from csv_availability_reader import CSVAvailabilityReader
        csv_file = os.environ.get('CSV_FILE', 'seats.aero qantas Export.csv')
        reader = CSVAvailabilityReader(csv_file)
        
        # Search for flights where destination matches
        # We need to iterate through the data
        for row in reader.data:
            # Get destination from row
            dest_cols = ['destination airport', 'Destination Airport', 'DESTINATION AIRPORT',
                        'destination', 'Destination', 'DESTINATION', 'to', 'To', 'TO',
                        'arrival', 'Arrival', 'ARRIVAL', 'arr', 'Arr', 'ARR']
            row_dest = None
            for col in dest_cols:
                if col in row:
                    row_dest = row[col].upper().strip() if row[col] else None
                    break
            
            if row_dest == destination:
                # Get origin
                origin_cols = ['origin airport', 'Origin Airport', 'ORIGIN AIRPORT', 
                              'origin', 'Origin', 'ORIGIN', 'from', 'From', 'FROM', 
                              'departure', 'Departure', 'DEPARTURE', 'dep', 'Dep', 'DEP']
                row_origin = None
                for col in origin_cols:
                    if col in row:
                        row_origin = row[col].upper().strip() if row[col] else None
                        break
                
                if row_origin:
                    # Check date match
                    date_cols = ['date', 'Date', 'DATE', 'departure date', 'Departure Date']
                    row_date = None
                    for col in date_cols:
                        if col in row:
                            row_date = row[col]
                            break
                    
                    if row_date:
                        # Use the planner's method to format this flight
                        try:
                            flight = planner.get_flights_from_airport(row_origin, row_date, date_range_days=date_range)
                            # Filter to only flights to our destination
                            for f in flight:
                                if f['destination'] == destination:
                                    all_flights.append(f)
                        except:
                            pass
        
        # Remove duplicates and filter by date range
        seen = set()
        unique_flights = []
        try:
            target_dt = datetime.strptime(target_date, "%Y-%m-%d")
        except:
            return jsonify({'error': 'Invalid date format'}), 400
        
        for flight in all_flights:
            flight_key = (flight['origin'], flight['destination'], flight['date'])
            if flight_key not in seen:
                seen.add(flight_key)
                try:
                    flight_dt = datetime.strptime(flight['date'], "%Y-%m-%d")
                    days_diff = abs((flight_dt - target_dt).days)
                    if days_diff <= date_range:
                        flight['date_diff'] = days_diff
                        unique_flights.append(flight)
                except:
                    pass
        
        # Filter by cabin class
        if cabin_class:
            filtered_flights = []
            for flight in unique_flights:
                if cabin_class == 'business' and flight.get('business_miles_int', 0) > 0:
                    filtered_flights.append(flight)
                elif cabin_class == 'premium' and (flight.get('business_miles_int', 0) > 0 or 
                                                    flight.get('premium_economy_miles_int', 0) > 0):
                    filtered_flights.append(flight)
                elif cabin_class == 'economy' and flight.get('economy_miles_int', 0) > 0:
                    filtered_flights.append(flight)
            unique_flights = filtered_flights
        
        # Format flights for frontend
        formatted_flights = []
        for flight in unique_flights:
            formatted_flights.append({
                'origin': flight['origin'],
                'destination': flight['destination'],
                'date': flight['date'],
                'date_diff': flight.get('date_diff', 0),
                'is_direct': flight.get('is_direct', False),
                'num_stops': flight.get('num_stops', 0),
                'business_seats': flight.get('business_seats', 0),
                'business_miles': flight.get('business_miles'),
                'business_miles_int': flight.get('business_miles_int', 0),
                'premium_economy_seats': flight.get('premium_economy_seats', 0),
                'premium_economy_miles': flight.get('premium_economy_miles'),
                'premium_economy_miles_int': flight.get('premium_economy_miles_int', 0),
                'economy_seats': flight.get('economy_seats', 0),
                'economy_miles': flight.get('economy_miles'),
                'economy_miles_int': flight.get('economy_miles_int', 0),
                'business_carriers': flight.get('business_carriers'),
                'premium_economy_carriers': flight.get('premium_economy_carriers'),
                'economy_carriers': flight.get('economy_carriers'),
                'origin_name': planner.get_airport_name(flight['origin']),
                'destination_name': planner.get_airport_name(flight['destination'])
            })
        
        return jsonify({
            'flights': formatted_flights,
            'count': len(formatted_flights)
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/nearby-airports', methods=['GET'])
def get_nearby_airports():
    """Get nearby airports"""
    if not planner:
        return jsonify({'error': 'Planner not initialized'}), 500
    
    airport = request.args.get('airport', '').upper()
    if not airport:
        return jsonify({'error': 'Airport code required'}), 400
    
    try:
        nearby = planner.get_nearby_airports(airport, max_results=5)
        formatted = []
        for code, distance, city_name in nearby:
            formatted.append({
                'code': code,
                'distance': round(distance, 0),
                'name': city_name
            })
        return jsonify({'airports': formatted})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/airport-coords', methods=['GET'])
def get_airport_coords():
    """Get coordinates for airports"""
    if not planner:
        return jsonify({'error': 'Planner not initialized'}), 500
    
    airports = request.args.getlist('airports')
    coords = {}
    for airport in airports:
        airport = airport.upper()
        if airport in planner.AIRPORT_COORDINATES:
            lat, lon = planner.AIRPORT_COORDINATES[airport]
            coords[airport] = {
                'lat': lat,
                'lon': lon,
                'name': planner.get_airport_name(airport)
            }
        else:
            # Return a default location if coordinates not found (center of world map)
            # This prevents errors but should be logged
            print(f"Warning: No coordinates found for airport {airport}")
            coords[airport] = {
                'lat': 0.0,
                'lon': 0.0,
                'name': planner.get_airport_name(airport)
            }
    return jsonify(coords)

@app.route('/api/all-airports', methods=['GET'])
def get_all_airports():
    """Get all unique airports from CSV and check which ones have coordinates"""
    if not planner:
        return jsonify({'error': 'Planner not initialized'}), 500
    
    try:
        all_airports = planner.get_all_airports()
        airports_with_coords = set(planner.AIRPORT_COORDINATES.keys())
        missing_coords = sorted(all_airports - airports_with_coords)
        
        return jsonify({
            'total_airports': len(all_airports),
            'airports_with_coords': len(airports_with_coords),
            'missing_coords': missing_coords,
            'missing_count': len(missing_coords)
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/validate-trip', methods=['POST'])
def validate_trip():
    """Validate a RTW trip"""
    if not planner:
        return jsonify({'error': 'Planner not initialized'}), 500
    
    try:
        data = request.json
        segments = data.get('segments', [])
        
        # Calculate distances for segments
        for segment in segments:
            if 'distance_miles' not in segment:
                distance = planner.calculate_distance_miles(
                    segment['origin'],
                    segment['destination']
                )
                segment['distance_miles'] = distance
        
        validation = OneWorldRTWValidator.validate_rtw_trip(segments)
        return jsonify(validation)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/airport-names', methods=['GET'])
def get_airport_names():
    """Get airport names for a list of codes"""
    if not planner:
        return jsonify({'error': 'Planner not initialized'}), 500
    
    airports = request.args.getlist('airports')
    names = {}
    for airport in airports:
        names[airport.upper()] = planner.get_airport_name(airport.upper())
    return jsonify(names)

@app.route('/api/airport-has-flights', methods=['GET'])
def airport_has_flights():
    """Check if an airport has flights in the next 30 days"""
    if not planner:
        return jsonify({'error': 'Planner not initialized'}), 500
    
    airport = request.args.get('airport', '').upper()
    start_date = request.args.get('start_date', '')
    
    if not airport or not start_date:
        return jsonify({'error': 'Airport and start_date required'}), 400
    
    try:
        # Check for flights in the next 30 days
        flights = planner.get_flights_from_airport(airport, start_date, date_range_days=30)
        has_flights = len(flights) > 0
        return jsonify({
            'airport': airport,
            'has_flights': has_flights,
            'flight_count': len(flights)
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/suggest-trips', methods=['POST'])
def suggest_trips():
    """Generate RTW trip suggestions based on parameters"""
    if not planner:
        return jsonify({'error': 'Planner not initialized'}), 500
    
    try:
        data = request.json
        start_airports = [a.upper() for a in data.get('start_airports', [])]
        end_airports = [a.upper() for a in data.get('end_airports', [])]
        start_date = data.get('start_date')
        end_date = data.get('end_date')
        must_visit = [a.upper() for a in data.get('must_visit_cities', [])]
        min_stopovers = data.get('min_stopovers', 3)
        max_stopovers = data.get('max_stopovers', 5)
        max_segments = data.get('max_segments', 16)
        
        if not start_airports or not start_date:
            return jsonify({'error': 'Start airports and start date required'}), 400
        
        # Generate trip suggestions
        suggestions = generate_trip_suggestions(
            planner,
            start_airports,
            end_airports,
            start_date,
            end_date,
            must_visit,
            min_stopovers,
            max_stopovers,
            max_segments
        )
        
        return jsonify({
            'suggestions': suggestions,
            'count': len(suggestions)
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

def generate_trip_suggestions(planner, start_airports, end_airports, start_date, end_date, 
                              must_visit, min_stopovers, max_stopovers, max_segments, 
                              max_suggestions=10, max_depth=12):
    """
    Generate RTW trip suggestions using a simplified search algorithm.
    Prioritizes business class, then premium economy, then economy.
    """
    from datetime import datetime, timedelta
    
    suggestions = []
    visited_paths = set()
    
    def get_cabin_priority(flight):
        """Get priority score for cabin class (lower is better)"""
        if flight.get('business_miles_int', 0) > 0:
            return 1  # Business - highest priority
        elif flight.get('premium_economy_miles_int', 0) > 0:
            return 2  # Premium Economy
        elif flight.get('economy_miles_int', 0) > 0:
            return 3  # Economy
        return 999  # No availability
    
    def build_trip(current_airport, current_date, path, visited_cities, must_visit_remaining, depth=0):
        """Recursively build trip paths"""
        if depth > max_depth or len(suggestions) >= max_suggestions:
            return
        
        # Check if we can return to end airport
        if len(path) >= 3:
            # Try to find return flights to end airports
            for end_airport in end_airports:
                try:
                    return_flights = planner.get_flights_from_airport(current_airport, current_date, date_range_days=7)
                    return_flights = [f for f in return_flights if f['destination'] == end_airport and
                                    (f.get('business_miles_int', 0) > 0 or 
                                     f.get('premium_economy_miles_int', 0) > 0 or 
                                     f.get('economy_miles_int', 0) > 0)]
                    
                    if return_flights:
                        # Sort by cabin class priority
                        return_flights.sort(key=get_cabin_priority)
                        return_flight = return_flights[0]
                        
                        # Check if all must-visit cities are included
                        if len(must_visit_remaining) == 0:
                            # Determine cabin class for return
                            if return_flight.get('business_miles_int', 0) > 0:
                                return_cabin = 'Business'
                            elif return_flight.get('premium_economy_miles_int', 0) > 0:
                                return_cabin = 'Premium Economy'
                            else:
                                return_cabin = 'Economy'
                            
                            # Create return segment
                            return_segment = {
                                'origin': current_airport,
                                'destination': end_airport,
                                'date': return_flight['date'],
                                'cabin_class': return_cabin,
                                'distance_miles': planner.calculate_distance_miles(current_airport, end_airport),
                                'business_miles_int': return_flight.get('business_miles_int', 0),
                                'premium_economy_miles_int': return_flight.get('premium_economy_miles_int', 0),
                                'economy_miles_int': return_flight.get('economy_miles_int', 0)
                            }
                            
                            segments = path + [return_segment]
                            
                            # Add segment numbers
                            for i, seg in enumerate(segments):
                                seg['segment'] = i + 1
                            
                            # Validate the trip
                            validation = OneWorldRTWValidator.validate_rtw_trip(segments)
                            if validation['valid']:
                                # Calculate stopovers
                                stopovers = []
                                for i in range(len(segments) - 1):
                                    date1 = datetime.strptime(segments[i]['date'], "%Y-%m-%d")
                                    date2 = datetime.strptime(segments[i+1]['date'], "%Y-%m-%d")
                                    hours = (date2 - date1).total_seconds() / 3600
                                    if hours >= 24:
                                        stopovers.append(segments[i]['destination'])
                                
                                if min_stopovers <= len(stopovers) <= max_stopovers:
                                    # Add to suggestions
                                    total_distance = sum(s.get('distance_miles', 0) for s in segments)
                                    total_days = (datetime.strptime(segments[-1]['date'], "%Y-%m-%d") - 
                                                 datetime.strptime(segments[0]['date'], "%Y-%m-%d")).days
                                    
                                    suggestions.append({
                                        'segments': segments,
                                        'stopovers': stopovers,
                                        'total_distance_miles': total_distance,
                                        'total_days': total_days,
                                        'validation': validation
                                    })
                except:
                    continue
        
        # Get available flights
        try:
            flights = planner.get_flights_from_airport(current_airport, current_date, date_range_days=4)
        except:
            return
        
        # Filter flights that have availability
        available_flights = [f for f in flights if 
                           f.get('business_miles_int', 0) > 0 or 
                           f.get('premium_economy_miles_int', 0) > 0 or 
                           f.get('economy_miles_int', 0) > 0]
        
        # Sort by cabin class priority
        available_flights.sort(key=get_cabin_priority)
        
        # Limit to top 10 flights per airport to avoid explosion
        for flight in available_flights[:10]:
            dest = flight['destination']
            flight_date = flight['date']
            
            # Skip if we've been here recently (avoid loops)
            path_key = (current_airport, dest, flight_date)
            if path_key in visited_paths:
                continue
            
            # Skip if we've visited this city too many times
            if visited_cities.get(dest, 0) >= 2:
                continue
            
            # Check date constraints
            if end_date:
                flight_dt = datetime.strptime(flight_date, "%Y-%m-%d")
                end_dt = datetime.strptime(end_date, "%Y-%m-%d")
                if flight_dt > end_dt:
                    continue
            
            # Determine cabin class
            if flight.get('business_miles_int', 0) > 0:
                cabin_class = 'Business'
            elif flight.get('premium_economy_miles_int', 0) > 0:
                cabin_class = 'Premium Economy'
            else:
                cabin_class = 'Economy'
            
            # Create new segment
            new_segment = {
                'origin': current_airport,
                'destination': dest,
                'date': flight_date,
                'cabin_class': cabin_class,
                'distance_miles': planner.calculate_distance_miles(current_airport, dest),
                'business_miles_int': flight.get('business_miles_int', 0),
                'premium_economy_miles_int': flight.get('premium_economy_miles_int', 0),
                'economy_miles_int': flight.get('economy_miles_int', 0),
                'segment': len(path) + 1
            }
            
            new_path = path + [new_segment]
            new_visited = visited_cities.copy()
            new_visited[dest] = new_visited.get(dest, 0) + 1
            
            new_must_visit = must_visit_remaining.copy()
            if dest in new_must_visit:
                new_must_visit.remove(dest)
            
            # Calculate next date (add 3-7 days for stopover)
            next_date_dt = datetime.strptime(flight_date, "%Y-%m-%d") + timedelta(days=5)
            next_date = next_date_dt.strftime("%Y-%m-%d")
            
            visited_paths.add(path_key)
            build_trip(dest, next_date, new_path, new_visited, new_must_visit, depth + 1)
    
    # Start building trips from each start airport
    for start_airport in start_airports[:1]:  # Limit to first airport for now
        build_trip(start_airport, start_date, [], {start_airport: 1}, set(must_visit))
    
    # Sort suggestions by business class count (descending), then total distance
    suggestions.sort(key=lambda x: (
        -sum(1 for s in x['segments'] if s.get('cabin_class') == 'Business'),
        x['total_distance_miles']
    ))
    
    return suggestions[:max_suggestions]

if __name__ == '__main__':
    if init_planner():
        print("✓ Planner initialized successfully")
        port = int(os.environ.get('PORT', 5001))
        print(f"🌐 Starting web server on http://localhost:{port}")
        print("   Open this URL in your browser to use the interactive map planner")
        app.run(debug=True, port=port)
    else:
        print("❌ Failed to initialize planner - CSV file not found")
        print("Set CSV_FILE environment variable or ensure 'seats.aero qantas Export.csv' exists")


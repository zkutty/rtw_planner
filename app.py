#!/usr/bin/env python3
"""
Flask web application for interactive RTW trip planning
Optimized for speed and stability
"""
from flask import Flask, render_template, jsonify, request
from flask_cors import CORS
import os
from functools import lru_cache
from datetime import datetime, timedelta
import json

app = Flask(__name__)
CORS(app)

# Global planner instance and cached data
planner = None
_flight_index_by_origin = {}
_flight_index_by_destination = {}
_data_initialized = False


def init_planner():
    """Initialize the planner with CSV data and build indexes"""
    global planner, _flight_index_by_origin, _flight_index_by_destination, _data_initialized
    
    from interactive_rtw_planner import InteractiveRTWPlanner
    
    csv_file = os.environ.get('CSV_FILE', 'seats.aero qantas Export.csv')
    if not os.path.exists(csv_file):
        return False
    
    planner = InteractiveRTWPlanner(csv_file)
    
    # Build indexes for fast lookup
    _flight_index_by_origin = {}
    _flight_index_by_destination = {}
    
    for row in planner.reader.data:
        # Extract origin
        origin = None
        for col in ['Origin Airport', 'origin airport', 'ORIGIN AIRPORT', 'origin', 'Origin']:
            if col in row and row[col]:
                origin = str(row[col]).upper().strip()
                break
        
        # Extract destination
        dest = None
        for col in ['Destination Airport', 'destination airport', 'DESTINATION AIRPORT', 'destination', 'Destination']:
            if col in row and row[col]:
                dest = str(row[col]).upper().strip()
                break
        
        if origin and dest:
            if origin not in _flight_index_by_origin:
                _flight_index_by_origin[origin] = []
            _flight_index_by_origin[origin].append(row)
            
            if dest not in _flight_index_by_destination:
                _flight_index_by_destination[dest] = []
            _flight_index_by_destination[dest].append(row)
    
    _data_initialized = True
    return True


def format_flight(flight: dict) -> dict:
    """Format a flight dict for the frontend"""
    return {
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
    }


def filter_by_cabin_class(flights: list, cabin_class: str) -> list:
    """Filter flights by cabin class"""
    if not cabin_class:
        return flights
    
    filtered = []
    for flight in flights:
        if cabin_class == 'business' and flight.get('business_miles_int', 0) > 0:
            filtered.append(flight)
        elif cabin_class == 'premium':
            if flight.get('business_miles_int', 0) > 0 or flight.get('premium_economy_miles_int', 0) > 0:
                filtered.append(flight)
        elif cabin_class == 'economy' and flight.get('economy_miles_int', 0) > 0:
            filtered.append(flight)
    return filtered


def parse_row_to_flight(row: dict, target_date: str, date_range: int) -> dict | None:
    """Parse a CSV row into a flight dict with date filtering"""
    # Extract date
    row_date = None
    for col in ['Date', 'date', 'DATE']:
        if col in row and row[col]:
            row_date = str(row[col]).strip()
            break
    
    if not row_date:
        return None
    
    # Check date range
    try:
        target_dt = datetime.strptime(target_date, "%Y-%m-%d")
        row_date_obj = datetime.strptime(row_date.split()[0], "%Y-%m-%d")
        date_diff = abs((target_dt - row_date_obj).days)
        if date_diff > date_range:
            return None
    except:
        return None
    
    # Extract origin and destination
    origin = None
    dest = None
    
    for col in ['Origin Airport', 'origin airport', 'origin', 'Origin']:
        if col in row and row[col]:
            origin = str(row[col]).upper().strip()
            break
    
    for col in ['Destination Airport', 'destination airport', 'destination', 'Destination']:
        if col in row and row[col]:
            dest = str(row[col]).upper().strip()
            break
    
    if not origin or not dest:
        return None
    
    # Extract cabin class data
    business_seats = 0
    business_direct_seats = 0
    business_miles = None
    business_carriers = None
    premium_economy_seats = 0
    premium_economy_miles = None
    premium_economy_carriers = None
    economy_seats = 0
    economy_direct_seats = 0
    economy_miles = None
    economy_carriers = None
    
    try:
        if 'Business Seats' in row:
            business_seats = int(str(row['Business Seats']).strip() or '0')
        if 'Business Direct Seats' in row:
            business_direct_seats = int(str(row['Business Direct Seats']).strip() or '0')
        if 'Business Miles' in row:
            business_miles = str(row['Business Miles']).strip() or None
        if 'Business Carriers' in row:
            business_carriers = str(row['Business Carriers']).strip() or None
    except:
        pass
    
    try:
        if 'Premium Economy Seats' in row:
            premium_economy_seats = int(str(row['Premium Economy Seats']).strip() or '0')
        if 'Premium Economy Miles' in row:
            premium_economy_miles = str(row['Premium Economy Miles']).strip() or None
        if 'Premium Economy Carriers' in row:
            premium_economy_carriers = str(row['Premium Economy Carriers']).strip() or None
    except:
        pass
    
    try:
        if 'Economy Seats' in row:
            economy_seats = int(str(row['Economy Seats']).strip() or '0')
        if 'Economy Direct Seats' in row:
            economy_direct_seats = int(str(row['Economy Direct Seats']).strip() or '0')
        if 'Economy Miles' in row:
            economy_miles = str(row['Economy Miles']).strip() or None
        if 'Economy Carriers' in row:
            economy_carriers = str(row['Economy Carriers']).strip() or None
    except:
        pass
    
    # Parse miles as integers
    business_miles_int = 0
    premium_economy_miles_int = 0
    economy_miles_int = 0
    
    try:
        if business_miles:
            business_miles_int = int(business_miles)
    except:
        pass
    
    try:
        if premium_economy_miles:
            premium_economy_miles_int = int(premium_economy_miles)
    except:
        pass
    
    try:
        if economy_miles:
            economy_miles_int = int(economy_miles)
    except:
        pass
    
    # Only include if has some availability
    if business_miles_int <= 0 and economy_miles_int <= 0:
        return None
    
    # Determine if direct
    is_direct = business_direct_seats > 0 or economy_direct_seats > 0
    num_stops = 0
    if not is_direct and (business_seats > 0 or economy_seats > 0):
        carriers_str = business_carriers or economy_carriers or ''
        if carriers_str:
            carrier_list = [c.strip() for c in carriers_str.split(',') if c.strip()]
            num_stops = max(len(carrier_list) - 1, 1)
        else:
            num_stops = 1
    
    return {
        'origin': origin,
        'destination': dest,
        'date': row_date_obj.strftime("%Y-%m-%d"),
        'date_diff': date_diff,
        'business_seats': business_seats,
        'business_miles': business_miles,
        'business_miles_int': business_miles_int,
        'premium_economy_seats': premium_economy_seats,
        'premium_economy_miles': premium_economy_miles,
        'premium_economy_miles_int': premium_economy_miles_int,
        'economy_seats': economy_seats,
        'economy_miles': economy_miles,
        'economy_miles_int': economy_miles_int,
        'business_carriers': business_carriers,
        'premium_economy_carriers': premium_economy_carriers,
        'economy_carriers': economy_carriers,
        'is_direct': is_direct,
        'num_stops': num_stops
    }


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
    cabin_class = request.args.get('cabin_class', None)
    
    if not origin or not target_date:
        return jsonify({'error': 'Origin and date required'}), 400
    
    try:
        flights = planner.get_flights_from_airport(origin, target_date, date_range_days=date_range)
        flights = filter_by_cabin_class(flights, cabin_class)
        formatted = [format_flight(f) for f in flights]
        
        return jsonify({
            'flights': formatted,
            'count': len(formatted)
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/flights-to', methods=['GET'])
def get_flights_to():
    """Get available flights TO an airport (for backwards planning) - OPTIMIZED"""
    if not planner or not _data_initialized:
        return jsonify({'error': 'Planner not initialized'}), 500
    
    destination = request.args.get('destination', '').upper()
    target_date = request.args.get('date', '')
    date_range = int(request.args.get('date_range', 2))
    cabin_class = request.args.get('cabin_class', None)
    
    if not destination or not target_date:
        return jsonify({'error': 'Destination and date required'}), 400
    
    try:
        # Use pre-built index for O(1) lookup instead of O(n) scan
        rows = _flight_index_by_destination.get(destination, [])
        
        flights = []
        seen = set()
        
        for row in rows:
            flight = parse_row_to_flight(row, target_date, date_range)
            if flight:
                key = (flight['origin'], flight['destination'], flight['date'])
                if key not in seen:
                    seen.add(key)
                    flights.append(flight)
        
        # Sort by date_diff, then by cabin class
        flights.sort(key=lambda x: (
            x['date_diff'],
            -(1 if x['business_miles_int'] > 0 else 0),
            -(1 if x['premium_economy_miles_int'] > 0 else 0),
            -x['business_miles_int'],
            -x['economy_miles_int']
        ))
        
        flights = filter_by_cabin_class(flights, cabin_class)
        formatted = [format_flight(f) for f in flights]
        
        return jsonify({
            'flights': formatted,
            'count': len(formatted)
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
        formatted = [{'code': code, 'distance': round(distance), 'name': city_name} 
                    for code, distance, city_name in nearby]
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
            coords[airport] = {'lat': 0.0, 'lon': 0.0, 'name': airport}
    
    return jsonify(coords)


@app.route('/api/all-airports', methods=['GET'])
def get_all_airports():
    """Get all unique airports from CSV"""
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
        from interactive_rtw_planner import OneWorldRTWValidator
        
        data = request.json
        segments = data.get('segments', [])
        
        # Calculate distances
        for segment in segments:
            if 'distance_miles' not in segment:
                segment['distance_miles'] = planner.calculate_distance_miles(
                    segment['origin'], segment['destination']
                )
        
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
    names = {a.upper(): planner.get_airport_name(a.upper()) for a in airports}
    return jsonify(names)


@app.route('/api/airport-has-flights', methods=['GET'])
def airport_has_flights():
    """Check if an airport has outbound flights - OPTIMIZED"""
    if not planner or not _data_initialized:
        return jsonify({'error': 'Planner not initialized'}), 500
    
    airport = request.args.get('airport', '').upper()
    start_date = request.args.get('start_date', '')
    
    if not airport or not start_date:
        return jsonify({'error': 'Airport and start_date required'}), 400
    
    try:
        # Use index for O(1) lookup
        has_flights = airport in _flight_index_by_origin and len(_flight_index_by_origin[airport]) > 0
        
        # If has rows, check if any are in date range
        if has_flights:
            try:
                target_dt = datetime.strptime(start_date, "%Y-%m-%d")
                found_in_range = False
                
                for row in _flight_index_by_origin[airport][:50]:  # Check first 50 only for speed
                    for col in ['Date', 'date', 'DATE']:
                        if col in row and row[col]:
                            row_date = str(row[col]).strip().split()[0]
                            try:
                                row_date_obj = datetime.strptime(row_date, "%Y-%m-%d")
                                if row_date_obj >= target_dt:
                                    found_in_range = True
                                    break
                            except:
                                pass
                            break
                    if found_in_range:
                        break
                
                has_flights = found_in_range
            except:
                pass
        
        return jsonify({
            'airport': airport,
            'has_flights': has_flights,
            'flight_count': len(_flight_index_by_origin.get(airport, []))
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/suggest-trips', methods=['POST'])
def suggest_trips():
    """Generate RTW trip suggestions"""
    if not planner:
        return jsonify({'error': 'Planner not initialized'}), 500
    
    try:
        from interactive_rtw_planner import OneWorldRTWValidator
        
        data = request.json
        start_airports = [a.upper() for a in data.get('start_airports', [])]
        end_airports = [a.upper() for a in data.get('end_airports', [])] or start_airports
        start_date = data.get('start_date')
        end_date = data.get('end_date')
        must_visit = [a.upper() for a in data.get('must_visit_cities', [])]
        min_stopovers = data.get('min_stopovers', 3)
        max_stopovers = min(data.get('max_stopovers', 5), 5)  # Cap at 5
        
        if not start_airports or not start_date:
            return jsonify({'error': 'Start airports and start date required'}), 400
        
        suggestions = generate_trip_suggestions(
            start_airports, end_airports, start_date, end_date,
            must_visit, min_stopovers, max_stopovers
        )
        
        return jsonify({'suggestions': suggestions, 'count': len(suggestions)})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


def generate_trip_suggestions(start_airports, end_airports, start_date, end_date,
                              must_visit, min_stopovers, max_stopovers,
                              max_suggestions=10, max_depth=12):
    """Generate RTW trip suggestions using optimized search"""
    from interactive_rtw_planner import OneWorldRTWValidator
    
    suggestions = []
    visited_paths = set()
    
    def get_cabin_priority(flight):
        if flight.get('business_miles_int', 0) > 0:
            return 1
        elif flight.get('premium_economy_miles_int', 0) > 0:
            return 2
        elif flight.get('economy_miles_int', 0) > 0:
            return 3
        return 999
    
    def build_trip(current_airport, current_date, path, visited_cities, must_visit_remaining, depth=0):
        if depth > max_depth or len(suggestions) >= max_suggestions:
            return
        
        # Check if we can return to end airport
        if len(path) >= 3:
            for end_airport in end_airports:
                try:
                    return_flights = planner.get_flights_from_airport(current_airport, current_date, date_range_days=7)
                    return_flights = [f for f in return_flights if f['destination'] == end_airport and
                                    (f.get('business_miles_int', 0) > 0 or 
                                     f.get('premium_economy_miles_int', 0) > 0 or 
                                     f.get('economy_miles_int', 0) > 0)]
                    
                    if return_flights and len(must_visit_remaining) == 0:
                        return_flights.sort(key=get_cabin_priority)
                        return_flight = return_flights[0]
                        
                        cabin_class = ('Business' if return_flight.get('business_miles_int', 0) > 0 
                                      else 'Premium Economy' if return_flight.get('premium_economy_miles_int', 0) > 0 
                                      else 'Economy')
                        
                        return_segment = {
                            'origin': current_airport,
                            'destination': end_airport,
                            'date': return_flight['date'],
                            'cabin_class': cabin_class,
                            'distance_miles': planner.calculate_distance_miles(current_airport, end_airport),
                            'business_miles_int': return_flight.get('business_miles_int', 0),
                            'premium_economy_miles_int': return_flight.get('premium_economy_miles_int', 0),
                            'economy_miles_int': return_flight.get('economy_miles_int', 0)
                        }
                        
                        segments = path + [return_segment]
                        for i, seg in enumerate(segments):
                            seg['segment'] = i + 1
                        
                        validation = OneWorldRTWValidator.validate_rtw_trip(segments)
                        if validation['valid']:
                            stopovers = []
                            for i in range(len(segments) - 1):
                                date1 = datetime.strptime(segments[i]['date'], "%Y-%m-%d")
                                date2 = datetime.strptime(segments[i+1]['date'], "%Y-%m-%d")
                                if (date2 - date1).total_seconds() / 3600 >= 24:
                                    stopovers.append(segments[i]['destination'])
                            
                            if min_stopovers <= len(stopovers) <= max_stopovers:
                                suggestions.append({
                                    'segments': segments,
                                    'stopovers': stopovers,
                                    'total_distance_miles': sum(s.get('distance_miles', 0) for s in segments),
                                    'total_days': (datetime.strptime(segments[-1]['date'], "%Y-%m-%d") - 
                                                  datetime.strptime(segments[0]['date'], "%Y-%m-%d")).days,
                                    'validation': validation
                                })
                except:
                    continue
        
        # Get available flights
        try:
            flights = planner.get_flights_from_airport(current_airport, current_date, date_range_days=4)
        except:
            return
        
        available_flights = [f for f in flights if 
                           f.get('business_miles_int', 0) > 0 or 
                           f.get('premium_economy_miles_int', 0) > 0 or 
                           f.get('economy_miles_int', 0) > 0]
        available_flights.sort(key=get_cabin_priority)
        
        for flight in available_flights[:10]:
            dest = flight['destination']
            flight_date = flight['date']
            
            path_key = (current_airport, dest, flight_date)
            if path_key in visited_paths or visited_cities.get(dest, 0) >= 2:
                continue
            
            if end_date:
                try:
                    if datetime.strptime(flight_date, "%Y-%m-%d") > datetime.strptime(end_date, "%Y-%m-%d"):
                        continue
                except:
                    pass
            
            cabin_class = ('Business' if flight.get('business_miles_int', 0) > 0 
                          else 'Premium Economy' if flight.get('premium_economy_miles_int', 0) > 0 
                          else 'Economy')
            
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
            
            new_visited = visited_cities.copy()
            new_visited[dest] = new_visited.get(dest, 0) + 1
            
            new_must_visit = must_visit_remaining.copy()
            if dest in new_must_visit:
                new_must_visit.remove(dest)
            
            next_date = (datetime.strptime(flight_date, "%Y-%m-%d") + timedelta(days=5)).strftime("%Y-%m-%d")
            
            visited_paths.add(path_key)
            build_trip(dest, next_date, path + [new_segment], new_visited, new_must_visit, depth + 1)
    
    for start_airport in start_airports[:1]:
        build_trip(start_airport, start_date, [], {start_airport: 1}, set(must_visit))
    
    suggestions.sort(key=lambda x: (
        -sum(1 for s in x['segments'] if s.get('cabin_class') == 'Business'),
        x['total_distance_miles']
    ))
    
    return suggestions[:max_suggestions]


if __name__ == '__main__':
    if init_planner():
        print("✓ Planner initialized successfully")
        print(f"  Indexed {len(_flight_index_by_origin)} origin airports")
        print(f"  Indexed {len(_flight_index_by_destination)} destination airports")
        port = int(os.environ.get('PORT', 5001))
        print(f"🌐 Starting web server on http://localhost:{port}")
        app.run(debug=True, port=port)
    else:
        print("❌ Failed to initialize planner - CSV file not found")

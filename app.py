#!/usr/bin/env python3
"""
Flask web application for interactive RTW trip planning
Supports both Seats.aero Partner API (live) and SQLite database (offline)
"""
from flask import Flask, render_template, jsonify, request, session, redirect, url_for
from flask_cors import CORS
from functools import wraps
import os
from datetime import datetime, timedelta

app = Flask(__name__)
app.secret_key = os.environ.get('FLASK_SECRET_KEY', os.urandom(24).hex())
CORS(app)

# Password protection
SITE_PASSWORD = os.environ.get('SITE_PASSWORD', None)


def password_required(f):
    """Decorator to require password authentication"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        # Skip auth if no password is set
        if not SITE_PASSWORD:
            return f(*args, **kwargs)
        # Check if authenticated
        if not session.get('authenticated'):
            return redirect(url_for('login'))
        return f(*args, **kwargs)
    return decorated_function

# Global state
data_source = None  # Can be SeatsAeroPartnerAPI or DatabaseReader
planner_coords = None  # Just for coordinates/names, not flight data
_init_error = None
_using_api = False


def init_app():
    """Initialize the application with Seats.aero API or SQLite database fallback"""
    global data_source, planner_coords, _init_error, _using_api
    
    # Check for Seats.aero API key first (preferred method)
    api_key = os.environ.get('SEATS_AERO_API_KEY')
    
    if api_key:
        try:
            from seats_aero_partner_api import SeatsAeroPartnerAPI
            data_source = SeatsAeroPartnerAPI(api_key)
            _using_api = True
            print(f"✓ Using Seats.aero Partner API (live data)")
        except Exception as e:
            print(f"⚠ Failed to initialize API client: {e}")
            print("  Falling back to SQLite database...")
            api_key = None  # Fall through to database loading
    
    # Fall back to SQLite database if no API key or API init failed
    if not api_key:
        db_file = os.environ.get('DB_FILE', 'flights.db')
        
        if os.path.exists(db_file):
            try:
                from db_reader import DatabaseReader
                data_source = DatabaseReader(db_file)
                _using_api = False
                print(f"✓ Using SQLite database: {db_file}")
            except Exception as e:
                _init_error = f"Failed to load database: {e}"
                print(f"❌ {_init_error}")
                return False
        else:
            # Try to build database from CSV
            csv_candidates = [
                os.environ.get('CSV_FILE', ''),
                'flights.csv',
                'seats.aero qantas Export.csv',
            ]
            
            csv_file = None
            for candidate in csv_candidates:
                if candidate and os.path.exists(candidate):
                    csv_file = candidate
                    break
            
            if csv_file:
                print(f"Building database from {csv_file}...")
                try:
                    from build_database import build_database
                    if build_database(csv_file, db_file):
                        from db_reader import DatabaseReader
                        data_source = DatabaseReader(db_file)
                        _using_api = False
                        print(f"✓ Database built and loaded")
                    else:
                        _init_error = "Failed to build database from CSV"
                        return False
                except Exception as e:
                    _init_error = f"Failed to build database: {e}"
                    print(f"❌ {_init_error}")
                    return False
            else:
                _init_error = "No API key or database found. Set SEATS_AERO_API_KEY or provide flights.db"
                print(f"❌ {_init_error}")
                return False
    
    # Load just coordinates/names (small memory footprint)
    try:
        from interactive_rtw_planner import InteractiveRTWPlanner
        # Create a minimal planner just for coordinates - don't load CSV
        planner_coords = type('Coords', (), {
            'AIRPORT_COORDINATES': InteractiveRTWPlanner.AIRPORT_COORDINATES,
            'AIRPORT_NAMES': InteractiveRTWPlanner.AIRPORT_NAMES,
            'get_airport_name': staticmethod(InteractiveRTWPlanner.get_airport_name),
            'calculate_distance_miles': staticmethod(InteractiveRTWPlanner.calculate_distance_miles),
            'get_nearby_airports': staticmethod(InteractiveRTWPlanner.get_nearby_airports),
        })()
    except Exception as e:
        print(f"Warning: Could not load airport data: {e}")
    
    return True


def format_flight(flight: dict) -> dict:
    """Format a flight dict for the frontend"""
    origin_name = planner_coords.get_airport_name(flight['origin']) if planner_coords else flight['origin']
    dest_name = planner_coords.get_airport_name(flight['destination']) if planner_coords else flight['destination']
    
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
        'origin_name': origin_name,
        'destination_name': dest_name
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


# ============================================================================
# ROUTES
# ============================================================================

@app.route('/login', methods=['GET', 'POST'])
def login():
    """Password login page"""
    if not SITE_PASSWORD:
        return redirect(url_for('index'))
    
    if session.get('authenticated'):
        return redirect(url_for('index'))
    
    error = None
    if request.method == 'POST':
        password = request.form.get('password', '')
        if password == SITE_PASSWORD:
            session['authenticated'] = True
            return redirect(url_for('index'))
        else:
            error = 'Incorrect password'
    
    return f'''
    <!DOCTYPE html>
    <html>
    <head>
        <title>RTW Planner - Login</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
            * {{ box-sizing: border-box; }}
            body {{
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
                min-height: 100vh;
                display: flex;
                align-items: center;
                justify-content: center;
                margin: 0;
                padding: 20px;
            }}
            .login-container {{
                background: rgba(255, 255, 255, 0.05);
                backdrop-filter: blur(10px);
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 16px;
                padding: 40px;
                width: 100%;
                max-width: 400px;
                text-align: center;
            }}
            h1 {{
                color: #fff;
                margin: 0 0 10px 0;
                font-size: 28px;
            }}
            .subtitle {{
                color: rgba(255, 255, 255, 0.6);
                margin-bottom: 30px;
            }}
            .error {{
                background: rgba(239, 68, 68, 0.2);
                border: 1px solid rgba(239, 68, 68, 0.5);
                color: #fca5a5;
                padding: 12px;
                border-radius: 8px;
                margin-bottom: 20px;
            }}
            input[type="password"] {{
                width: 100%;
                padding: 14px 16px;
                font-size: 16px;
                border: 1px solid rgba(255, 255, 255, 0.2);
                border-radius: 8px;
                background: rgba(255, 255, 255, 0.1);
                color: #fff;
                margin-bottom: 16px;
                outline: none;
                transition: border-color 0.2s;
            }}
            input[type="password"]:focus {{
                border-color: #667eea;
            }}
            input[type="password"]::placeholder {{
                color: rgba(255, 255, 255, 0.4);
            }}
            button {{
                width: 100%;
                padding: 14px;
                font-size: 16px;
                font-weight: 600;
                color: #fff;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                border: none;
                border-radius: 8px;
                cursor: pointer;
                transition: transform 0.2s, box-shadow 0.2s;
            }}
            button:hover {{
                transform: translateY(-2px);
                box-shadow: 0 4px 20px rgba(102, 126, 234, 0.4);
            }}
            .emoji {{
                font-size: 48px;
                margin-bottom: 20px;
            }}
        </style>
    </head>
    <body>
        <div class="login-container">
            <div class="emoji">🌍✈️</div>
            <h1>RTW Trip Planner</h1>
            <p class="subtitle">Enter password to continue</p>
            {"<div class='error'>" + error + "</div>" if error else ""}
            <form method="POST">
                <input type="password" name="password" placeholder="Password" autofocus required>
                <button type="submit">Enter</button>
            </form>
        </div>
    </body>
    </html>
    '''


@app.route('/logout')
def logout():
    """Log out and clear session"""
    session.clear()
    return redirect(url_for('login'))


@app.route('/')
@password_required
def index():
    """Serve the main page"""
    if _init_error:
        return f"""
        <!DOCTYPE html>
        <html>
        <head><title>RTW Planner - Setup Required</title>
        <style>
            body {{ font-family: -apple-system, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }}
            h1 {{ color: #667eea; }}
            .error {{ background: #ffebee; padding: 15px; border-radius: 8px; color: #c62828; }}
            .instructions {{ background: #e3f2fd; padding: 15px; border-radius: 8px; margin-top: 20px; }}
            code {{ background: #f5f5f5; padding: 2px 6px; border-radius: 4px; }}
        </style>
        </head>
        <body>
            <h1>🌍 RTW Trip Planner</h1>
            <div class="error"><strong>Setup Required:</strong> {_init_error}</div>
            <div class="instructions">
                <h3>To fix this:</h3>
                <ol>
                    <li>Upload your flight database (<code>flights.db</code>) or CSV file</li>
                    <li>Or run <code>python build_database.py</code> locally first</li>
                    <li>Restart the application</li>
                </ol>
            </div>
        </body>
        </html>
        """, 503
    return render_template('index.html')


@app.route('/suggestions')
@password_required
def suggestions():
    return render_template('suggestions.html')


@app.route('/health')
@app.route('/healthz')
def health():
    return jsonify({'status': 'ok'}), 200


@app.route('/api/status')
def status():
    return jsonify({
        'status': 'ok' if data_source else 'error',
        'initialized': data_source is not None,
        'error': _init_error,
        'using_api': _using_api,
        'data_source': 'seats.aero API' if _using_api else 'SQLite database'
    })


@app.route('/api/flights', methods=['GET'])
def get_flights():
    """Get available flights from an airport"""
    if not data_source:
        return jsonify({'error': 'Not initialized'}), 500
    
    origin = request.args.get('origin', '').upper()
    target_date = request.args.get('date', '')
    date_range = int(request.args.get('date_range', 2))
    cabin_class = request.args.get('cabin_class', None)
    
    if not origin or not target_date:
        return jsonify({'error': 'Origin and date required'}), 400
    
    try:
        flights = data_source.get_flights_from_origin(origin, target_date, date_range)
        flights = filter_by_cabin_class(flights, cabin_class)
        formatted = [format_flight(f) for f in flights]
        
        return jsonify({'flights': formatted, 'count': len(formatted), 'source': 'api' if _using_api else 'database'})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/flights-to', methods=['GET'])
def get_flights_to():
    """Get available flights TO an airport"""
    if not data_source:
        return jsonify({'error': 'Not initialized'}), 500
    
    destination = request.args.get('destination', '').upper()
    target_date = request.args.get('date', '')
    date_range = int(request.args.get('date_range', 2))
    cabin_class = request.args.get('cabin_class', None)
    
    if not destination or not target_date:
        return jsonify({'error': 'Destination and date required'}), 400
    
    try:
        flights = data_source.get_flights_to_destination(destination, target_date, date_range)
        flights = filter_by_cabin_class(flights, cabin_class)
        formatted = [format_flight(f) for f in flights]
        
        return jsonify({'flights': formatted, 'count': len(formatted), 'source': 'api' if _using_api else 'database'})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/nearby-airports', methods=['GET'])
def get_nearby_airports():
    """Get nearby airports"""
    if not planner_coords:
        return jsonify({'error': 'Not initialized'}), 500
    
    airport = request.args.get('airport', '').upper()
    if not airport:
        return jsonify({'error': 'Airport code required'}), 400
    
    try:
        nearby = planner_coords.get_nearby_airports(airport, max_results=5)
        formatted = [{'code': code, 'distance': round(distance), 'name': city_name} 
                    for code, distance, city_name in nearby]
        return jsonify({'airports': formatted})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/airport-coords', methods=['GET'])
def get_airport_coords():
    """Get coordinates for airports"""
    if not planner_coords:
        return jsonify({'error': 'Not initialized'}), 500
    
    airports = request.args.getlist('airports')
    coords = {}
    
    for airport in airports:
        airport = airport.upper()
        if airport in planner_coords.AIRPORT_COORDINATES:
            lat, lon = planner_coords.AIRPORT_COORDINATES[airport]
            coords[airport] = {
                'lat': lat,
                'lon': lon,
                'name': planner_coords.get_airport_name(airport)
            }
        else:
            coords[airport] = {'lat': 0.0, 'lon': 0.0, 'name': airport}
    
    return jsonify(coords)


@app.route('/api/all-airports', methods=['GET'])
def get_all_airports():
    """Get all unique airports"""
    if not data_source:
        return jsonify({'error': 'Not initialized'}), 500
    
    try:
        all_airports = data_source.get_all_airports()
        return jsonify({
            'total_airports': len(all_airports),
            'airports': sorted(list(all_airports))
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/validate-trip', methods=['POST'])
def validate_trip():
    """Validate a RTW trip"""
    try:
        from interactive_rtw_planner import OneWorldRTWValidator, InteractiveRTWPlanner
        
        data = request.json
        segments = data.get('segments', [])
        
        for segment in segments:
            if 'distance_miles' not in segment:
                segment['distance_miles'] = InteractiveRTWPlanner.calculate_distance_miles(
                    segment['origin'], segment['destination']
                )
        
        validation = OneWorldRTWValidator.validate_rtw_trip(segments)
        return jsonify(validation)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/airport-names', methods=['GET'])
def get_airport_names():
    """Get airport names"""
    if not planner_coords:
        return jsonify({'error': 'Not initialized'}), 500
    
    airports = request.args.getlist('airports')
    names = {a.upper(): planner_coords.get_airport_name(a.upper()) for a in airports}
    return jsonify(names)


@app.route('/api/airport-has-flights', methods=['GET'])
def airport_has_flights():
    """Check if an airport has flights"""
    if not data_source:
        return jsonify({'error': 'Not initialized'}), 500
    
    airport = request.args.get('airport', '').upper()
    start_date = request.args.get('start_date', '')
    
    if not airport or not start_date:
        return jsonify({'error': 'Airport and start_date required'}), 400
    
    try:
        has_flights = data_source.airport_has_flights(airport, start_date)
        return jsonify({'airport': airport, 'has_flights': has_flights})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/suggest-trips', methods=['POST'])
def suggest_trips():
    """Generate trip suggestions - simplified for memory efficiency"""
    return jsonify({
        'error': 'Trip suggestions temporarily disabled for memory optimization',
        'suggestions': [],
        'count': 0
    })


# ============================================================================
# STARTUP
# ============================================================================

# Initialize on import (for gunicorn)
init_app()

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5001))
    debug = os.environ.get('FLASK_ENV') != 'production'
    print(f"🌐 Starting web server on http://localhost:{port}")
    app.run(debug=debug, host='0.0.0.0', port=port)

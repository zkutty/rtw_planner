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
                'economy_seats': flight.get('economy_seats', 0),
                'economy_miles': flight.get('economy_miles'),
                'economy_miles_int': flight.get('economy_miles_int', 0),
                'business_carriers': flight.get('business_carriers'),
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
    return jsonify(coords)

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


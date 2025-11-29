#!/usr/bin/env python3
"""
Script to update interactive_rtw_planner.py with missing airport coordinates
"""
import os
import airportsdata

def get_airport_coords(code):
    """Get coordinates for an airport code"""
    try:
        airport = airportsdata.load('IATA')[code.upper()]
        return (airport['lat'], airport['lon'])
    except (KeyError, TypeError):
        return None

def main():
    csv_file = os.environ.get('CSV_FILE', 'seats.aero qantas Export.csv')
    if not os.path.exists(csv_file):
        print(f"CSV file not found: {csv_file}")
        return
    
    from interactive_rtw_planner import InteractiveRTWPlanner
    
    planner = InteractiveRTWPlanner(csv_file)
    all_airports = planner.get_all_airports()
    airports_with_coords = set(planner.AIRPORT_COORDINATES.keys())
    missing_coords = sorted(all_airports - airports_with_coords)
    
    print(f"Found {len(missing_coords)} airports missing coordinates")
    print("Fetching coordinates...")
    
    new_coords = {}
    for code in missing_coords:
        coords = get_airport_coords(code)
        if coords:
            new_coords[code] = coords
    
    print(f"✓ Found coordinates for {len(new_coords)} airports")
    
    # Read the file
    with open('interactive_rtw_planner.py', 'r') as f:
        content = f.read()
    
    # Find the end of AIRPORT_COORDINATES dictionary
    start_marker = "        'TYS': (35.8110, -83.9940), 'SMF': (38.6954, -121.5908)\n    }"
    
    if start_marker not in content:
        print("Could not find insertion point in file")
        return
    
    # Group new coordinates by region
    regions = {
        'North America': [],
        'Europe': [],
        'Asia': [],
        'Oceania': [],
        'South America': [],
        'Africa': [],
        'Middle East': [],
        'Others': []
    }
    
    for code, (lat, lon) in sorted(new_coords.items()):
        if -50 <= lat <= 70 and -180 <= lon <= -50:  # North America
            regions['North America'].append((code, lat, lon))
        elif 35 <= lat <= 70 and -10 <= lon <= 40:  # Europe
            regions['Europe'].append((code, lat, lon))
        elif -10 <= lat <= 50 and 60 <= lon <= 180:  # Asia
            regions['Asia'].append((code, lat, lon))
        elif -50 <= lat <= -10 and 110 <= lon <= 180:  # Oceania
            regions['Oceania'].append((code, lat, lon))
        elif -60 <= lat <= 15 and -90 <= lon <= -30:  # South America
            regions['South America'].append((code, lat, lon))
        elif -35 <= lat <= 35 and -20 <= lon <= 55:  # Africa
            regions['Africa'].append((code, lat, lon))
        elif 12 <= lat <= 45 and 25 <= lon <= 60:  # Middle East
            regions['Middle East'].append((code, lat, lon))
        else:
            regions['Others'].append((code, lat, lon))
    
    # Build the insertion text
    insert_text = ""
    for region, airports in regions.items():
        if airports:
            insert_text += f"\n        # {region}\n"
            for code, lat, lon in sorted(airports):
                insert_text += f"        '{code}': ({lat}, {lon}),\n"
    
    # Insert before the closing brace
    new_content = content.replace(
        start_marker,
        start_marker.replace('    }', insert_text.rstrip() + '\n    }')
    )
    
    # Write back
    with open('interactive_rtw_planner.py', 'w') as f:
        f.write(new_content)
    
    print(f"✓ Updated interactive_rtw_planner.py with {len(new_coords)} new airport coordinates")

if __name__ == '__main__':
    main()




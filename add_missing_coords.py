#!/usr/bin/env python3
"""
Script to add missing airport coordinates using airportsdata library
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
    
    found = 0
    not_found = []
    
    coords_dict = {}
    for code in missing_coords:
        coords = get_airport_coords(code)
        if coords:
            coords_dict[code] = coords
            found += 1
            if found % 50 == 0:
                print(f"  Found {found} coordinates so far...")
        else:
            not_found.append(code)
    
    print(f"\n✓ Found coordinates for {found} airports")
    print(f"✗ Could not find coordinates for {len(not_found)} airports")
    
    if not_found:
        print(f"\nMissing airports: {', '.join(not_found[:20])}{'...' if len(not_found) > 20 else ''}")
    
    # Generate Python code to add to AIRPORT_COORDINATES
    print("\n" + "="*80)
    print("Add this to AIRPORT_COORDINATES in interactive_rtw_planner.py:")
    print("="*80)
    
    # Group by region for better organization
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
    
    # Simple region detection based on coordinates
    for code, (lat, lon) in sorted(coords_dict.items()):
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
    
    for region, airports in regions.items():
        if airports:
            print(f"\n        # {region}")
            for code, lat, lon in sorted(airports):
                print(f"        '{code}': ({lat}, {lon}),")
    
    print("\n" + "="*80)

if __name__ == '__main__':
    main()




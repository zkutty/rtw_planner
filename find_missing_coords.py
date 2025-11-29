#!/usr/bin/env python3
"""
Script to find airports in CSV that are missing coordinates
"""
import os
from interactive_rtw_planner import InteractiveRTWPlanner

def main():
    csv_file = os.environ.get('CSV_FILE', 'seats.aero qantas Export.csv')
    if not os.path.exists(csv_file):
        print(f"CSV file not found: {csv_file}")
        return
    
    planner = InteractiveRTWPlanner(csv_file)
    all_airports = planner.get_all_airports()
    airports_with_coords = set(planner.AIRPORT_COORDINATES.keys())
    missing_coords = sorted(all_airports - airports_with_coords)
    
    print(f"Total airports in CSV: {len(all_airports)}")
    print(f"Airports with coordinates: {len(airports_with_coords)}")
    print(f"Missing coordinates: {len(missing_coords)}")
    print("\nMissing airport codes:")
    for code in missing_coords:
        print(f"  {code}")
    
    if missing_coords:
        print("\nTo add coordinates, you can:")
        print("1. Use an airport database API (e.g., OpenFlights, Aviation Edge)")
        print("2. Manually add them to AIRPORT_COORDINATES in interactive_rtw_planner.py")
        print("3. Use a geocoding service")

if __name__ == '__main__':
    main()




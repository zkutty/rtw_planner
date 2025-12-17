#!/usr/bin/env python3
"""
Interactive script to plan a round-the-world trip using CSV availability data
"""
import sys
import os
from datetime import datetime, timedelta
from lib.seats_aero_client import RoundTheWorldPlanner
from lib.csv_availability_reader import CSVSeatsAeroClient


def main():
    """Main function to plan RTW trip using CSV data"""
    print("=" * 60)
    print("Round-the-World Ticket Planner")
    print("Using CSV Availability Data")
    print("=" * 60)
    print()
    
    # Get CSV file path
    if len(sys.argv) > 1:
        csv_file = sys.argv[1]
    else:
        # Look for CSV files in current directory
        csv_files = [f for f in os.listdir('.') if f.endswith('.csv')]
        if csv_files:
            print("Found CSV files in current directory:")
            for i, f in enumerate(csv_files, 1):
                print(f"  {i}. {f}")
            if len(csv_files) == 1:
                csv_file = csv_files[0]
                print(f"\nUsing: {csv_file}")
            else:
                choice = input(f"\nEnter number (1-{len(csv_files)}) or CSV file path: ").strip()
                try:
                    idx = int(choice) - 1
                    csv_file = csv_files[idx]
                except (ValueError, IndexError):
                    csv_file = choice
        else:
            csv_file = input("Enter path to CSV file: ").strip()
    
    if not os.path.exists(csv_file):
        print(f"❌ Error: CSV file not found: {csv_file}")
        sys.exit(1)
    
    try:
        # Initialize CSV-based client
        print(f"Loading CSV data from: {csv_file}")
        client = CSVSeatsAeroClient(csv_file)
        planner = RoundTheWorldPlanner(client)
        print("✓ CSV data loaded successfully")
        print()
        
        # Set up search parameters for March 2026
        start_date = "2026-03-01"
        duration_days = 30
        start_city = "SYD"  # Sydney, Australia (Qantas hub)
        
        print(f"Searching for Round-the-World availability:")
        print(f"  Start Date: {start_date}")
        print(f"  Duration: ~{duration_days} days")
        print(f"  Starting City: {start_city} (Sydney)")
        print(f"  Alliance: oneworld")
        print(f"  Preferred Airline: Qantas (QF)")
        print()
        print("Planning itinerary...")
        
        # Plan the trip
        result = planner.search_rtw_availability(
            start_date=start_date,
            duration_days=duration_days,
            start_city=start_city
        )
        
        # Display results
        print()
        print("=" * 60)
        print("ITINERARY PLAN")
        print("=" * 60)
        print()
        print(f"Start Date: {result['start_date']}")
        print(f"Total Duration: {result['duration_days']} days")
        print(f"Starting Point: {result['start_city']}")
        print()
        print("Flight Segments:")
        print("-" * 60)
        
        for segment in result['segments']:
            origin_name = planner.ONEWORLD_HUBS.get(segment['origin'], segment['origin'])
            dest_name = planner.ONEWORLD_HUBS.get(segment['destination'], segment['destination'])
            print(f"Segment {segment['segment']}:")
            print(f"  {segment['origin']} ({origin_name})")
            print(f"  → {segment['destination']} ({dest_name})")
            print(f"  Date: {segment['date']}")
            print()
        
        # Display availability results
        if result.get('availability'):
            print("=" * 60)
            print("AVAILABILITY RESULTS")
            print("=" * 60)
            print()
            
            availability = result['availability']
            
            # Check if it's the CSV format
            if 'routes' in availability:
                routes_data = availability['routes']
                print(f"Total routes searched: {availability.get('total_routes', 0)}")
                print(f"Routes with matches: {availability.get('routes_with_matches', 0)}")
                print()
                
                for route_key, route_info in routes_data.items():
                    origin = route_info.get('origin', '')
                    dest = route_info.get('destination', '')
                    date = route_info.get('date', '')
                    count = route_info.get('count', 0)
                    
                    print(f"Route: {origin} → {dest} on {date}")
                    if count > 0:
                        print(f"  ✓ Found {count} availability option(s)")
                        # Show first match details
                        if route_info.get('matches'):
                            match = route_info['matches'][0]
                            print(f"  Sample match:")
                            # Show key fields from the match - prioritize important columns
                            important_keys = ['Business Carriers', 'Business Miles', 'Business Seats',
                                           'Economy Carriers', 'Economy Miles', 'Economy Seats',
                                           'First Carriers', 'First Miles', 'First Seats',
                                           'Premium Economy Carriers', 'Premium Economy Miles', 'Premium Economy Seats',
                                           'Business Taxes', 'Economy Taxes', 'First Taxes']
                            
                            shown = False
                            for key in important_keys:
                                if key in match and match[key] and str(match[key]).strip() and str(match[key]) != '0':
                                    print(f"    {key}: {match[key]}")
                                    shown = True
                            
                            # If no important keys found, show first few non-empty fields
                            if not shown:
                                for key, value in list(match.items())[:5]:
                                    if value and str(value).strip() and str(value) != '0':
                                        print(f"    {key}: {value}")
                    else:
                        print(f"  ✗ No availability found")
                    print()
            else:
                # Fallback: print raw availability data
                import json
                print(json.dumps(availability, indent=2))
        elif result.get('error'):
            print("=" * 60)
            print("ERROR")
            print("=" * 60)
            print(f"Error occurred: {result['error']}")
        else:
            print("=" * 60)
            print("NOTE")
            print("=" * 60)
            print("No availability data returned.")
        
        print()
        print("=" * 60)
        print("Next Steps:")
        print("=" * 60)
        print("1. Review the itinerary above")
        print("2. Adjust dates or cities as needed")
        print("3. Check the CSV data for more availability options")
        print("4. Book through Qantas or oneworld booking tool")
        print("   (https://es.oneworld.com)")
        print()
        
    except FileNotFoundError as e:
        print(f"❌ File Error: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"❌ Error: {e}")
        print()
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()


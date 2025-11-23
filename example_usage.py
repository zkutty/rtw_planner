#!/usr/bin/env python3
"""
Example usage of the Seats.aero API client for individual route searches
"""
from seats_aero_client import SeatsAeroClient
import json


def example_single_route_search():
    """Example: Search for a single route"""
    print("Example 1: Single Route Search")
    print("-" * 60)
    
    try:
        client = SeatsAeroClient()
        
        # Search for SYD to LAX on a specific date
        result = client.search_availability(
            origin="SYD",
            destination="LAX",
            date="2026-03-15",
            airline="QF",  # Qantas
            alliance="oneworld"
        )
        
        print(f"Search: SYD → LAX on 2026-03-15 (Qantas/oneworld)")
        print(f"Results: {json.dumps(result, indent=2)}")
        
    except Exception as e:
        print(f"Error: {e}")


def example_multiple_routes():
    """Example: Search for multiple routes"""
    print("\n\nExample 2: Multiple Routes Search")
    print("-" * 60)
    
    try:
        client = SeatsAeroClient()
        
        # Define multiple routes for RTW trip
        routes = [
            {"origin": "SYD", "destination": "HKG", "date": "2026-03-01"},
            {"origin": "HKG", "destination": "LHR", "date": "2026-03-08"},
            {"origin": "LHR", "destination": "JFK", "date": "2026-03-15"},
            {"origin": "JFK", "destination": "LAX", "date": "2026-03-22"},
            {"origin": "LAX", "destination": "SYD", "date": "2026-03-29"},
        ]
        
        result = client.bulk_availability(
            routes=routes,
            airline="QF",  # Qantas
            alliance="oneworld"
        )
        
        print("Searching multiple routes for RTW trip:")
        for route in routes:
            print(f"  {route['origin']} → {route['destination']} on {route['date']}")
        print(f"\nResults: {json.dumps(result, indent=2)}")
        
    except Exception as e:
        print(f"Error: {e}")


def example_flexible_dates():
    """Example: Search for availability across a date range"""
    print("\n\nExample 3: Flexible Date Search")
    print("-" * 60)
    
    try:
        client = SeatsAeroClient()
        
        # Search for availability around March 2026
        dates_to_check = [
            "2026-03-01",
            "2026-03-05",
            "2026-03-10",
            "2026-03-15",
            "2026-03-20",
        ]
        
        print("Checking availability for SYD → LAX on multiple dates:")
        for date in dates_to_check:
            try:
                result = client.search_availability(
                    origin="SYD",
                    destination="LAX",
                    date=date,
                    airline="QF",
                    alliance="oneworld"
                )
                print(f"  {date}: Available" if result else f"  {date}: No availability")
            except Exception as e:
                print(f"  {date}: Error - {e}")
        
    except Exception as e:
        print(f"Error: {e}")


if __name__ == "__main__":
    print("=" * 60)
    print("Seats.aero API Usage Examples")
    print("=" * 60)
    print()
    
    # Note: These examples require a valid API key
    print("NOTE: Make sure you have set up your .env file with SEATS_AERO_API_KEY")
    print()
    
    # Uncomment the examples you want to run:
    # example_single_route_search()
    # example_multiple_routes()
    # example_flexible_dates()
    
    print("\nUncomment the example functions in the code to run them.")


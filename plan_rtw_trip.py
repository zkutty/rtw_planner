#!/usr/bin/env python3
"""
Interactive script to plan a round-the-world trip using Seats.aero API
"""
import sys
from datetime import datetime, timedelta
from seats_aero_client import SeatsAeroClient, RoundTheWorldPlanner


def main():
    """Main function to plan RTW trip"""
    print("=" * 60)
    print("Round-the-World Ticket Planner")
    print("oneworld Alliance via Qantas")
    print("=" * 60)
    print()
    
    try:
        # Initialize client
        print("Connecting to Seats.aero API...")
        client = SeatsAeroClient()
        planner = RoundTheWorldPlanner(client)
        print("✓ Connected successfully")
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
            # The availability structure depends on the API response
            # This is a placeholder - you may need to adjust based on actual API response
            import json
            print(json.dumps(result['availability'], indent=2))
        elif result.get('error'):
            print("=" * 60)
            print("ERROR")
            print("=" * 60)
            print(f"Error occurred: {result['error']}")
            print()
            print("Possible reasons:")
            print("- API key may be invalid or expired")
            print("- API endpoint may have changed")
            print("- Network connectivity issue")
            print("- Rate limit exceeded (1,000 calls/day for Pro users)")
        else:
            print("=" * 60)
            print("NOTE")
            print("=" * 60)
            print("Availability data not returned.")
            print("This may be normal if the API response format differs.")
            print("Check the API documentation for the expected response format.")
        
        print()
        print("=" * 60)
        print("Next Steps:")
        print("=" * 60)
        print("1. Review the itinerary above")
        print("2. Adjust dates or cities as needed")
        print("3. Check actual availability on seats.aero website")
        print("4. Book through Qantas or oneworld booking tool")
        print("   (https://es.oneworld.com)")
        print()
        
    except ValueError as e:
        print(f"❌ Configuration Error: {e}")
        print()
        print("To fix this:")
        print("1. Get your API key from https://seats.aero/apikey")
        print("2. Create a .env file in this directory")
        print("3. Add: SEATS_AERO_API_KEY=your_key_here")
        sys.exit(1)
    except Exception as e:
        print(f"❌ Error: {e}")
        print()
        print("This could be due to:")
        print("- Invalid API key")
        print("- API endpoint changes")
        print("- Network issues")
        print("- API rate limiting")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()

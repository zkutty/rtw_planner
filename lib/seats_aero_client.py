"""
Seats.aero API Client for Round-the-World Ticket Planning
"""
import os
import requests
from datetime import datetime, timedelta
from typing import List, Dict, Optional
from dotenv import load_dotenv

load_dotenv()

class SeatsAeroClient:
    """Client for interacting with the Seats.aero API"""
    
    BASE_URL = "https://seats.aero/api"
    
    def __init__(self, api_key: Optional[str] = None):
        """
        Initialize the Seats.aero API client
        
        Args:
            api_key: Your Seats.aero API key. If not provided, will try to load from environment variable.
        """
        self.api_key = api_key or os.getenv("SEATS_AERO_API_KEY")
        if not self.api_key:
            raise ValueError(
                "API key is required. Set SEATS_AERO_API_KEY environment variable "
                "or pass it as a parameter. Get your key at https://seats.aero/apikey"
            )
        self.headers = {
            "Partner-Authorization": self.api_key,
            "Content-Type": "application/json"
        }
    
    def _make_request(
        self, 
        endpoint: str, 
        params: Optional[Dict] = None,
        method: str = "GET",
        json_data: Optional[Dict] = None
    ) -> Dict:
        """
        Make a request to the Seats.aero API
        
        Args:
            endpoint: API endpoint path
            params: Query parameters (for GET requests)
            method: HTTP method (GET or POST)
            json_data: JSON body data (for POST requests)
            
        Returns:
            JSON response from the API
        """
        url = f"{self.BASE_URL}/{endpoint.lstrip('/')}"
        
        if method.upper() == "POST":
            response = requests.post(url, headers=self.headers, json=json_data, params=params)
        else:
            response = requests.get(url, headers=self.headers, params=params)
        
        response.raise_for_status()
        return response.json()
    
    def search_availability(
        self,
        origin: str,
        destination: str,
        date: str,
        airline: Optional[str] = None,
        alliance: Optional[str] = None
    ) -> Dict:
        """
        Search for award availability between two airports
        
        Args:
            origin: Origin airport code (e.g., "SYD")
            destination: Destination airport code (e.g., "LAX")
            date: Date in YYYY-MM-DD format
            airline: Optional airline code filter (e.g., "QF" for Qantas)
            alliance: Optional alliance filter (e.g., "oneworld")
            
        Returns:
            Availability data from the API
        """
        params = {
            "origin": origin,
            "destination": destination,
            "date": date
        }
        
        if airline:
            params["airline"] = airline
        if alliance:
            params["alliance"] = alliance
            
        return self._make_request("availability", params)
    
    def bulk_availability(
        self,
        routes: List[Dict[str, str]],
        airline: Optional[str] = None,
        alliance: Optional[str] = None
    ) -> Dict:
        """
        Search for availability across multiple routes
        
        Args:
            routes: List of route dictionaries with 'origin', 'destination', and 'date' keys
            airline: Optional airline code filter
            alliance: Optional alliance filter
            
        Returns:
            Bulk availability data
        """
        json_data = {
            "routes": routes
        }
        
        params = {}
        if airline:
            params["airline"] = airline
        if alliance:
            params["alliance"] = alliance
            
        return self._make_request("availability/bulk", params=params, method="POST", json_data=json_data)
    
    def get_trip(self, trip_id: str) -> Dict:
        """
        Get details for a specific trip
        
        Args:
            trip_id: Trip identifier
            
        Returns:
            Trip details
        """
        return self._make_request(f"trips/{trip_id}")
    
    def get_route(self, route_id: str) -> Dict:
        """
        Get details for a specific route
        
        Args:
            route_id: Route identifier
            
        Returns:
            Route details
        """
        return self._make_request(f"routes/{route_id}")


class RoundTheWorldPlanner:
    """Helper class for planning round-the-world trips"""
    
    # Major oneworld hub airports
    ONEWORLD_HUBS = {
        "SYD": "Sydney, Australia (Qantas)",
        "MEL": "Melbourne, Australia (Qantas)",
        "LAX": "Los Angeles, USA (American Airlines)",
        "JFK": "New York, USA (American Airlines)",
        "LHR": "London, UK (British Airways)",
        "MAD": "Madrid, Spain (Iberia)",
        "HKG": "Hong Kong (Cathay Pacific)",
        "NRT": "Tokyo Narita, Japan (Japan Airlines)",
        "HND": "Tokyo Haneda, Japan (Japan Airlines)",
        "DXB": "Dubai, UAE (Qatar Airways)",
        "DOH": "Doha, Qatar (Qatar Airways)"
    }
    
    def __init__(self, client: SeatsAeroClient):
        """
        Initialize the planner with a Seats.aero client
        
        Args:
            client: SeatsAeroClient instance
        """
        self.client = client
    
    def plan_rtw_trip(
        self,
        start_date: str,
        duration_days: int = 30,
        start_city: str = "SYD",
        continents: List[str] = None
    ) -> Dict:
        """
        Plan a round-the-world trip
        
        Args:
            start_date: Start date in YYYY-MM-DD format
            duration_days: Approximate trip duration in days
            start_city: Starting airport code
            continents: List of continents to visit (e.g., ["Asia", "Europe", "North America"])
            
        Returns:
            Trip plan with availability information
        """
        if continents is None:
            continents = ["Asia", "Europe", "North America"]
        
        start = datetime.strptime(start_date, "%Y-%m-%d")
        
        # Calculate segment dates (roughly distribute across duration)
        segments = len(continents) + 1  # Return to origin
        days_per_segment = duration_days // segments
        
        # Build a sample RTW route
        # This is a template - you'll need to customize based on your preferences
        route_plan = {
            "start_date": start_date,
            "duration_days": duration_days,
            "start_city": start_city,
            "segments": []
        }
        
        # Example RTW route: SYD -> HKG -> LHR -> JFK -> LAX -> SYD
        sample_route = [
            {"origin": start_city, "destination": "HKG", "segment": 1},
            {"origin": "HKG", "destination": "LHR", "segment": 2},
            {"origin": "LHR", "destination": "JFK", "segment": 3},
            {"origin": "JFK", "destination": "LAX", "segment": 4},
            {"origin": "LAX", "destination": start_city, "segment": 5}
        ]
        
        routes_to_check = []
        current_date = start
        
        for i, route in enumerate(sample_route):
            route_date = (current_date + timedelta(days=i * days_per_segment)).strftime("%Y-%m-%d")
            routes_to_check.append({
                "origin": route["origin"],
                "destination": route["destination"],
                "date": route_date
            })
            route_plan["segments"].append({
                "segment": route["segment"],
                "origin": route["origin"],
                "destination": route["destination"],
                "date": route_date
            })
        
        # Search for availability
        try:
            availability = self.client.bulk_availability(
                routes_to_check,
                airline="QF",  # Qantas
                alliance="oneworld"
            )
            route_plan["availability"] = availability
        except Exception as e:
            route_plan["error"] = str(e)
            route_plan["availability"] = None
        
        return route_plan
    
    def search_rtw_availability(
        self,
        start_date: str,
        duration_days: int = 30,
        start_city: str = "SYD"
    ) -> Dict:
        """
        Search for round-the-world availability around a specific date
        
        Args:
            start_date: Start date in YYYY-MM-DD format
            duration_days: Approximate trip duration
            start_city: Starting airport code
            
        Returns:
            Availability search results
        """
        return self.plan_rtw_trip(start_date, duration_days, start_city)


if __name__ == "__main__":
    # Example usage
    try:
        client = SeatsAeroClient()
        planner = RoundTheWorldPlanner(client)
        
        # Search for RTW availability in March 2026
        result = planner.search_rtw_availability(
            start_date="2026-03-01",
            duration_days=30,
            start_city="SYD"
        )
        
        print("Round-the-World Trip Plan:")
        print(f"Start Date: {result['start_date']}")
        print(f"Duration: {result['duration_days']} days")
        print(f"Starting City: {result['start_city']}")
        print("\nSegments:")
        for segment in result['segments']:
            print(f"  Segment {segment['segment']}: {segment['origin']} -> {segment['destination']} on {segment['date']}")
        
        if result.get('availability'):
            print("\nAvailability found!")
            print(result['availability'])
        elif result.get('error'):
            print(f"\nError: {result['error']}")
        else:
            print("\nNo availability data returned")
            
    except ValueError as e:
        print(f"Configuration Error: {e}")
        print("\nTo get started:")
        print("1. Get your API key from https://seats.aero/apikey")
        print("2. Create a .env file with: SEATS_AERO_API_KEY=your_key_here")
    except Exception as e:
        print(f"Error: {e}")


"""
Seats.aero Partner API Client for Round-the-World Ticket Planning
Uses the Partner API: https://developers.seats.aero/reference/getting-started-p
"""
import os
import requests
from datetime import datetime, timedelta
from typing import List, Dict, Optional, Set
from functools import lru_cache

# Default source for Qantas award availability
DEFAULT_SOURCE = "qantas"


class SeatsAeroPartnerAPI:
    """Client for the Seats.aero Partner API"""
    
    BASE_URL = "https://seats.aero/partnerapi"
    
    def __init__(self, api_key: Optional[str] = None, source: str = DEFAULT_SOURCE):
        """
        Initialize the Seats.aero Partner API client
        
        Args:
            api_key: Your Seats.aero Partner API key. If not provided, will try to load from environment variable.
            source: The source for availability data (default: "qantas")
        """
        self.api_key = api_key or os.getenv("SEATS_AERO_API_KEY")
        if not self.api_key:
            raise ValueError(
                "API key is required. Set SEATS_AERO_API_KEY environment variable "
                "or pass it as a parameter. Get your key at https://seats.aero/settings"
            )
        self.source = source
        self.headers = {
            "Partner-Authorization": self.api_key,
            "Accept": "application/json"
        }
        # Cache for storing fetched data
        self._cache = {}
        self._cache_expiry = {}
        self._cache_ttl = 300  # 5 minutes cache TTL
    
    def _make_request(self, endpoint: str, params: Optional[Dict] = None) -> Dict:
        """
        Make a GET request to the Seats.aero Partner API
        
        Args:
            endpoint: API endpoint path
            params: Query parameters
            
        Returns:
            JSON response from the API
        """
        url = f"{self.BASE_URL}/{endpoint.lstrip('/')}"
        
        # Add source to params if not present
        if params is None:
            params = {}
        if 'source' not in params:
            params['source'] = self.source
        
        response = requests.get(url, headers=self.headers, params=params, verify=True, timeout=30)
        response.raise_for_status()
        return response.json()
    
    def _get_cache_key(self, *args):
        """Generate a cache key from arguments"""
        return str(args)
    
    def _is_cache_valid(self, key: str) -> bool:
        """Check if cache entry is still valid"""
        if key not in self._cache_expiry:
            return False
        return datetime.now() < self._cache_expiry[key]
    
    def _set_cache(self, key: str, value):
        """Set a cache entry"""
        self._cache[key] = value
        self._cache_expiry[key] = datetime.now() + timedelta(seconds=self._cache_ttl)
    
    def get_availability(
        self,
        origin_airport: Optional[str] = None,
        destination_airport: Optional[str] = None,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        take: int = 500,
        cursor: Optional[int] = None
    ) -> Dict:
        """
        Get cached availability from the Partner API
        
        Args:
            origin_airport: Filter by origin airport code (e.g., "SYD")
            destination_airport: Filter by destination airport code
            start_date: Start date in YYYY-MM-DD format
            end_date: End date in YYYY-MM-DD format
            take: Number of results to return (max 500)
            cursor: Pagination cursor for fetching more results
            
        Returns:
            Availability data from the API
        """
        params = {"take": min(take, 500)}
        
        if origin_airport:
            params["origin_airport"] = origin_airport.upper()
        if destination_airport:
            params["destination_airport"] = destination_airport.upper()
        if start_date:
            params["start_date"] = start_date
        if end_date:
            params["end_date"] = end_date
        if cursor:
            params["cursor"] = cursor
        
        return self._make_request("availability", params)
    
    def get_all_availability(
        self,
        origin_airport: Optional[str] = None,
        destination_airport: Optional[str] = None,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        max_results: int = 2000
    ) -> List[Dict]:
        """
        Get all availability records, handling pagination automatically
        
        Args:
            origin_airport: Filter by origin airport code
            destination_airport: Filter by destination airport code  
            start_date: Start date in YYYY-MM-DD format
            end_date: End date in YYYY-MM-DD format
            max_results: Maximum number of results to return
            
        Returns:
            List of all availability records
        """
        all_data = []
        cursor = None
        
        while len(all_data) < max_results:
            response = self.get_availability(
                origin_airport=origin_airport,
                destination_airport=destination_airport,
                start_date=start_date,
                end_date=end_date,
                take=500,
                cursor=cursor
            )
            
            data = response.get("data", [])
            all_data.extend(data)
            
            if not response.get("hasMore", False) or not data:
                break
            
            cursor = response.get("cursor")
        
        return all_data[:max_results]
    
    def get_flights_from_origin(
        self,
        origin: str,
        target_date: str,
        date_range: int = 2
    ) -> List[Dict]:
        """
        Get flights from an origin airport within a date range
        Converts API response format to match the existing app format
        
        Args:
            origin: Origin airport code
            target_date: Target date in YYYY-MM-DD format
            date_range: Number of days forward from target date to search
            
        Returns:
            List of flight dictionaries in the app's expected format
        """
        # Calculate date range - search forward from target date
        target = datetime.strptime(target_date, "%Y-%m-%d")
        start_date = target_date  # Start from the target date
        end_date = (target + timedelta(days=date_range)).strftime("%Y-%m-%d")
        
        # Check cache
        cache_key = self._get_cache_key("from", origin, start_date, end_date)
        if self._is_cache_valid(cache_key):
            availability = self._cache[cache_key]
        else:
            availability = self.get_all_availability(
                origin_airport=origin,
                start_date=start_date,
                end_date=end_date,
                max_results=1000
            )
            self._set_cache(cache_key, availability)
        
        return self._convert_to_app_format(availability, target_date)
    
    def get_flights_to_destination(
        self,
        destination: str,
        target_date: str,
        date_range: int = 2
    ) -> List[Dict]:
        """
        Get flights to a destination airport within a date range
        
        Args:
            destination: Destination airport code
            target_date: Target date in YYYY-MM-DD format
            date_range: Number of days forward from target date to search
            
        Returns:
            List of flight dictionaries in the app's expected format
        """
        # Calculate date range - search forward from target date
        target = datetime.strptime(target_date, "%Y-%m-%d")
        start_date = target_date  # Start from the target date
        end_date = (target + timedelta(days=date_range)).strftime("%Y-%m-%d")
        
        # Check cache
        cache_key = self._get_cache_key("to", destination, start_date, end_date)
        if self._is_cache_valid(cache_key):
            availability = self._cache[cache_key]
        else:
            availability = self.get_all_availability(
                destination_airport=destination,
                start_date=start_date,
                end_date=end_date,
                max_results=1000
            )
            self._set_cache(cache_key, availability)
        
        return self._convert_to_app_format(availability, target_date)
    
    def _convert_to_app_format(self, availability: List[Dict], target_date: str) -> List[Dict]:
        """
        Convert API response format to the app's expected format
        
        Args:
            availability: Raw availability data from API
            target_date: Target date for calculating date_diff
            
        Returns:
            List of flight dictionaries in app format
        """
        target = datetime.strptime(target_date, "%Y-%m-%d")
        flights = []
        
        for record in availability:
            route = record.get("Route", {})
            flight_date = record.get("Date", "")
            
            # Calculate date difference
            try:
                record_date = datetime.strptime(flight_date, "%Y-%m-%d")
                date_diff = (record_date - target).days
            except:
                date_diff = 0
            
            # Parse mileage costs (handle both string and int)
            def parse_miles(val):
                if val is None:
                    return 0
                if isinstance(val, int):
                    return val
                if isinstance(val, str):
                    try:
                        return int(val) if val else 0
                    except:
                        return 0
                return 0
            
            j_miles = parse_miles(record.get("JMileageCost"))
            w_miles = parse_miles(record.get("WMileageCost"))
            y_miles = parse_miles(record.get("YMileageCost"))
            f_miles = parse_miles(record.get("FMileageCost"))
            
            # Determine if any class has availability
            j_available = record.get("JAvailable", False)
            w_available = record.get("WAvailable", False)
            y_available = record.get("YAvailable", False)
            f_available = record.get("FAvailable", False)
            
            # Skip if nothing is available
            if not any([j_available, w_available, y_available, f_available]):
                continue
            
            flight = {
                'origin': route.get("OriginAirport", ""),
                'destination': route.get("DestinationAirport", ""),
                'date': flight_date,
                'date_diff': date_diff,
                'is_direct': record.get("JDirect", False) or record.get("YDirect", False),
                'num_stops': 0 if (record.get("JDirect", False) or record.get("YDirect", False)) else 1,
                
                # Business class
                'business_seats': 1 if j_available else 0,
                'business_miles': str(j_miles) if j_miles > 0 else None,
                'business_miles_int': j_miles,
                'business_carriers': record.get("JAirlines", ""),
                
                # Premium Economy
                'premium_economy_seats': 1 if w_available else 0,
                'premium_economy_miles': str(w_miles) if w_miles > 0 else None,
                'premium_economy_miles_int': w_miles,
                'premium_economy_carriers': record.get("WAirlines", ""),
                
                # Economy
                'economy_seats': 1 if y_available else 0,
                'economy_miles': str(y_miles) if y_miles > 0 else None,
                'economy_miles_int': y_miles,
                'economy_carriers': record.get("YAirlines", ""),
                
                # First class (bonus info)
                'first_available': f_available,
                'first_miles': str(f_miles) if f_miles > 0 else None,
                'first_carriers': record.get("FAirlines", ""),
                
                # Extra info from API
                'distance': route.get("Distance", 0),
                'source': record.get("Source", ""),
            }
            
            flights.append(flight)
        
        # Sort by date_diff (closest dates first), then by destination
        flights.sort(key=lambda f: (abs(f['date_diff']), f['destination']))
        
        return flights
    
    def get_routes(self) -> Dict:
        """Get all available routes"""
        return self._make_request("routes")
    
    def get_all_airports(self) -> Set[str]:
        """Get all unique airports from available routes"""
        cache_key = "all_airports"
        if self._is_cache_valid(cache_key):
            return self._cache[cache_key]
        
        try:
            routes_response = self.get_routes()
            airports = set()
            
            for route in routes_response.get("data", []):
                if route.get("OriginAirport"):
                    airports.add(route["OriginAirport"])
                if route.get("DestinationAirport"):
                    airports.add(route["DestinationAirport"])
            
            self._set_cache(cache_key, airports)
            return airports
        except Exception as e:
            print(f"Error fetching routes: {e}")
            return set()
    
    def airport_has_flights(self, airport: str, start_date: str) -> bool:
        """Check if an airport has any flights available"""
        try:
            # Check both as origin and destination
            end_date = (datetime.strptime(start_date, "%Y-%m-%d") + timedelta(days=30)).strftime("%Y-%m-%d")
            
            # Check as origin
            response = self.get_availability(
                origin_airport=airport,
                start_date=start_date,
                end_date=end_date,
                take=1
            )
            if response.get("data"):
                return True
            
            # Check as destination
            response = self.get_availability(
                destination_airport=airport,
                start_date=start_date,
                end_date=end_date,
                take=1
            )
            return bool(response.get("data"))
        except:
            return False


# Convenience function for testing
def test_api(api_key: str):
    """Test the API connection"""
    client = SeatsAeroPartnerAPI(api_key)
    
    print("Testing Seats.aero Partner API...")
    print("-" * 50)
    
    # Test getting flights from SYD
    print("\nFlights from SYD on 2025-12-01:")
    flights = client.get_flights_from_origin("SYD", "2025-12-01", date_range=2)
    
    for flight in flights[:5]:
        print(f"  {flight['origin']} -> {flight['destination']} on {flight['date']}")
        if flight['business_miles_int'] > 0:
            print(f"    Business: {flight['business_miles']} miles ({flight['business_carriers']})")
        if flight['economy_miles_int'] > 0:
            print(f"    Economy: {flight['economy_miles']} miles ({flight['economy_carriers']})")
    
    print(f"\n  Total flights found: {len(flights)}")
    
    return client


if __name__ == "__main__":
    import sys
    
    if len(sys.argv) < 2:
        print("Usage: python seats_aero_partner_api.py <api_key>")
        print("       Or set SEATS_AERO_API_KEY environment variable")
        sys.exit(1)
    
    api_key = sys.argv[1] if len(sys.argv) > 1 else None
    test_api(api_key)


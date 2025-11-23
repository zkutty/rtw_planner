"""
CSV-based availability reader for Seats.aero data
"""
import csv
import os
from datetime import datetime
from typing import List, Dict, Optional
from pathlib import Path


class CSVAvailabilityReader:
    """Read availability data from CSV files"""
    
    def __init__(self, csv_file_path: str):
        """
        Initialize the CSV reader
        
        Args:
            csv_file_path: Path to the CSV file containing availability data
        """
        self.csv_file_path = csv_file_path
        self.data = []
        self._load_csv()
    
    def _load_csv(self):
        """Load and parse the CSV file"""
        if not os.path.exists(self.csv_file_path):
            raise FileNotFoundError(f"CSV file not found: {self.csv_file_path}")
        
        with open(self.csv_file_path, 'r', encoding='utf-8') as f:
            # Try to detect delimiter
            sample = f.read(1024)
            f.seek(0)
            sniffer = csv.Sniffer()
            delimiter = sniffer.sniff(sample).delimiter
            
            reader = csv.DictReader(f, delimiter=delimiter)
            self.data = list(reader)
        
        if not self.data:
            raise ValueError(f"CSV file is empty or has no data rows: {self.csv_file_path}")
        
        print(f"Loaded {len(self.data)} rows from {self.csv_file_path}")
        print(f"Columns: {list(self.data[0].keys())}")
    
    def search_availability(
        self,
        origin: str,
        destination: str,
        date: str,
        airline: Optional[str] = None,
        alliance: Optional[str] = None
    ) -> Dict:
        """
        Search for availability matching the route
        
        Args:
            origin: Origin airport code (e.g., "SYD")
            destination: Destination airport code (e.g., "LAX")
            date: Date in YYYY-MM-DD format
            airline: Optional airline code filter
            alliance: Optional alliance filter
            
        Returns:
            Dictionary with availability data
        """
        # Normalize inputs
        origin = origin.upper().strip()
        destination = destination.upper().strip()
        
        # Try to parse and normalize the date
        try:
            search_date = datetime.strptime(date, "%Y-%m-%d")
        except ValueError:
            # Try other date formats
            for fmt in ["%m/%d/%Y", "%d/%m/%Y", "%Y/%m/%d"]:
                try:
                    search_date = datetime.strptime(date, fmt)
                    break
                except ValueError:
                    continue
            else:
                search_date = None
        
        matches = []
        
        for row in self.data:
            # Try to match origin and destination
            # Check common column name variations
            row_origin = None
            row_dest = None
            row_date = None
            
            # Common column name variations
            origin_cols = ['origin airport', 'Origin Airport', 'ORIGIN AIRPORT', 
                          'origin', 'Origin', 'ORIGIN', 'from', 'From', 'FROM', 
                          'departure', 'Departure', 'DEPARTURE', 'dep', 'Dep', 'DEP']
            dest_cols = ['destination airport', 'Destination Airport', 'DESTINATION AIRPORT',
                        'destination', 'Destination', 'DESTINATION', 'to', 'To', 'TO',
                        'arrival', 'Arrival', 'ARRIVAL', 'arr', 'Arr', 'ARR']
            date_cols = ['date', 'Date', 'DATE', 'departure_date', 'Departure_Date',
                        'flight_date', 'Flight_Date', 'dep_date', 'Dep_Date']
            
            # Find origin column
            for col in origin_cols:
                if col in row:
                    row_origin = str(row[col]).upper().strip()
                    break
            
            # Find destination column
            for col in dest_cols:
                if col in row:
                    row_dest = str(row[col]).upper().strip()
                    break
            
            # Find date column
            for col in date_cols:
                if col in row:
                    row_date = str(row[col]).strip()
                    break
            
            # Match origin and destination
            if row_origin == origin and row_dest == destination:
                # If we have a date, try to match it (with some flexibility)
                date_match = True
                if search_date and row_date:
                    try:
                        # Try various date formats
                        row_date_obj = None
                        for fmt in ["%Y-%m-%d", "%m/%d/%Y", "%d/%m/%Y", "%Y/%m/%d", "%Y-%m-%d %H:%M:%S"]:
                            try:
                                row_date_obj = datetime.strptime(row_date.split()[0], fmt)
                                break
                            except (ValueError, IndexError):
                                continue
                        
                        if row_date_obj:
                            # Allow matches within a few days (flexible date matching)
                            date_diff = abs((search_date - row_date_obj).days)
                            date_match = date_diff <= 3  # Allow 3 days flexibility
                    except:
                        date_match = True  # If date parsing fails, include the match
                
                if date_match:
                    # Apply airline filter if specified
                    if airline:
                        airline_cols = ['economy carriers', 'Economy Carriers', 'ECONOMY CARRIERS',
                                       'business carriers', 'Business Carriers', 'BUSINESS CARRIERS',
                                       'first carriers', 'First Carriers', 'FIRST CARRIERS',
                                       'premium economy carriers', 'Premium Economy Carriers',
                                       'airline', 'Airline', 'AIRLINE', 'carrier', 'Carrier', 'CARRIER']
                        row_airline = None
                        for col in airline_cols:
                            if col in row:
                                row_airline = str(row[col]).upper().strip()
                                break
                        if row_airline and airline.upper() not in row_airline:
                            continue
                    
                    # Apply alliance filter if specified
                    if alliance:
                        alliance_cols = ['alliance', 'Alliance', 'ALLIANCE']
                        row_alliance = None
                        for col in alliance_cols:
                            if col in row:
                                row_alliance = str(row[col]).upper().strip()
                                break
                        if row_alliance and alliance.lower() not in row_alliance.lower():
                            continue
                    
                    matches.append(row)
        
        return {
            "origin": origin,
            "destination": destination,
            "date": date,
            "matches": matches,
            "count": len(matches)
        }
    
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
            Dictionary with availability data for all routes
        """
        results = {}
        
        for route in routes:
            origin = route.get('origin')
            destination = route.get('destination')
            date = route.get('date')
            
            if not all([origin, destination, date]):
                continue
            
            route_key = f"{origin}-{destination}-{date}"
            results[route_key] = self.search_availability(
                origin=origin,
                destination=destination,
                date=date,
                airline=airline,
                alliance=alliance
            )
        
        return {
            "routes": results,
            "total_routes": len(routes),
            "routes_with_matches": sum(1 for r in results.values() if r['count'] > 0)
        }


class CSVSeatsAeroClient:
    """Wrapper to make CSVAvailabilityReader compatible with SeatsAeroClient interface"""
    
    def __init__(self, csv_file_path: str):
        """
        Initialize the CSV-based client
        
        Args:
            csv_file_path: Path to the CSV file containing availability data
        """
        self.reader = CSVAvailabilityReader(csv_file_path)
    
    def search_availability(
        self,
        origin: str,
        destination: str,
        date: str,
        airline: Optional[str] = None,
        alliance: Optional[str] = None
    ) -> Dict:
        """Search for availability (compatible with SeatsAeroClient interface)"""
        return self.reader.search_availability(origin, destination, date, airline, alliance)
    
    def bulk_availability(
        self,
        routes: List[Dict[str, str]],
        airline: Optional[str] = None,
        alliance: Optional[str] = None
    ) -> Dict:
        """Bulk search for availability (compatible with SeatsAeroClient interface)"""
        return self.reader.bulk_availability(routes, airline, alliance)


if __name__ == "__main__":
    # Example usage
    import sys
    
    if len(sys.argv) < 2:
        print("Usage: python csv_availability_reader.py <csv_file_path>")
        print("\nExample:")
        print("  python csv_availability_reader.py availability_data.csv")
        sys.exit(1)
    
    csv_path = sys.argv[1]
    
    try:
        reader = CSVAvailabilityReader(csv_path)
        
        # Example search
        print("\n" + "="*60)
        print("Example: Searching for SYD -> LAX on 2026-03-15")
        print("="*60)
        
        result = reader.search_availability(
            origin="SYD",
            destination="LAX",
            date="2026-03-15"
        )
        
        print(f"Found {result['count']} matches")
        if result['matches']:
            print("\nFirst match:")
            for key, value in list(result['matches'][0].items())[:10]:
                print(f"  {key}: {value}")
        
    except Exception as e:
        print(f"Error: {e}")
        import traceback
        traceback.print_exc()


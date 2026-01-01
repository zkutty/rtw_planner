"""
CSV-based availability reader for Seats.aero data
Optimized with indexing for fast lookups
"""
import csv
import os
from datetime import datetime
from typing import List, Dict, Optional, Set
from functools import lru_cache


class CSVAvailabilityReader:
    """Read availability data from CSV files with optimized indexing"""
    
    # Column name variations (cached at class level)
    ORIGIN_COLS = ['Origin Airport', 'origin airport', 'ORIGIN AIRPORT', 
                   'origin', 'Origin', 'ORIGIN', 'from', 'From', 'FROM', 
                   'departure', 'Departure', 'DEPARTURE', 'dep', 'Dep', 'DEP']
    DEST_COLS = ['Destination Airport', 'destination airport', 'DESTINATION AIRPORT',
                 'destination', 'Destination', 'DESTINATION', 'to', 'To', 'TO',
                 'arrival', 'Arrival', 'ARRIVAL', 'arr', 'Arr', 'ARR']
    DATE_COLS = ['Date', 'date', 'DATE', 'departure_date', 'Departure_Date',
                 'flight_date', 'Flight_Date', 'dep_date', 'Dep_Date']
    
    def __init__(self, csv_file_path: str):
        """
        Initialize the CSV reader with indexing
        
        Args:
            csv_file_path: Path to the CSV file containing availability data
        """
        self.csv_file_path = csv_file_path
        self.data = []
        
        # Pre-built indexes for fast lookup
        self._index_by_origin: Dict[str, List[dict]] = {}
        self._index_by_destination: Dict[str, List[dict]] = {}
        self._index_by_route: Dict[str, List[dict]] = {}
        
        # Detected column names (cached after first detection)
        self._origin_col: Optional[str] = None
        self._dest_col: Optional[str] = None
        self._date_col: Optional[str] = None
        
        self._load_csv()
        self._build_indexes()
    
    def _load_csv(self):
        """Load and parse the CSV file"""
        if not os.path.exists(self.csv_file_path):
            raise FileNotFoundError(f"CSV file not found: {self.csv_file_path}")
        
        with open(self.csv_file_path, 'r', encoding='utf-8') as f:
            # Detect delimiter
            sample = f.read(1024)
            f.seek(0)
            sniffer = csv.Sniffer()
            delimiter = sniffer.sniff(sample).delimiter
            
            reader = csv.DictReader(f, delimiter=delimiter)
            self.data = list(reader)
        
        if not self.data:
            raise ValueError(f"CSV file is empty: {self.csv_file_path}")
        
        # Detect column names once
        first_row = self.data[0]
        for col in self.ORIGIN_COLS:
            if col in first_row:
                self._origin_col = col
                break
        for col in self.DEST_COLS:
            if col in first_row:
                self._dest_col = col
                break
        for col in self.DATE_COLS:
            if col in first_row:
                self._date_col = col
                break
        
        print(f"Loaded {len(self.data)} rows from {self.csv_file_path}")
    
    def _build_indexes(self):
        """Build indexes for O(1) lookup by origin and destination"""
        for row in self.data:
            origin = self._get_origin(row)
            dest = self._get_destination(row)
            
            if origin:
                if origin not in self._index_by_origin:
                    self._index_by_origin[origin] = []
                self._index_by_origin[origin].append(row)
            
            if dest:
                if dest not in self._index_by_destination:
                    self._index_by_destination[dest] = []
                self._index_by_destination[dest].append(row)
            
            if origin and dest:
                route_key = f"{origin}-{dest}"
                if route_key not in self._index_by_route:
                    self._index_by_route[route_key] = []
                self._index_by_route[route_key].append(row)
        
        print(f"Built indexes: {len(self._index_by_origin)} origins, {len(self._index_by_destination)} destinations")
    
    def _get_origin(self, row: dict) -> Optional[str]:
        """Get origin from row using cached column name"""
        if self._origin_col and self._origin_col in row:
            val = row[self._origin_col]
            return str(val).upper().strip() if val else None
        return None
    
    def _get_destination(self, row: dict) -> Optional[str]:
        """Get destination from row using cached column name"""
        if self._dest_col and self._dest_col in row:
            val = row[self._dest_col]
            return str(val).upper().strip() if val else None
        return None
    
    def _get_date(self, row: dict) -> Optional[str]:
        """Get date from row using cached column name"""
        if self._date_col and self._date_col in row:
            val = row[self._date_col]
            return str(val).strip() if val else None
        return None
    
    def get_rows_by_origin(self, origin: str) -> List[dict]:
        """Get all rows for a given origin airport - O(1) lookup"""
        return self._index_by_origin.get(origin.upper().strip(), [])
    
    def get_rows_by_destination(self, destination: str) -> List[dict]:
        """Get all rows for a given destination airport - O(1) lookup"""
        return self._index_by_destination.get(destination.upper().strip(), [])
    
    def get_rows_by_route(self, origin: str, destination: str) -> List[dict]:
        """Get all rows for a given route - O(1) lookup"""
        route_key = f"{origin.upper().strip()}-{destination.upper().strip()}"
        return self._index_by_route.get(route_key, [])
    
    def get_all_origins(self) -> Set[str]:
        """Get all unique origin airports"""
        return set(self._index_by_origin.keys())
    
    def get_all_destinations(self) -> Set[str]:
        """Get all unique destination airports"""
        return set(self._index_by_destination.keys())
    
    def search_availability(
        self,
        origin: str,
        destination: str,
        date: str,
        airline: Optional[str] = None,
        alliance: Optional[str] = None
    ) -> Dict:
        """
        Search for availability matching the route - OPTIMIZED with indexing
        """
        origin = origin.upper().strip()
        destination = destination.upper().strip()
        
        # Parse search date
        search_date = None
        try:
            search_date = datetime.strptime(date, "%Y-%m-%d")
        except ValueError:
            for fmt in ["%m/%d/%Y", "%d/%m/%Y", "%Y/%m/%d"]:
                try:
                    search_date = datetime.strptime(date, fmt)
                    break
                except ValueError:
                    continue
        
        # Use index for O(1) lookup instead of scanning all data
        rows = self.get_rows_by_route(origin, destination)
        matches = []
        
        for row in rows:
            # Date filtering
            date_match = True
            if search_date:
                row_date = self._get_date(row)
                if row_date:
                    try:
                        row_date_obj = datetime.strptime(row_date.split()[0], "%Y-%m-%d")
                        date_diff = abs((search_date - row_date_obj).days)
                        date_match = date_diff <= 3
                    except:
                        pass
            
            if not date_match:
                continue
            
            # Airline filter
            if airline:
                airline_upper = airline.upper()
                row_airlines = (
                    str(row.get('Business Carriers', '') or '') +
                    str(row.get('Economy Carriers', '') or '') +
                    str(row.get('Premium Economy Carriers', '') or '')
                ).upper()
                if airline_upper not in row_airlines:
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
        """Search for availability across multiple routes"""
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
    """Wrapper for SeatsAeroClient interface compatibility"""
    
    def __init__(self, csv_file_path: str):
        self.reader = CSVAvailabilityReader(csv_file_path)
    
    def search_availability(self, origin: str, destination: str, date: str,
                           airline: Optional[str] = None, alliance: Optional[str] = None) -> Dict:
        return self.reader.search_availability(origin, destination, date, airline, alliance)
    
    def bulk_availability(self, routes: List[Dict[str, str]],
                         airline: Optional[str] = None, alliance: Optional[str] = None) -> Dict:
        return self.reader.bulk_availability(routes, airline, alliance)


if __name__ == "__main__":
    import sys
    
    if len(sys.argv) < 2:
        print("Usage: python csv_availability_reader.py <csv_file_path>")
        sys.exit(1)
    
    csv_path = sys.argv[1]
    
    try:
        reader = CSVAvailabilityReader(csv_path)
        
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

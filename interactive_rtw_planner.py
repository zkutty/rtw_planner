#!/usr/bin/env python3
"""
Interactive Round-the-World Trip Planner for oneworld Alliance
Builds a trip step-by-step and validates against oneworld RTW rules
"""
import sys
import os
import math
from datetime import datetime, timedelta
from typing import List, Dict, Optional, Set
from csv_availability_reader import CSVAvailabilityReader

# Maximum miles allowed for oneworld RTW ticket
RTW_MAX_MILES = 35000


class OneWorldRTWValidator:
    """Validates trips against oneworld RTW ticket rules"""
    
    # Major continents for RTW validation
    CONTINENTS = {
        'North America': ['JFK', 'EWR', 'LAX', 'SFO', 'ORD', 'MIA', 'DFW', 'ATL', 'BOS', 'SEA', 
                         'YYZ', 'YVR', 'MEX', 'CUN', 'CLT', 'PHL', 'IAH', 'DEN', 'PHX', 'LAS'],
        'South America': ['GRU', 'GIG', 'EZE', 'LIM', 'BOG', 'SCL', 'MVD', 'ASU'],
        'Europe': ['LHR', 'LGW', 'CDG', 'FRA', 'AMS', 'MAD', 'FCO', 'MUC', 'ZRH', 'VIE', 
                   'CPH', 'ARN', 'OSL', 'HEL', 'DUB', 'LIS', 'ATH', 'BCN', 'MXP'],
        'Asia': ['HKG', 'NRT', 'HND', 'ICN', 'PEK', 'PVG', 'SIN', 'BKK', 'KUL', 'TPE', 
                'DEL', 'BOM', 'DXB', 'DOH', 'AUH', 'IST'],
        'Oceania': ['SYD', 'MEL', 'BNE', 'PER', 'AKL', 'WLG', 'NAN', 'PPT'],
        'Africa': ['JNB', 'CPT', 'CAI', 'ADD', 'NBO', 'DAR']
    }
    
    # Ocean crossings
    ATLANTIC_CROSSING = {
        'from': ['JFK', 'EWR', 'BOS', 'MIA', 'YYZ', 'YUL'],
        'to': ['LHR', 'LGW', 'CDG', 'FRA', 'AMS', 'MAD', 'BCN', 'LIS', 'DUB', 'CPH']
    }
    
    PACIFIC_CROSSING = {
        'from': ['LAX', 'SFO', 'SEA', 'YVR', 'SYD', 'MEL', 'AKL', 'HKG', 'NRT', 'HND', 'ICN'],
        'to': ['SYD', 'MEL', 'AKL', 'HKG', 'NRT', 'HND', 'ICN', 'LAX', 'SFO', 'SEA', 'YVR']
    }
    
    @staticmethod
    def get_continent(airport: str) -> Optional[str]:
        """Get the continent for an airport code"""
        airport = airport.upper()
        for continent, airports in OneWorldRTWValidator.CONTINENTS.items():
            if airport in airports:
                return continent
        return None
    
    @staticmethod
    def validate_rtw_trip(segments: List[Dict]) -> Dict:
        """
        Validate a trip against oneworld RTW rules
        
        Args:
            segments: List of segment dicts with 'origin', 'destination', 'date' keys
            
        Returns:
            Dict with validation results
        """
        if not segments:
            return {
                'valid': False,
                'errors': ['No segments in trip'],
                'warnings': []
            }
        
        errors = []
        warnings = []
        
        # Rule 1: Minimum 3 segments, maximum 16 segments
        num_segments = len(segments)
        if num_segments < 3:
            errors.append(f"Minimum 3 segments required, found {num_segments}")
        elif num_segments > 16:
            errors.append(f"Maximum 16 segments allowed, found {num_segments}")
        
        # Rule 2: Must return to origin
        origin = segments[0]['origin'].upper()
        final_dest = segments[-1]['destination'].upper()
        if final_dest != origin:
            errors.append(f"Must return to origin ({origin}), final destination is {final_dest}")
        
        # Rule 3: Must cross both Atlantic and Pacific oceans
        atlantic_crossed = False
        pacific_crossed = False
        
        for i, segment in enumerate(segments):
            origin_airport = segment['origin'].upper()
            dest_airport = segment['destination'].upper()
            
            # Check Atlantic crossing (East to West or West to East)
            if (origin_airport in OneWorldRTWValidator.ATLANTIC_CROSSING['from'] and 
                dest_airport in OneWorldRTWValidator.ATLANTIC_CROSSING['to']):
                atlantic_crossed = True
            elif (origin_airport in OneWorldRTWValidator.ATLANTIC_CROSSING['to'] and 
                  dest_airport in OneWorldRTWValidator.ATLANTIC_CROSSING['from']):
                atlantic_crossed = True
            
            # Check Pacific crossing
            if (origin_airport in OneWorldRTWValidator.PACIFIC_CROSSING['from'] and 
                dest_airport in OneWorldRTWValidator.PACIFIC_CROSSING['to']):
                pacific_crossed = True
            elif (origin_airport in OneWorldRTWValidator.PACIFIC_CROSSING['to'] and 
                  dest_airport in OneWorldRTWValidator.PACIFIC_CROSSING['from']):
                pacific_crossed = True
        
        if not atlantic_crossed:
            errors.append("Must cross Atlantic Ocean at least once")
        if not pacific_crossed:
            errors.append("Must cross Pacific Ocean at least once")
        
        # Rule 4: Only one crossing of each ocean permitted
        atlantic_crossings = 0
        pacific_crossings = 0
        
        for segment in segments:
            origin_airport = segment['origin'].upper()
            dest_airport = segment['destination'].upper()
            
            if ((origin_airport in OneWorldRTWValidator.ATLANTIC_CROSSING['from'] and 
                 dest_airport in OneWorldRTWValidator.ATLANTIC_CROSSING['to']) or
                (origin_airport in OneWorldRTWValidator.ATLANTIC_CROSSING['to'] and 
                 dest_airport in OneWorldRTWValidator.ATLANTIC_CROSSING['from'])):
                atlantic_crossings += 1
            
            if ((origin_airport in OneWorldRTWValidator.PACIFIC_CROSSING['from'] and 
                 dest_airport in OneWorldRTWValidator.PACIFIC_CROSSING['to']) or
                (origin_airport in OneWorldRTWValidator.PACIFIC_CROSSING['to'] and 
                 dest_airport in OneWorldRTWValidator.PACIFIC_CROSSING['from'])):
                pacific_crossings += 1
        
        if atlantic_crossings > 1:
            errors.append(f"Only one Atlantic crossing permitted, found {atlantic_crossings}")
        if pacific_crossings > 1:
            errors.append(f"Only one Pacific crossing permitted, found {pacific_crossings}")
        
        # Rule 5: Count continents visited
        continents_visited = set()
        for segment in segments:
            origin_continent = OneWorldRTWValidator.get_continent(segment['origin'])
            dest_continent = OneWorldRTWValidator.get_continent(segment['destination'])
            if origin_continent:
                continents_visited.add(origin_continent)
            if dest_continent:
                continents_visited.add(dest_continent)
        
        num_continents = len(continents_visited)
        if num_continents < 3:
            warnings.append(f"Only {num_continents} continent(s) visited. RTW fare based on 3-6 continents.")
        elif num_continents > 6:
            warnings.append(f"{num_continents} continents visited (max 6 for fare calculation)")
        
        # Rule 6: Check for stopovers (>24 hours)
        stopovers = []
        for i in range(len(segments) - 1):
            current_date = datetime.strptime(segments[i]['date'], "%Y-%m-%d")
            next_date = datetime.strptime(segments[i + 1]['date'], "%Y-%m-%d")
            hours = (next_date - current_date).total_seconds() / 3600
            
            if hours > 24:
                stopovers.append({
                    'airport': segments[i]['destination'],
                    'days': hours / 24,
                    'segment': i + 1
                })
        
        # Calculate total trip duration
        start_date = datetime.strptime(segments[0]['date'], "%Y-%m-%d")
        end_date = datetime.strptime(segments[-1]['date'], "%Y-%m-%d")
        total_days = (end_date - start_date).days
        
        # Calculate total distance
        total_distance = 0
        for segment in segments:
            origin = segment['origin'].upper()
            dest = segment['destination'].upper()
            distance = InteractiveRTWPlanner.calculate_distance_miles(origin, dest)
            total_distance += distance
        
        # Check 35,000 mile limit
        RTW_LIMIT = 35000
        if total_distance > RTW_LIMIT:
            errors.append(f"Total distance ({total_distance:,.0f} miles) exceeds 35,000 mile limit")
        elif total_distance > RTW_LIMIT * 0.95:  # Warn if over 95% of limit
            warnings.append(f"Total distance ({total_distance:,.0f} miles) is close to 35,000 mile limit")
        
        return {
            'valid': len(errors) == 0,
            'errors': errors,
            'warnings': warnings,
            'num_segments': num_segments,
            'num_continents': num_continents,
            'continents_visited': sorted(list(continents_visited)),
            'atlantic_crossed': atlantic_crossed,
            'pacific_crossed': pacific_crossed,
            'stopovers': stopovers,
            'total_days': total_days,
            'total_distance_miles': total_distance,
            'remaining_miles': RTW_LIMIT - total_distance
        }


class InteractiveRTWPlanner:
    """Interactive planner for building RTW trips"""
    
    # Airport code to city/country mapping
    AIRPORT_NAMES = {
        # North America
        'JFK': 'New York (JFK), USA', 'EWR': 'Newark, USA', 'LGA': 'New York (LaGuardia), USA',
        'LAX': 'Los Angeles, USA', 'SFO': 'San Francisco, USA', 'SEA': 'Seattle, USA',
        'ORD': 'Chicago (O\'Hare), USA', 'MIA': 'Miami, USA', 'DFW': 'Dallas/Fort Worth, USA',
        'ATL': 'Atlanta, USA', 'BOS': 'Boston, USA', 'CLT': 'Charlotte, USA',
        'PHL': 'Philadelphia, USA', 'IAH': 'Houston, USA', 'DEN': 'Denver, USA',
        'PHX': 'Phoenix, USA', 'LAS': 'Las Vegas, USA',
        'YYZ': 'Toronto, Canada', 'YVR': 'Vancouver, Canada', 'YUL': 'Montreal, Canada',
        'MEX': 'Mexico City, Mexico', 'CUN': 'Cancun, Mexico',
        # Europe
        'LHR': 'London (Heathrow), UK', 'LGW': 'London (Gatwick), UK',
        'CDG': 'Paris (Charles de Gaulle), France', 'ORY': 'Paris (Orly), France',
        'FRA': 'Frankfurt, Germany', 'MUC': 'Munich, Germany',
        'AMS': 'Amsterdam, Netherlands', 'MAD': 'Madrid, Spain', 'BCN': 'Barcelona, Spain',
        'FCO': 'Rome (Fiumicino), Italy', 'MXP': 'Milan (Malpensa), Italy',
        'ZRH': 'Zurich, Switzerland', 'VIE': 'Vienna, Austria',
        'CPH': 'Copenhagen, Denmark', 'ARN': 'Stockholm, Sweden',
        'OSL': 'Oslo, Norway', 'HEL': 'Helsinki, Finland',
        'DUB': 'Dublin, Ireland', 'LIS': 'Lisbon, Portugal',
        'ATH': 'Athens, Greece', 'IST': 'Istanbul, Turkey',
        # Asia
        'HKG': 'Hong Kong', 'NRT': 'Tokyo (Narita), Japan', 'HND': 'Tokyo (Haneda), Japan',
        'ICN': 'Seoul (Incheon), South Korea', 'PEK': 'Beijing, China', 'PVG': 'Shanghai (Pudong), China',
        'SIN': 'Singapore', 'BKK': 'Bangkok, Thailand', 'KUL': 'Kuala Lumpur, Malaysia',
        'TPE': 'Taipei, Taiwan', 'DEL': 'Delhi, India', 'BOM': 'Mumbai, India',
        'DXB': 'Dubai, UAE', 'DOH': 'Doha, Qatar', 'AUH': 'Abu Dhabi, UAE',
        # Oceania
        'SYD': 'Sydney, Australia', 'MEL': 'Melbourne, Australia',
        'BNE': 'Brisbane, Australia', 'PER': 'Perth, Australia',
        'AKL': 'Auckland, New Zealand', 'WLG': 'Wellington, New Zealand',
        'NAN': 'Nadi, Fiji', 'PPT': 'Papeete, French Polynesia',
        # South America
        'GRU': 'São Paulo, Brazil', 'GIG': 'Rio de Janeiro, Brazil',
        'EZE': 'Buenos Aires, Argentina', 'LIM': 'Lima, Peru',
        'BOG': 'Bogotá, Colombia', 'SCL': 'Santiago, Chile',
        'MVD': 'Montevideo, Uruguay',
        # Africa
        'JNB': 'Johannesburg, South Africa', 'CPT': 'Cape Town, South Africa',
        'CAI': 'Cairo, Egypt', 'ADD': 'Addis Ababa, Ethiopia',
        'NBO': 'Nairobi, Kenya', 'DAR': 'Dar es Salaam, Tanzania',
        # Others
        'CMN': 'Casablanca, Morocco', 'SAV': 'Savannah, USA', 'ECP': 'Panama City, USA',
        'YOW': 'Ottawa, Canada', 'FPO': 'Freeport, Bahamas', 'MZT': 'Mazatlán, Mexico',
        'SAN': 'San Diego, USA', 'RDU': 'Raleigh/Durham, USA', 'COU': 'Columbia, USA',
        'TYS': 'Knoxville, USA', 'SMF': 'Sacramento, USA'
    }
    
    # Airport coordinates (latitude, longitude) for distance calculation
    AIRPORT_COORDINATES = {
        # North America
        'JFK': (40.6413, -73.7781), 'EWR': (40.6895, -74.1745), 'LGA': (40.7769, -73.8740),
        'LAX': (33.9425, -118.4081), 'SFO': (37.6213, -122.3790), 'SEA': (47.4502, -122.3088),
        'ORD': (41.9742, -87.9073), 'MIA': (25.7959, -80.2870), 'DFW': (32.8998, -97.0403),
        'ATL': (33.6407, -84.4277), 'BOS': (42.3656, -71.0096), 'CLT': (35.2144, -80.9473),
        'PHL': (39.8719, -75.2411), 'IAH': (29.9844, -95.3414), 'DEN': (39.8561, -104.6737),
        'PHX': (33.4342, -112.0116), 'LAS': (36.0840, -115.1537),
        'YYZ': (43.6772, -79.6306), 'YVR': (49.1947, -123.1792), 'YUL': (45.4577, -73.7497),
        'MEX': (19.4363, -99.0721), 'CUN': (21.0365, -86.8770),
        # Europe
        'LHR': (51.4700, -0.4543), 'LGW': (51.1537, -0.1821),
        'CDG': (49.0097, 2.5479), 'ORY': (48.7233, 2.3794),
        'FRA': (50.0379, 8.5622), 'MUC': (48.3538, 11.7861),
        'AMS': (52.3105, 4.7683), 'MAD': (40.4839, -3.5680), 'BCN': (41.2971, 2.0785),
        'FCO': (41.8003, 12.2389), 'MXP': (45.6306, 8.7281),
        'ZRH': (47.4647, 8.5492), 'VIE': (48.1103, 16.5697),
        'CPH': (55.6180, 12.6560), 'ARN': (59.6519, 17.9186),
        'OSL': (60.1939, 11.1004), 'HEL': (60.3172, 24.9633),
        'DUB': (53.4264, -6.2499), 'LIS': (38.7813, -9.1359),
        'ATH': (37.9364, 23.9445), 'IST': (41.2753, 28.7519),
        # Asia
        'HKG': (22.3080, 113.9185), 'NRT': (35.7647, 140.3863), 'HND': (35.5494, 139.7798),
        'ICN': (37.4602, 126.4407), 'PEK': (40.0799, 116.6031), 'PVG': (31.1434, 121.8052),
        'SIN': (1.3644, 103.9915), 'BKK': (13.6811, 100.7473), 'KUL': (2.7456, 101.7099),
        'TPE': (25.0797, 121.2342), 'DEL': (28.5562, 77.1000), 'BOM': (19.0896, 72.8656),
        'DXB': (25.2532, 55.3657), 'DOH': (25.2611, 51.5651), 'AUH': (24.4330, 54.6511),
        # Oceania
        'SYD': (-33.9399, 151.1753), 'MEL': (-37.6733, 144.8433),
        'BNE': (-27.3842, 153.1171), 'PER': (-31.9403, 115.9669),
        'AKL': (-37.0082, 174.7850), 'WLG': (-41.3272, 174.8052),
        'NAN': (-17.7554, 177.4434), 'PPT': (-17.5567, -149.6114),
        # South America
        'GRU': (-23.4321, -46.4692), 'GIG': (-22.8089, -43.2436),
        'EZE': (-34.8222, -58.5358), 'LIM': (-12.0219, -77.1143),
        'BOG': (4.7016, -74.1469), 'SCL': (-33.3930, -70.7858),
        'MVD': (-34.8384, -56.0308),
        # Africa
        'JNB': (-26.1392, 28.2460), 'CPT': (-33.9648, 18.6017),
        'CAI': (30.1127, 31.4000), 'ADD': (8.9779, 38.7993),
        'NBO': (-1.3192, 36.9278), 'DAR': (-6.8710, 39.2026),
        # Others
        'CMN': (33.3675, -7.5898), 'SAV': (32.1276, -81.2021), 'ECP': (30.3573, -85.7958),
        'YOW': (45.3225, -75.6692), 'FPO': (26.5587, -78.6956), 'MZT': (23.1614, -106.2661),
        'SAN': (32.7338, -117.1933), 'RDU': (35.8776, -78.7875), 'COU': (38.8181, -92.2196),
        'TYS': (35.8110, -83.9940), 'SMF': (38.6954, -121.5908)
    }
    
    @staticmethod
    def get_airport_name(code: str) -> str:
        """Get city/country name for airport code"""
        return InteractiveRTWPlanner.AIRPORT_NAMES.get(code.upper(), code)
    
    @staticmethod
    def get_nearby_airports(airport_code: str, max_results: int = 5) -> List[tuple]:
        """
        Get nearby airports sorted by distance
        
        Args:
            airport_code: Airport code to find nearby airports for
            max_results: Maximum number of nearby airports to return
            
        Returns:
            List of tuples (airport_code, distance_miles, city_name)
        """
        airport_code = airport_code.upper()
        if airport_code not in InteractiveRTWPlanner.AIRPORT_COORDINATES:
            return []
        
        origin_lat, origin_lon = InteractiveRTWPlanner.AIRPORT_COORDINATES[airport_code]
        
        nearby = []
        for code, (lat, lon) in InteractiveRTWPlanner.AIRPORT_COORDINATES.items():
            if code == airport_code:
                continue
            
            # Calculate distance
            lat1_rad = math.radians(origin_lat)
            lon1_rad = math.radians(origin_lon)
            lat2_rad = math.radians(lat)
            lon2_rad = math.radians(lon)
            
            dlat = lat2_rad - lat1_rad
            dlon = lon2_rad - lon1_rad
            
            a = math.sin(dlat/2)**2 + math.cos(lat1_rad) * math.cos(lat2_rad) * math.sin(dlon/2)**2
            c = 2 * math.asin(math.sqrt(a))
            R = 3958.8
            distance = R * c
            
            # Only include airports within reasonable distance (e.g., 500 miles)
            if distance <= 500:
                city_name = InteractiveRTWPlanner.get_airport_name(code)
                nearby.append((code, distance, city_name))
        
        # Sort by distance and return top results
        nearby.sort(key=lambda x: x[1])
        return nearby[:max_results]
    
    @staticmethod
    def calculate_distance_miles(origin: str, destination: str) -> float:
        """
        Calculate distance between two airports in miles using Haversine formula
        
        Args:
            origin: Origin airport code
            destination: Destination airport code
            
        Returns:
            Distance in miles, or 0 if coordinates not found
        """
        origin = origin.upper()
        destination = destination.upper()
        
        if origin not in InteractiveRTWPlanner.AIRPORT_COORDINATES:
            return 0.0
        if destination not in InteractiveRTWPlanner.AIRPORT_COORDINATES:
            return 0.0
        
        lat1, lon1 = InteractiveRTWPlanner.AIRPORT_COORDINATES[origin]
        lat2, lon2 = InteractiveRTWPlanner.AIRPORT_COORDINATES[destination]
        
        # Convert to radians
        lat1_rad = math.radians(lat1)
        lon1_rad = math.radians(lon1)
        lat2_rad = math.radians(lat2)
        lon2_rad = math.radians(lon2)
        
        # Haversine formula
        dlat = lat2_rad - lat1_rad
        dlon = lon2_rad - lon1_rad
        
        a = math.sin(dlat/2)**2 + math.cos(lat1_rad) * math.cos(lat2_rad) * math.sin(dlon/2)**2
        c = 2 * math.asin(math.sqrt(a))
        
        # Earth radius in miles
        R = 3958.8
        
        distance = R * c
        
        return distance
    
    def __init__(self, csv_file_path: str):
        """Initialize with CSV data"""
        self.reader = CSVAvailabilityReader(csv_file_path)
        self.segments = []
        self.starting_airports = []
    
    def get_flights_from_airport(self, origin: str, target_date: str, airline: Optional[str] = None, date_range_days: int = 2) -> List[Dict]:
        """
        Get available flights from an origin around a target date
        
        Args:
            origin: Origin airport code
            target_date: Target date in YYYY-MM-DD format
            airline: Optional airline filter
            date_range_days: Number of days on each side of target date (default 2, so ±2 days)
        
        Returns:
            Flights sorted by: exact date first, then by cabin class (Business > Premium Economy > Economy)
        """
        flights = []
        origin = origin.upper().strip()
        
        try:
            target_dt = datetime.strptime(target_date, "%Y-%m-%d")
        except ValueError:
            return []
        
        for row in self.reader.data:
            row_origin = None
            row_dest = None
            row_date = None
            
            # Find origin column
            for col in ['Origin Airport', 'origin airport', 'ORIGIN AIRPORT', 'origin', 'Origin']:
                if col in row:
                    row_origin = str(row[col]).upper().strip()
                    break
            
            # Find destination column
            for col in ['Destination Airport', 'destination airport', 'DESTINATION AIRPORT', 'destination', 'Destination']:
                if col in row:
                    row_dest = str(row[col]).upper().strip()
                    break
            
            # Find date column
            for col in ['Date', 'date', 'DATE']:
                if col in row:
                    row_date = str(row[col]).strip()
                    break
            
            if row_origin != origin or not row_dest:
                continue
            
            # Parse and check date (±date_range_days)
            try:
                row_date_obj = datetime.strptime(row_date.split()[0], "%Y-%m-%d")
                date_diff = abs((target_dt - row_date_obj).days)
                if date_diff > date_range_days:
                    continue
            except:
                continue
            
            # Check for availability (any seats > 0)
            business_seats = 0
            premium_economy_seats = 0
            economy_seats = 0
            business_miles = None
            premium_economy_miles = None
            economy_miles = None
            business_carriers = None
            premium_economy_carriers = None
            economy_carriers = None
            
            # Business class
            business_direct_seats = 0
            if 'Business Seats' in row:
                try:
                    business_seats = int(str(row['Business Seats']).strip() or '0')
                    if 'Business Direct Seats' in row:
                        business_direct_seats = int(str(row['Business Direct Seats']).strip() or '0')
                    if 'Business Miles' in row:
                        business_miles = str(row['Business Miles']).strip() or None
                    if 'Business Carriers' in row:
                        business_carriers = str(row['Business Carriers']).strip() or None
                except:
                    pass
            
            # Premium Economy
            premium_economy_miles_int = 0
            if 'Premium Economy Seats' in row:
                try:
                    premium_economy_seats = int(str(row['Premium Economy Seats']).strip() or '0')
                    if 'Premium Economy Miles' in row:
                        premium_economy_miles = str(row['Premium Economy Miles']).strip() or None
                        try:
                            if premium_economy_miles and premium_economy_miles.strip():
                                premium_economy_miles_int = int(premium_economy_miles)
                        except (ValueError, AttributeError):
                            pass
                    if 'Premium Economy Carriers' in row:
                        premium_economy_carriers = str(row['Premium Economy Carriers']).strip() or None
                except:
                    pass
            
            # Economy
            economy_direct_seats = 0
            if 'Economy Seats' in row:
                try:
                    economy_seats = int(str(row['Economy Seats']).strip() or '0')
                    if 'Economy Direct Seats' in row:
                        economy_direct_seats = int(str(row['Economy Direct Seats']).strip() or '0')
                    if 'Economy Miles' in row:
                        economy_miles = str(row['Economy Miles']).strip() or None
                    if 'Economy Carriers' in row:
                        economy_carriers = str(row['Economy Carriers']).strip() or None
                except:
                    pass
            
            # Apply airline filter if specified
            if airline:
                has_match = False
                for carriers in [business_carriers, premium_economy_carriers, economy_carriers]:
                    if carriers and airline.upper() in carriers.upper():
                        has_match = True
                        break
                if not has_match:
                    continue
            
            # Only include flights with Business miles > 0 OR Economy miles > 0
            business_miles_int = 0
            economy_miles_int = 0
            
            try:
                if business_miles and business_miles.strip():
                    business_miles_int = int(business_miles)
            except (ValueError, AttributeError):
                pass
            
            try:
                if economy_miles and economy_miles.strip():
                    economy_miles_int = int(economy_miles)
            except (ValueError, AttributeError):
                pass
            
            # Determine if flight is direct and number of stops
            # A flight is direct if it has Direct Seats > 0
            # If it has Seats > 0 but Direct Seats = 0, it has stops
            is_direct = False
            num_stops = 0
            
            # Check if any cabin class has direct availability
            if business_direct_seats > 0 or economy_direct_seats > 0:
                is_direct = True
                num_stops = 0
            elif business_seats > 0 or economy_seats > 0:
                # Has seats but not direct - estimate stops from carriers
                # Multiple carriers usually means connections
                carriers_str = business_carriers or economy_carriers or ''
                if carriers_str:
                    # Count commas + 1 to estimate segments, then subtract 1 for stops
                    carrier_list = [c.strip() for c in carriers_str.split(',') if c.strip()]
                    if len(carrier_list) > 1:
                        num_stops = len(carrier_list) - 1
                    else:
                        num_stops = 1  # Assume at least 1 stop if not direct
                else:
                    num_stops = 1  # Unknown, assume 1 stop
            
            # Only show flights with Business miles > 0 OR Economy miles > 0
            # (This includes both direct and non-direct flights)
            if business_miles_int > 0 or economy_miles_int > 0:
                flights.append({
                    'origin': origin,
                    'destination': row_dest,
                    'date': row_date_obj.strftime("%Y-%m-%d"),
                    'date_obj': row_date_obj,
                    'date_diff': date_diff,
                    'business_seats': business_seats,
                    'business_direct_seats': business_direct_seats,
                    'premium_economy_seats': premium_economy_seats,
                    'economy_seats': economy_seats,
                    'economy_direct_seats': economy_direct_seats,
                    'business_miles': business_miles,
                    'business_miles_int': business_miles_int,
                    'premium_economy_miles': premium_economy_miles,
                    'premium_economy_miles_int': premium_economy_miles_int,
                    'economy_miles': economy_miles,
                    'economy_miles_int': economy_miles_int,
                    'business_carriers': business_carriers,
                    'premium_economy_carriers': premium_economy_carriers,
                    'economy_carriers': economy_carriers,
                    'is_direct': is_direct,
                    'num_stops': num_stops,
                    'row': row
                })
        
        # Sort: exact date first, then by cabin class availability:
        # 1. Direct flights first (is_direct = True)
        # 2. Business seats > 0 first
        # 3. Premium Economy seats > 0 second (but no Business)
        # 4. Economy only (no Business/Premium Economy seats) last
        # Within each group, sort by miles (higher first)
        flights.sort(key=lambda x: (
            x['date_diff'],  # Exact date (0) comes first
            -(1 if x['is_direct'] else 0),  # Direct flights first
            -(1 if x['business_seats'] > 0 else 0),  # Business seats > 0 first
            -(1 if x['premium_economy_seats'] > 0 and x['business_seats'] == 0 else 0),  # Premium Economy seats > 0 second (no Business)
            -x['business_miles_int'],  # Then by Business miles (higher first)
            -x.get('premium_economy_miles_int', 0),  # Then Premium Economy miles
            -x['economy_miles_int']  # Then by Economy miles (higher first)
        ))
        
        return flights
    
    def select_flight(self, origin: str, target_date: str, airline: Optional[str] = None) -> Optional[Dict]:
        """Interactively select a flight"""
        date_range = 2  # Start with ±2 days
        
        while True:
            print(f"\n{'='*60}")
            print(f"Selecting flight from {origin}")
            print(f"Target date: {target_date} (±{date_range} days)")
            print(f"{'='*60}\n")
            
            flights = self.get_flights_from_airport(origin, target_date, airline, date_range_days=date_range)
            
            if not flights:
                print(f"❌ No availability found from {origin} around {target_date} (±{date_range} days)")
                if airline:
                    print(f"   (filtered for airline: {airline})")
                print()
                
                # Offer options: expand date range or try nearby airports
                print("Options:")
                print("  1. Expand date range to ±4 days")
                print("  2. Try nearby airports")
                print("  3. Cancel / Go back")
                
                choice = input("\nSelect option (1-3): ").strip()
                
                if choice == '1':
                    if date_range < 4:
                        date_range = 4
                        print(f"\n✓ Expanded date range to ±{date_range} days")
                        continue
                    else:
                        print("\nDate range already at maximum (±4 days)")
                        # Fall through to nearby airports option
                        choice = '2'
                
                if choice == '2':
                    # Get nearby airports
                    nearby = self.get_nearby_airports(origin, max_results=5)
                    if nearby:
                        print(f"\nNearby airports to {origin} ({self.get_airport_name(origin)}):")
                        print()
                        for i, (code, distance, city_name) in enumerate(nearby, 1):
                            print(f"  {i}. {code} ({city_name}) - {distance:.0f} miles away")
                        print(f"  {len(nearby) + 1}. Cancel")
                        
                        airport_choice = input(f"\nSelect nearby airport (1-{len(nearby) + 1}): ").strip()
                        try:
                            airport_idx = int(airport_choice) - 1
                            if 0 <= airport_idx < len(nearby):
                                new_origin = nearby[airport_idx][0]
                                print(f"\n✓ Trying {new_origin} ({nearby[airport_idx][2]})")
                                # Recursively try the nearby airport
                                return self.select_flight(new_origin, target_date, airline)
                            else:
                                return None
                        except (ValueError, IndexError):
                            return None
                    else:
                        print(f"\nNo nearby airports found for {origin}")
                        return None
                
                if choice == '3':
                    return None
            else:
                break
        
        # Group by destination to show unique routes
        routes = {}
        for flight in flights:
            key = (flight['destination'], flight['date'])
            if key not in routes:
                routes[key] = []
            routes[key].append(flight)
        
        # Display flights
        print(f"Found {len(flights)} flight option(s) across {len(routes)} unique route(s):\n")
        
        flight_list = []
        for i, ((dest, date), route_flights) in enumerate(sorted(routes.items()), 1):
            # Get best cabin class available - prioritize Business if it has miles > 0
            best_cabin = None
            best_seats = 0
            best_miles = None
            best_carriers = None
            
            # Use the first flight (already sorted by best cabin class)
            flight = route_flights[0]
            
            # Check Business first (if it has miles > 0)
            if flight['business_miles_int'] > 0:
                best_cabin = 'Business'
                best_seats = flight['business_seats']
                best_miles = flight['business_miles']
                best_carriers = flight['business_carriers']
            # Then Economy (if it has miles > 0)
            elif flight['economy_miles_int'] > 0:
                best_cabin = 'Economy'
                best_seats = flight['economy_seats']
                best_miles = flight['economy_miles']
                best_carriers = flight['economy_carriers']
            # Fallback to Premium Economy if available
            elif flight['premium_economy_seats'] > 0 or flight['premium_economy_miles'] or flight['premium_economy_carriers']:
                best_cabin = 'Premium Economy'
                best_seats = flight['premium_economy_seats']
                best_miles = flight['premium_economy_miles']
                best_carriers = flight['premium_economy_carriers']
            
            # Get airport names
            origin_name = self.get_airport_name(origin)
            dest_name = self.get_airport_name(dest)
            
            date_marker = "★" if date == target_date else " "
            date_str = datetime.strptime(date, "%Y-%m-%d").strftime("%a %b %d")
            
            # Get flight info (direct vs stops)
            flight_info = route_flights[0]
            is_direct = flight_info.get('is_direct', False)
            num_stops = flight_info.get('num_stops', 0)
            
            # Build route display with stops info
            route_display = f"{origin} ({origin_name}) → {dest} ({dest_name})"
            if is_direct:
                route_display += " [Direct]"
            elif num_stops > 0:
                route_display += f" [{num_stops} stop{'s' if num_stops > 1 else ''}]"
            
            print(f"  {i:2d}. {date_marker} {date} ({date_str}) {route_display}")
            if best_cabin:
                seats_str = f"{best_seats} seat(s)" if best_seats > 0 else "Check availability"
                miles_str = f"{best_miles} miles" if best_miles and best_miles != '0' else "N/A"
                carriers_str = best_carriers if best_carriers else "N/A"
                print(f"      {best_cabin}: {seats_str}, {miles_str}, {carriers_str}")
            else:
                print(f"      Availability info not available")
            
            # Store the first flight from this route (they're sorted, so it's the best one)
            flight_list.append(route_flights[0])
        
        print(f"\n  {len(flight_list) + 1:2d}. Cancel / Go back")
        
        while True:
            try:
                choice = input(f"\nSelect flight (1-{len(flight_list) + 1}): ").strip()
                choice_num = int(choice)
                
                if choice_num == len(flight_list) + 1:
                    return None
                elif 1 <= choice_num <= len(flight_list):
                    selected = flight_list[choice_num - 1]
                    print(f"\n✓ Selected: {selected['origin']} → {selected['destination']} on {selected['date']}")
                    return selected
                else:
                    print(f"Please enter a number between 1 and {len(flight_list) + 1}")
            except ValueError:
                print("Please enter a valid number")
            except KeyboardInterrupt:
                print("\n\nCancelled by user")
                return None
    
    def build_trip(self):
        """Interactively build a RTW trip"""
        print("="*60)
        print("Interactive Round-the-World Trip Planner")
        print("oneworld Alliance")
        print("="*60)
        print()
        
        # Step 1: Select starting airports (multiple allowed)
        print("Step 1: Select your starting airport(s)")
        print("Enter airport codes separated by commas (e.g., JFK,EWR or just JFK)")
        print("Common options: JFK, EWR")
        
        while True:
            airports_input = input("\nStarting airport(s): ").strip().upper()
            airports = [a.strip().upper() for a in airports_input.split(',') if a.strip()]
            
            if airports:
                self.starting_airports = airports
                print(f"\n✓ Starting airport(s): {', '.join(self.starting_airports)}")
                break
            else:
                print("Please enter at least one airport code")
        
        # Step 2: Select start date
        print("\nStep 2: Select your departure date")
        print("Enter date in YYYY-MM-DD format (e.g., 2026-03-01)")
        
        while True:
            date_str = input("Departure date: ").strip()
            try:
                start_date = datetime.strptime(date_str, "%Y-%m-%d")
                print(f"\n✓ Departure date: {start_date.strftime('%Y-%m-%d')} ({start_date.strftime('%A, %B %d, %Y')})")
                break
            except ValueError:
                print("Invalid date format. Please use YYYY-MM-DD (e.g., 2026-03-01)")
        
        # Step 3: Build trip segment by segment
        current_airport = None
        current_date = start_date
        segment_num = 1
        
        print("\n" + "="*60)
        print("Building your trip segment by segment")
        print("="*60)
        print("\nYou'll select flights one by one.")
        print("The trip will end when you return to your starting airport(s).")
        print()
        
        # First segment: select from starting airports
        print(f"\n{'='*60}")
        print(f"Segment {segment_num} - First Flight")
        print(f"{'='*60}")
        print(f"Select departure from: {', '.join(self.starting_airports)}")
        
        # Try each starting airport until we find availability
        flight = None
        for start_airport in self.starting_airports:
            flight = self.select_flight(start_airport, current_date.strftime('%Y-%m-%d'))
            if flight:
                current_airport = start_airport
                break
        
        if not flight:
            print("\n❌ No availability found from any starting airport. Exiting.")
            return None
        
        # Calculate distance for first segment
        segment_distance = self.calculate_distance_miles(flight['origin'], flight['destination'])
        
        # Add first segment with flight details
        self.segments.append({
            'segment': segment_num,
            'origin': flight['origin'],
            'destination': flight['destination'],
            'date': flight['date'],
            'business_miles': flight.get('business_miles'),
            'business_miles_int': flight.get('business_miles_int', 0),
            'economy_miles': flight.get('economy_miles'),
            'economy_miles_int': flight.get('economy_miles_int', 0),
            'business_carriers': flight.get('business_carriers'),
            'economy_carriers': flight.get('economy_carriers'),
            'cabin_class': 'Business' if flight.get('business_miles_int', 0) > 0 else 'Economy' if flight.get('economy_miles_int', 0) > 0 else None,
            'distance_miles': segment_distance
        })
        
        # Show summary after first segment
        self.show_trip_summary()
        
        current_airport = flight['destination']
        current_date = datetime.strptime(flight['date'], "%Y-%m-%d")
        segment_num += 1
        
        # Continue building trip
        while True:
            print(f"\n{'='*60}")
            print(f"Segment {segment_num}")
            print(f"{'='*60}")
            print(f"Current location: {current_airport}")
            print(f"Current date: {current_date.strftime('%Y-%m-%d')} ({current_date.strftime('%A, %B %d, %Y')})")
            
            # Check if we're back at starting airport
            if current_airport.upper() in [a.upper() for a in self.starting_airports]:
                print(f"\n✓ You've returned to your starting airport ({current_airport})!")
                print("Trip complete!")
                break
            
            # Ask how many days until next flight
            days_advance = input(f"\nHow many days until next flight? (default 3, or 's' for summary): ").strip()
            
            # Allow viewing summary
            if days_advance.lower() == 's':
                self.show_trip_summary()
                days_advance = input(f"\nHow many days until next flight? (default 3): ").strip()
            
            try:
                days = int(days_advance) if days_advance else 3
                next_date = current_date + timedelta(days=days)
            except ValueError:
                next_date = current_date + timedelta(days=3)
            
            # Select next flight (same filtering applies - Business/Economy miles > 0)
            flight = self.select_flight(current_airport, next_date.strftime('%Y-%m-%d'))
            
            if not flight:
                # User cancelled - ask if they want to go back or end trip
                action = input("\nGo back to previous segment? (y/n): ").strip().lower()
                if action == 'y' and self.segments:
                    # Remove last segment
                    last_seg = self.segments.pop()
                    current_airport = last_seg['origin']
                    current_date = datetime.strptime(last_seg['date'], "%Y-%m-%d")
                    segment_num -= 1
                    print(f"\n✓ Went back to {current_airport}")
                    continue
                else:
                    print("\nTrip building cancelled.")
                    return None
            
            # Calculate distance for this segment
            segment_distance = self.calculate_distance_miles(flight['origin'], flight['destination'])
            
            # Add segment with flight details
            self.segments.append({
                'segment': segment_num,
                'origin': flight['origin'],
                'destination': flight['destination'],
                'date': flight['date'],
                'business_miles': flight.get('business_miles'),
                'business_miles_int': flight.get('business_miles_int', 0),
                'economy_miles': flight.get('economy_miles'),
                'economy_miles_int': flight.get('economy_miles_int', 0),
                'business_carriers': flight.get('business_carriers'),
                'economy_carriers': flight.get('economy_carriers'),
                'cabin_class': 'Business' if flight.get('business_miles_int', 0) > 0 else 'Economy' if flight.get('economy_miles_int', 0) > 0 else None,
                'distance_miles': segment_distance
            })
            
            # Show summary after each segment
            self.show_trip_summary()
            
            # Move to next airport and date
            current_airport = flight['destination']
            current_date = datetime.strptime(flight['date'], "%Y-%m-%d")
            segment_num += 1
            
            # Safety check for too many segments
            if segment_num > 16:
                print("\n⚠️  Maximum 16 segments reached. Ending trip.")
                break
        
        return self.segments
    
    def show_trip_summary(self):
        """Show a summary of the current trip"""
        if not self.segments:
            return
        
        print("\n" + "="*60)
        print("TRIP SUMMARY")
        print("="*60)
        print()
        
        total_miles = 0
        total_business_miles = 0
        total_economy_miles = 0
        total_distance_miles = 0
        total_distance_miles = 0
        cumulative_distance = 0
        
        for i, seg in enumerate(self.segments):
            origin = seg['origin']
            dest = seg['destination']
            date = seg['date']
            date_obj = datetime.strptime(date, "%Y-%m-%d")
            
            # Calculate days in country (time between arrival and next departure)
            days_in_country = None
            if i < len(self.segments) - 1:
                next_date = datetime.strptime(self.segments[i + 1]['date'], "%Y-%m-%d")
                days_in_country = (next_date - date_obj).days
            
            # Get cabin class and miles
            cabin = seg.get('cabin_class', 'N/A')
            biz_miles = seg.get('business_miles_int', 0)
            econ_miles = seg.get('economy_miles_int', 0)
            miles = biz_miles if biz_miles > 0 else econ_miles
            distance = seg.get('distance_miles', 0)
            
            if biz_miles > 0:
                total_business_miles += biz_miles
            if econ_miles > 0:
                total_economy_miles += econ_miles
            total_miles += miles
            total_distance_miles += distance
            
            # Get carriers
            carriers = seg.get('business_carriers') if biz_miles > 0 else seg.get('economy_carriers', 'N/A')
            
            # Display segment
            print(f"Segment {seg['segment']}: {origin} → {dest}")
            print(f"  Date: {date} ({date_obj.strftime('%a %b %d, %Y')})")
            print(f"  Class: {cabin}")
            print(f"  Award Miles: {miles:,}" if miles > 0 else "  Award Miles: N/A")
            print(f"  Distance: {distance:,.0f} miles" if distance > 0 else "  Distance: N/A")
            print(f"  Carriers: {carriers}")
            if days_in_country is not None:
                print(f"  Days in {dest}: {days_in_country} day(s)")
            print()
        
        # Summary totals
        print("-"*60)
        print(f"Total Segments: {len(self.segments)}")
        print(f"Total Award Miles: {total_miles:,}" if total_miles > 0 else "Total Award Miles: N/A")
        if total_business_miles > 0:
            print(f"  Business: {total_business_miles:,} miles")
        if total_economy_miles > 0:
            print(f"  Economy: {total_economy_miles:,} miles")
        print()
        print(f"Total Distance Flown: {total_distance_miles:,.0f} miles")
        remaining_miles = RTW_MAX_MILES - total_distance_miles
        if remaining_miles >= 0:
            print(f"Remaining under 35K limit: {remaining_miles:,.0f} miles")
        else:
            print(f"⚠️  EXCEEDS 35K LIMIT by {abs(remaining_miles):,.0f} miles!")
        if total_distance_miles > RTW_MAX_MILES * 0.9:
            print(f"⚠️  WARNING: Approaching 35K mile limit ({total_distance_miles/RTW_MAX_MILES*100:.1f}%)")
        
        # Calculate total trip duration
        if len(self.segments) > 1:
            start_date = datetime.strptime(self.segments[0]['date'], "%Y-%m-%d")
            end_date = datetime.strptime(self.segments[-1]['date'], "%Y-%m-%d")
            total_days = (end_date - start_date).days
            print(f"Total Trip Duration: {total_days} days")
        
        print("="*60)
        print()
    
    def display_trip(self, segments: List[Dict]):
        """Display the complete trip"""
        if not segments:
            print("No trip to display")
            return
        
        print("\n" + "="*60)
        print("YOUR ROUND-THE-WORLD TRIP")
        print("="*60)
        print()
        
        for seg in segments:
            origin_continent = OneWorldRTWValidator.get_continent(seg['origin'])
            dest_continent = OneWorldRTWValidator.get_continent(seg['destination'])
            
            origin_str = seg['origin']
            if origin_continent:
                origin_str += f" ({origin_continent})"
            
            dest_str = seg['destination']
            if dest_continent:
                dest_str += f" ({dest_continent})"
            
            date_obj = datetime.strptime(seg['date'], "%Y-%m-%d")
            print(f"Segment {seg['segment']}: {origin_str} → {dest_str}")
            print(f"  Date: {seg['date']} ({date_obj.strftime('%A, %B %d, %Y')})")
            print()
        
        # Validate trip
        print("="*60)
        print("TRIP VALIDATION")
        print("="*60)
        print()
        
        validation = OneWorldRTWValidator.validate_rtw_trip(segments)
        
        if validation['valid']:
            print("✓ Trip is VALID for oneworld RTW ticket!")
        else:
            print("❌ Trip has validation errors:")
            for error in validation['errors']:
                print(f"  • {error}")
        
        if validation['warnings']:
            print("\n⚠️  Warnings:")
            for warning in validation['warnings']:
                print(f"  • {warning}")
        
        print(f"\nTrip Summary:")
        print(f"  • Total segments: {validation['num_segments']}")
        print(f"  • Continents visited: {validation['num_continents']} {validation['continents_visited']}")
        print(f"  • Atlantic crossed: {'✓' if validation['atlantic_crossed'] else '✗'}")
        print(f"  • Pacific crossed: {'✓' if validation['pacific_crossed'] else '✗'}")
        print(f"  • Total trip duration: {validation['total_days']} days")
        
        if validation['stopovers']:
            print(f"  • Stopovers (>24h): {len(validation['stopovers'])}")
            for stop in validation['stopovers']:
                print(f"    - {stop['airport']}: {stop['days']:.1f} days")
        
        print()


def main():
    """Main function"""
    # Find CSV file
    if len(sys.argv) > 1:
        csv_file = sys.argv[1]
    else:
        csv_files = [f for f in os.listdir('.') if f.endswith('.csv')]
        if csv_files:
            if len(csv_files) == 1:
                csv_file = csv_files[0]
            else:
                print("Found multiple CSV files:")
                for i, f in enumerate(csv_files, 1):
                    print(f"  {i}. {f}")
                choice = input(f"\nSelect file (1-{len(csv_files)}): ").strip()
                csv_file = csv_files[int(choice) - 1]
        else:
            csv_file = input("Enter path to CSV file: ").strip()
    
    if not os.path.exists(csv_file):
        print(f"❌ Error: CSV file not found: {csv_file}")
        sys.exit(1)
    
    try:
        planner = InteractiveRTWPlanner(csv_file)
        segments = planner.build_trip()
        
        if segments:
            planner.display_trip(segments)
            
            # Save option
            save = input("\nSave this trip? (y/n): ").strip().lower()
            if save == 'y':
                import json
                filename = f"rtw_trip_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
                with open(filename, 'w') as f:
                    json.dump({
                        'segments': segments,
                        'validation': OneWorldRTWValidator.validate_rtw_trip(segments)
                    }, f, indent=2)
                print(f"✓ Trip saved to {filename}")
        
    except KeyboardInterrupt:
        print("\n\nCancelled by user")
        sys.exit(0)
    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()

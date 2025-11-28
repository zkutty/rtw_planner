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
        'Africa': ['JNB', 'CPT', 'CAI', 'ADD', 'NBO', 'DAR', 'CMN']
    }
    
    # Ocean crossings
    ATLANTIC_CROSSING = {
        'from': ['JFK', 'EWR', 'BOS', 'MIA', 'YYZ', 'YUL'],
        'to': ['LHR', 'LGW', 'CDG', 'FRA', 'AMS', 'MAD', 'BCN', 'LIS', 'DUB', 'CPH', 'HEL', 'ARN', 'OSL', 'VIE', 'MUC', 'ZRH', 'FCO', 'MXP', 'ATH']
    }
    
    PACIFIC_CROSSING = {
        # Pacific crossings: Oceania/Asia <-> Americas
        # Only include airports that are actually on Pacific routes
        'from': ['LAX', 'SFO', 'SEA', 'YVR',  # West Coast North America
                 'SYD', 'MEL', 'BNE', 'PER', 'AKL', 'WLG',  # Oceania
                 'HKG', 'NRT', 'HND', 'ICN', 'PEK', 'PVG', 'SIN', 'BKK',  # Asia
                 'SCL', 'LIM'],  # West Coast South America (Pacific side)
        'to': ['SYD', 'MEL', 'BNE', 'PER', 'AKL', 'WLG',  # Oceania
               'HKG', 'NRT', 'HND', 'ICN', 'PEK', 'PVG', 'SIN', 'BKK',  # Asia
               'LAX', 'SFO', 'SEA', 'YVR',  # West Coast North America
               'SCL', 'LIM']  # West Coast South America (Pacific side)
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
    def get_zone(airport: str) -> Optional[str]:
        """
        Get the geographic zone for an airport code.
        Zones are used to determine ocean crossings:
        - Zone 1 (Americas): North America + South America
        - Zone 2 (Europe/Africa): Europe + Africa
        - Zone 3 (Asia/Oceania): Asia + Oceania
        
        Ocean crossings only count when moving between zones:
        - Atlantic: Zone 1 ↔ Zone 2
        - Pacific: Zone 1 ↔ Zone 3
        """
        continent = OneWorldRTWValidator.get_continent(airport)
        if not continent:
            return None
        
        if continent in ['North America', 'South America']:
            return 'Americas'
        elif continent in ['Europe', 'Africa']:
            return 'Europe/Africa'
        elif continent in ['Asia', 'Oceania']:
            return 'Asia/Oceania'
        
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
            
            # Check Atlantic crossing using zone-based logic
            # Atlantic crossing: Zone 1 (Americas) ↔ Zone 2 (Europe/Africa)
            origin_zone = OneWorldRTWValidator.get_zone(origin_airport)
            dest_zone = OneWorldRTWValidator.get_zone(dest_airport)
            
            if origin_zone and dest_zone:
                # Atlantic crossing: Americas ↔ Europe/Africa
                if ((origin_zone == 'Americas' and dest_zone == 'Europe/Africa') or
                    (origin_zone == 'Europe/Africa' and dest_zone == 'Americas')):
                    atlantic_crossed = True
            
            # Check Pacific crossing using zone-based logic
            # Pacific crossing: Zone 1 (Americas) ↔ Zone 3 (Asia/Oceania)
            if origin_zone and dest_zone:
                # Pacific crossing: Americas ↔ Asia/Oceania
                if ((origin_zone == 'Americas' and dest_zone == 'Asia/Oceania') or
                    (origin_zone == 'Asia/Oceania' and dest_zone == 'Americas')):
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
            
            # Check Atlantic crossing using zone-based logic
            # Atlantic crossing: Zone 1 (Americas) ↔ Zone 2 (Europe/Africa)
            origin_zone = OneWorldRTWValidator.get_zone(origin_airport)
            dest_zone = OneWorldRTWValidator.get_zone(dest_airport)
            
            is_atlantic_crossing = False
            if origin_zone and dest_zone:
                # Atlantic crossing: Americas ↔ Europe/Africa
                if ((origin_zone == 'Americas' and dest_zone == 'Europe/Africa') or
                    (origin_zone == 'Europe/Africa' and dest_zone == 'Americas')):
                    is_atlantic_crossing = True
            
            if is_atlantic_crossing:
                atlantic_crossings += 1
            
            # Check Pacific crossing using zone-based logic
            # Pacific crossing: Zone 1 (Americas) ↔ Zone 3 (Asia/Oceania)
            is_pacific_crossing = False
            if origin_zone and dest_zone:
                # Pacific crossing: Americas ↔ Asia/Oceania
                if ((origin_zone == 'Americas' and dest_zone == 'Asia/Oceania') or
                    (origin_zone == 'Asia/Oceania' and dest_zone == 'Americas')):
                    is_pacific_crossing = True
            
            if is_pacific_crossing:
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
        'TYS': (35.8110, -83.9940), 'SMF': (38.6954, -121.5908),

        # North America
        'ABE': (40.65236, -75.44041),
        'ABI': (32.41133, -99.68189),
        'ABQ': (35.03893, -106.60826),
        'ACA': (16.7571, -99.754),
        'ACT': (31.61219, -97.23031),
        'ACY': (39.45758, -74.57717),
        'ADK': (51.88358, -176.64248),
        'ADQ': (57.74979, -152.49394),
        'AEP': (-34.5592, -58.4156),
        'AEX': (31.32737, -92.54856),
        'AGS': (33.36994, -81.9645),
        'AGU': (21.7056, -102.318),
        'AKN': (58.67649, -156.64869),
        'ALB': (42.74912, -73.80198),
        'ANC': (61.17408, -149.99814),
        'ANU': (17.1367, -61.7927),
        'APW': (-13.83, -172.008),
        'ART': (43.99183, -76.01942),
        'ASE': (39.22189, -106.86822),
        'ASU': (-25.24, -57.52),
        'ATW': (44.25809, -88.51907),
        'AUA': (12.5014, -70.0152),
        'AUS': (30.19453, -97.66988),
        'AVL': (35.43611, -82.54205),
        'AVP': (41.33847, -75.72339),
        'AXA': (18.2048, -63.0551),
        'BAQ': (10.8896, -74.7808),
        'BBA': (-45.9161, -71.6895),
        'BDA': (32.364, -64.6787),
        'BDL': (41.93903, -72.68432),
        'BET': (60.77856, -161.83717),
        'BFL': (35.43386, -119.05767),
        'BGI': (13.0746, -59.4925),
        'BGR': (44.80744, -68.82814),
        'BHM': (33.56389, -86.75231),
        'BIL': (45.80785, -108.54354),
        'BIS': (46.77273, -100.74574),
        'BJX': (20.9935, -101.481),
        'BLI': (48.79269, -122.53753),
        'BMI': (40.47711, -88.91592),
        'BNA': (36.12447, -86.67818),
        'BOI': (43.56436, -116.22286),
        'BON': (12.131, -68.2685),
        'BPT': (30.0, -94.0),
        'BRC': (-41.1512, -71.1575),
        'BRO': (25.90614, -97.426),
        'BTR': (30.53292, -91.14989),
        'BTV': (44.5, -73.2),
        'BUF': (42.94043, -78.73057),
        'BUR': (34.20069, -118.35867),
        'BWI': (39.17573, -76.66899),
        'BZE': (17.5391, -88.3082),
        'BZN': (45.77724, -111.15026),
        'CAE': (33.93884, -81.11954),
        'CHA': (35.03519, -85.20356),
        'CHO': (38.13964, -78.45234),
        'CHS': (32.89864, -80.04053),
        'CID': (41.9, -91.7),
        'CLD': (33.12825, -117.28008),
        'CLE': (41.40941, -81.85469),
        'CLL': (30.58804, -96.36254),
        'CLO': (3.54322, -76.3816),
        'CMH': (39.99695, -82.89216),
        'CMI': (40.03856, -88.27654),
        'COR': (-31.3236, -64.208),
        'COS': (38.80582, -104.70078),
        'CRP': (27.77219, -97.50242),
        'CRW': (38.37601, -81.59289),
        'CTG': (10.4424, -75.513),
        'CUR': (12.1889, -68.9598),
        'CUZ': (-13.5357, -71.9388),
        'CVG': (39.04884, -84.66782),
        'CWA': (44.77762, -89.66678),
        'CZM': (20.5224, -86.9256),
        'DAB': (29.17991, -81.05804),
        'DAY': (39.90225, -84.21941),
        'DCA': (38.85144, -77.03772),
        'DGO': (24.1242, -104.528),
        'DLG': (59.04467, -158.5055),
        'DOM': (15.547, -61.3),
        'DRO': (37.15153, -107.75378),
        'DSM': (41.5, -93.7),
        'DTW': (42.21244, -83.35339),
        'EGE': (39.64275, -106.91594),
        'EIS': (18.4448, -64.543),
        'ELH': (25.4749, -76.6835),
        'ELP': (31.80733, -106.37636),
        'ERI': (42.08308, -80.17394),
        'EUG': (44.12458, -123.21197),
        'EVV': (38.04081, -87.5285),
        'EYW': (24.55612, -81.75996),
        'FAI': (64.81536, -147.85667),
        'FAR': (46.92064, -96.81575),
        'FAT': (36.77656, -119.71883),
        'FAY': (34.99121, -78.88027),
        'FCA': (48.3105, -114.256),
        'FDF': (14.591, -61.0032),
        'FLG': (35.14032, -111.66924),
        'FLL': (26.07167, -80.14969),
        'FSD': (43.58202, -96.74192),
        'FSM': (35.3, -94.4),
        'FWA': (40.97847, -85.19517),
        'GCK': (37.92753, -100.72442),
        'GCM': (19.2928, -81.3577),
        'GDL': (20.5218, -103.311),
        'GEG': (47.61903, -117.53522),
        'GEO': (6.49855, -58.2541),
        'GGG': (32.384, -94.7115),
        'GGT': (23.5626, -75.878),
        'GHB': (25.2847, -76.331),
        'GJT': (39.12242, -108.52675),
        'GND': (12.0042, -61.7862),
        'GNV': (29.69006, -82.27178),
        'GPT': (30.40727, -89.0701),
        'GRB': (44.48463, -88.12971),
        'GRK': (31.1, -97.8),
        'GRR': (42.88083, -85.52281),
        'GSO': (36.10133, -79.94112),
        'GSP': (34.89567, -82.21886),
        'GTF': (47.4823, -111.37028),
        'GUA': (14.5833, -90.5275),
        'GUC': (38.53433, -106.93175),
        'GYE': (-2.15742, -79.8836),
        'HDN': (40.48119, -107.21767),
        'HHH': (32.22449, -80.6974),
        'HLN': (46.60672, -111.98328),
        'HMO': (29.0959, -111.048),
        'HNL': (21.31782, -157.92023),
        'HOU': (29.6458, -95.27723),
        'HPN': (41.06695, -73.70757),
        'HRL': (26.22711, -97.65514),
        'HSV': (34.6372, -86.77505),
        'HUX': (15.7753, -96.2626),
        'IAD': (38.9, -77.5),
        'ICT': (37.64995, -97.43304),
        'ILM': (34.27114, -77.90289),
        'IND': (39.71731, -86.29464),
        'JAC': (43.60733, -110.73775),
        'JAN': (32.31117, -90.07589),
        'JAX': (30.49405, -81.68785),
        'JNU': (58.35471, -134.57847),
        'KIN': (17.9357, -76.7875),
        'KOA': (19.7, -156.0),
        'KTN': (55.35408, -131.71122),
        'LAN': (42.77864, -84.58619),
        'LAP': (24.0727, -110.362),
        'LAW': (34.56771, -98.41664),
        'LBB': (33.66367, -101.82056),
        'LCH': (30.12608, -93.22342),
        'LEX': (38.03675, -84.60864),
        'LFT': (30.20503, -91.98775),
        'LIH': (21.97598, -159.33896),
        'LIR': (10.5933, -85.5444),
        'LIT': (34.72944, -92.22478),
        'LRD': (27.54419, -99.46158),
        'LRM': (18.4507, -68.9118),
        'LTO': (25.9892, -111.348),
        'LYH': (37.32539, -79.20122),
        'MAF': (31.94253, -102.20192),
        'MBJ': (18.5037, -77.9134),
        'MCI': (39.29761, -94.71389),
        'MCO': (28.42939, -81.309),
        'MDE': (6.16454, -75.4231),
        'MDT': (40.19319, -76.76262),
        'MDZ': (-32.8317, -68.7929),
        'MEM': (35.04241, -89.97668),
        'MFE': (26.2, -98.2),
        'MFR': (42.37496, -122.87329),
        'MGA': (12.1415, -86.1682),
        'MGM': (32.30064, -86.39397),
        'MHH': (26.5114, -77.0835),
        'MHK': (39.14122, -96.67181),
        'MHT': (42.93281, -71.43575),
        'MID': (20.937, -89.6577),
        'MKE': (42.94693, -87.89706),
        'MLB': (28.10275, -80.64525),
        'MLM': (19.8499, -101.025),
        'MLU': (32.5, -92.0),
        'MOB': (30.69142, -88.24283),
        'MQT': (46.3, -87.4),
        'MRY': (36.58695, -121.84278),
        'MSN': (43.13988, -89.3375),
        'MSO': (46.91631, -114.09056),
        'MSP': (44.88197, -93.22178),
        'MSY': (29.99328, -90.25903),
        'MTJ': (38.50981, -107.89425),
        'MTY': (25.7785, -100.107),
        'MYR': (33.67974, -78.92832),
        'NAS': (25.039, -77.4662),
        'OAK': (37.72125, -122.22114),
        'OAX': (16.9999, -96.7266),
        'OGG': (20.89865, -156.43046),
        'OKC': (35.39307, -97.60076),
        'OMA': (41.30317, -95.89406),
        'OME': (64.51256, -165.44439),
        'ONT': (34.05601, -117.60119),
        'ORF': (36.8946, -76.20123),
        'ORH': (42.26714, -71.87561),
        'OTZ': (66.88481, -162.59814),
        'PAE': (47.9, -122.3),
        'PBI': (26.68316, -80.09559),
        'PDX': (45.58871, -122.59687),
        'PEI': (4.81267, -75.7395),
        'PGV': (35.63569, -77.38408),
        'PHF': (37.13189, -76.49297),
        'PIT': (40.49142, -80.23269),
        'PLS': (21.7736, -72.2659),
        'PMC': (-41.4389, -73.094),
        'PNS': (30.47342, -87.18661),
        'POA': (-29.9944, -51.1714),
        'POP': (19.7579, -70.57),
        'POS': (10.5954, -61.3372),
        'PSC': (46.26468, -119.11902),
        'PSP': (33.82967, -116.50669),
        'PTP': (16.2653, -61.5318),
        'PTY': (9.07136, -79.3835),
        'PUJ': (18.5674, -68.3634),
        'PVD': (41.72233, -71.42772),
        'PVR': (20.6801, -105.254),
        'PVU': (40.21917, -111.72336),
        'PWM': (43.64564, -70.30862),
        'QRO': (20.6173, -100.186),
        'RAP': (44.04533, -103.05736),
        'RAR': (-21.2027, -159.806),
        'RDD': (40.5, -122.3),
        'RDM': (44.25407, -121.14997),
        'RIC': (37.50518, -77.31974),
        'RNO': (39.49911, -119.76811),
        'ROA': (37.32547, -79.97542),
        'ROC': (43.11914, -77.67187),
        'ROW': (33.29987, -104.5294),
        'RST': (43.90828, -92.50003),
        'RSW': (26.5, -81.8),
        'RTB': (16.3168, -86.523),
        'SAF': (35.6, -106.1),
        'SAL': (13.4409, -89.0557),
        'SAP': (15.4526, -87.9236),
        'SAT': (29.53396, -98.46906),
        'SBA': (34.4, -119.8),
        'SBN': (41.70822, -86.31734),
        'SBP': (35.2, -120.6),
        'SCE': (40.9, -77.8),
        'SDF': (38.17408, -85.73649),
        'SDQ': (18.4297, -69.6689),
        'SGF': (37.24567, -93.38864),
        'SGU': (37.03638, -113.5103),
        'SHV': (32.44652, -93.82604),
        'SIT': (57.04683, -135.36107),
        'SJC': (37.36299, -121.92862),
        'SJD': (23.1518, -109.721),
        'SJO': (9.99386, -84.2088),
        'SJT': (31.35775, -100.4963),
        'SJU': (18.4394, -66.00213),
        'SKB': (17.3112, -62.7187),
        'SLC': (40.78839, -111.97777),
        'SLP': (22.2543, -100.931),
        'SNA': (33.67566, -117.86823),
        'SPS': (33.9888, -98.4919),
        'SRQ': (27.39544, -82.55439),
        'STI': (19.4061, -70.6047),
        'STL': (38.7487, -90.37003),
        'STS': (38.50969, -122.81289),
        'STT': (18.33731, -64.97333),
        'STX': (17.7015, -64.80194),
        'SUN': (43.50378, -114.29556),
        'SVD': (13.16, -61.148667),
        'SXM': (18.041, -63.1089),
        'SYR': (43.11119, -76.10631),
        'TAM': (22.2964, -97.8659),
        'TBU': (-21.2412, -175.14999),
        'TIJ': (32.5411, -116.97),
        'TLH': (30.39675, -84.35087),
        'TPA': (27.97547, -82.53325),
        'TQO': (20.166667, -87.666667),
        'TRC': (25.5683, -103.411),
        'TRI': (36.47521, -82.40742),
        'TUL': (36.19839, -95.88811),
        'TUS': (32.11607, -110.94101),
        'TVC': (44.74158, -85.58187),
        'TXK': (33.5, -94.0),
        'TYR': (32.35355, -95.40298),
        'UIO': (-0.12917, -78.3575),
        'UVF': (13.7332, -60.9526),
        'VER': (19.1459, -96.1873),
        'VPS': (30.48322, -86.52604),
        'VRA': (23.0344, -81.4353),
        'VVI': (-17.6448, -63.1354),
        'XNA': (36.28158, -94.30777),
        'XPL': (14.38233, -87.62117),
        'XSC': (21.5157, -71.5285),
        'YEG': (53.3097, -113.58),
        'YHM': (43.1736, -79.935),
        'YHZ': (44.8808, -63.5086),
        'YKA': (50.7022, -120.444),
        'YLW': (49.9561, -119.378),
        'YMM': (56.6533, -111.222),
        'YQB': (46.7911, -71.3933),
        'YQM': (46.1122, -64.6786),
        'YQR': (50.4319, -104.666),
        'YUM': (32.65657, -114.60599),
        'YWG': (49.91, -97.2399),
        'YXC': (49.6108, -115.782),
        'YXE': (52.1708, -106.7),
        'YXT': (54.4685, -128.576),
        'YXU': (43.0356, -81.1539),
        'YYC': (51.1139, -114.02),
        'YYJ': (48.6469, -123.426),
        'YYT': (47.6186, -52.7519),
        'YZF': (62.4628, -114.44),
        'ZCL': (22.8971, -102.687),
        'ZIH': (17.6016, -101.461),
        'ZLO': (19.1448, -104.559),

        # Europe
        'AAL': (57.09276, 9.84924),
        'ABZ': (57.2019, -2.19778),
        'AGP': (36.6749, -4.49911),
        'AJA': (41.9236, 8.80292),
        'ALC': (38.2822, -0.55816),
        'ALG': (36.691, 3.21541),
        'BEG': (44.8184, 20.3091),
        'BER': (52.36217, 13.50067),
        'BGO': (60.2934, 5.21814),
        'BHD': (54.6181, -5.8725),
        'BHX': (52.4539, -1.74803),
        'BIA': (42.5527, 9.48373),
        'BIO': (43.3011, -2.91061),
        'BIQ': (43.4684, -1.52332),
        'BLL': (55.7403, 9.15178),
        'BLQ': (44.5354, 11.2887),
        'BOD': (44.8283, -0.71556),
        'BRE': (53.0475, 8.78667),
        'BRI': (41.1389, 16.7606),
        'BRS': (51.3827, -2.71909),
        'BRU': (50.9014, 4.48444),
        'BSL': (47.5896, 7.52991),
        'BUD': (47.4369, 19.2556),
        'CGN': (50.8659, 7.14274),
        'CLY': (42.5308, 8.79319),
        'CTA': (37.4668, 15.0664),
        'DBV': (42.5614, 18.2682),
        'DUS': (51.2895, 6.76678),
        'EAS': (43.3565, -1.79061),
        'EDI': (55.95, -3.3725),
        'EGC': (44.8253, 0.51861),
        'ESB': (40.1281, 32.9951),
        'FAO': (37.0144, -7.96591),
        'FLR': (43.81, 11.2051),
        'FSC': (41.5006, 9.09778),
        'GDN': (54.3776, 18.4662),
        'GIB': (36.1512, -5.34966),
        'GLA': (55.8719, -4.43306),
        'GOA': (44.4133, 8.8375),
        'GOT': (57.6628, 12.2798),
        'GVA': (46.2381, 6.10895),
        'GZP': (36.29922, 32.3006),
        'HAJ': (52.4611, 9.68508),
        'HAM': (53.6304, 9.98823),
        'IBZ': (38.8729, 1.37312),
        'INN': (47.2602, 11.344),
        'INV': (57.5425, -4.0475),
        'IVL': (68.6073, 27.4053),
        'JER': (49.2079, -2.19551),
        'JMK': (37.4351, 25.3481),
        'KRK': (50.0777, 19.7848),
        'KRS': (58.2042, 8.08537),
        'LBA': (53.8659, -1.66057),
        'LCY': (51.5053, 0.05528),
        'LIN': (45.4451, 9.27674),
        'LJU': (46.2237, 14.4576),
        'LTN': (51.8747, -0.36833),
        'LUX': (49.6266, 6.21152),
        'LYS': (45.7264, 5.09083),
        'MAH': (39.8626, 4.21865),
        'MAN': (53.3537, -2.27495),
        'MLA': (35.8575, 14.4775),
        'MPL': (43.5762, 3.96301),
        'MRS': (43.43927, 5.22142),
        'NAP': (40.886, 14.2908),
        'NCE': (43.6584, 7.21587),
        'NCL': (55.0375, -1.69167),
        'NTE': (47.1532, -1.61073),
        'NUE': (49.4987, 11.0669),
        'OPO': (41.2481, -8.68139),
        'ORK': (51.8413, -8.49111),
        'ORN': (35.6239, -0.62118),
        'OTP': (44.5722, 26.1022),
        'OUL': (64.9301, 25.3546),
        'PMI': (39.5517, 2.73881),
        'PMO': (38.176, 13.091),
        'POZ': (52.421, 16.8263),
        'PRG': (50.1008, 14.26),
        'PSA': (43.6839, 10.3927),
        'RHO': (36.4054, 28.0862),
        'RIX': (56.9236, 23.9711),
        'RNS': (48.0695, -1.73479),
        'RVN': (66.5648, 25.8304),
        'SAW': (40.8986, 29.3092),
        'SCQ': (42.8963, -8.41514),
        'SKG': (40.5197, 22.9709),
        'SOF': (42.69669, 23.41144),
        'SOU': (50.9503, -1.3568),
        'SPU': (43.5389, 16.298),
        'STN': (51.885, 0.235),
        'STR': (48.6899, 9.22196),
        'SVG': (58.8767, 5.63778),
        'SVQ': (37.418, -5.89311),
        'SXB': (48.5383, 7.62823),
        'SZG': (47.7933, 13.0043),
        'TGD': (42.3594, 19.2519),
        'TIA': (41.4147, 19.7206),
        'TIV': (42.4047, 18.7233),
        'TLL': (59.4133, 24.8328),
        'TLS': (43.6291, 1.36382),
        'TNG': (35.7269, -5.91689),
        'TOS': (69.6833, 18.9189),
        'TRD': (63.4578, 10.924),
        'TRN': (45.2008, 7.64963),
        'TUN': (36.851, 10.2272),
        'VCE': (45.5053, 12.3519),
        'VGO': (42.2318, -8.62677),
        'VLC': (39.4893, -0.48162),
        'VNO': (54.6341, 25.2858),
        'VRN': (45.3957, 10.8885),
        'WAW': (52.1657, 20.9671),
        'WRO': (51.1027, 16.8858),
        'XRY': (36.7446, -6.06011),
        'ZAG': (45.7429, 16.0688),

        # Asia
        'AKJ': (43.6708, 142.44701),
        'ALA': (43.3521, 77.0405),
        'AMD': (23.0772, 72.6347),
        'AOJ': (40.7347, 140.69099),
        'ATQ': (31.7096, 74.7973),
        'AXT': (39.6156, 140.21899),
        'BKI': (5.93721, 116.051),
        'BLR': (13.1979, 77.7063),
        'BPN': (-1.26827, 116.894),
        'CAN': (23.3924, 113.299),
        'CCJ': (11.1368, 75.9553),
        'CCU': (22.6547, 88.4467),
        'CEB': (10.3075, 123.979),
        'CGK': (-6.12557, 106.656),
        'CGO': (34.5197, 113.841),
        'CKG': (29.7192, 106.642),
        'CMB': (7.18076, 79.8841),
        'CNX': (18.7668, 98.9626),
        'COK': (10.152, 76.4019),
        'CRK': (15.186, 120.56),
        'CTS': (42.7752, 141.692),
        'DAC': (23.84335, 90.39778),
        'DAD': (16.0439, 108.199),
        'DIL': (-8.5464, 125.526),
        'DLC': (38.9657, 121.539),
        'DPS': (-8.74817, 115.167),
        'FOC': (25.9351, 119.663),
        'FUK': (33.5859, 130.451),
        'GAJ': (38.4119, 140.371),
        'GMP': (37.5583, 126.791),
        'GOX': (15.7322, 73.868),
        'GUM': (13.5, 144.8),
        'HAK': (19.9349, 110.459),
        'HAN': (21.2212, 105.807),
        'HGH': (30.2295, 120.434),
        'HIJ': (34.4361, 132.91901),
        'HIR': (-9.428, 160.05499),
        'HKD': (41.77, 140.82201),
        'HKT': (8.1132, 98.3169),
        'HYD': (17.23132, 78.42986),
        'ISB': (33.54908, 72.82565),
        'ISG': (24.3445, 124.187),
        'ITM': (34.7855, 135.438),
        'IXM': (9.83451, 78.0934),
        'IZO': (35.4136, 132.89),
        'KBV': (8.09912, 98.9862),
        'KCZ': (33.5461, 133.66901),
        'KHH': (22.5771, 120.35),
        'KHI': (24.9065, 67.1608),
        'KIJ': (37.9559, 139.121),
        'KIX': (34.4273, 135.244),
        'KKJ': (33.8459, 131.035),
        'KMI': (31.8772, 131.44901),
        'KMJ': (32.8373, 130.855),
        'KMQ': (36.3946, 136.407),
        'KNO': (3.55806, 98.6717),
        'KOJ': (31.8034, 130.71899),
        'KTM': (27.6966, 85.3591),
        'KUH': (43.041, 144.19299),
        'KUM': (30.3856, 130.659),
        'LGK': (6.32973, 99.7287),
        'LHE': (31.5216, 74.4036),
        'MAA': (12.99001, 80.1693),
        'MLE': (4.19167, 73.52917),
        'MMB': (43.8806, 144.164),
        'MMY': (24.7828, 125.295),
        'MNL': (14.5086, 121.02),
        'MSJ': (40.7032, 141.368),
        'MYJ': (33.8272, 132.7),
        'NAG': (21.0922, 79.0472),
        'NGB': (29.8267, 121.462),
        'NGO': (34.8584, 136.80499),
        'NGS': (32.9169, 129.914),
        'NKG': (31.742, 118.862),
        'OBO': (42.7333, 143.217),
        'OIR': (42.0717, 139.433),
        'OIT': (33.4794, 131.737),
        'OKA': (26.1958, 127.646),
        'OKD': (43.1161, 141.38),
        'OKI': (36.1811, 133.325),
        'OKJ': (34.7569, 133.855),
        'PEN': (5.29714, 100.277),
        'PKU': (0.46079, 101.445),
        'PKX': (39.5, 116.4),
        'POM': (-9.44338, 147.22),
        'PUS': (35.1795, 128.938),
        'RGN': (16.9073, 96.1332),
        'RIS': (45.242, 141.186),
        'ROR': (7.4, 134.5),
        'SAI': (13.36917, 104.22306),
        'SDJ': (38.1397, 140.91701),
        'SGN': (10.8188, 106.652),
        'SHA': (31.1979, 121.336),
        'SHB': (43.5775, 144.96001),
        'SUB': (-7.37983, 112.787),
        'SZX': (22.6393, 113.811),
        'TAK': (34.2142, 134.01601),
        'TAO': (36.365, 120.09833),
        'TFU': (30.29, 104.44333),
        'TJH': (35.5128, 134.787),
        'TKS': (34.1328, 134.60699),
        'TNA': (36.8572, 117.216),
        'TRV': (8.48212, 76.9201),
        'TRW': (1.38164, 173.147),
        'TSA': (25.0694, 121.552),
        'TSN': (39.1244, 117.346),
        'UBJ': (33.93, 131.27901),
        'UPG': (-5.06163, 119.554),
        'USM': (9.54779, 100.062),
        'WNZ': (27.9122, 120.852),
        'WUH': (30.7838, 114.208),
        'WUX': (31.4944, 120.429),
        'XIY': (34.4471, 108.752),
        'XMN': (24.544, 118.128),

        # Oceania
        'ABX': (-36.0678, 146.95799),
        'ADL': (-34.945, 138.53101),
        'ASP': (-23.8067, 133.90199),
        'AVV': (-38.0394, 144.46899),
        'AYQ': (-25.1861, 130.976),
        'BDB': (-24.9039, 152.319),
        'BHQ': (-32.0014, 141.472),
        'BME': (-17.9447, 122.232),
        'BNK': (-28.8339, 153.562),
        'BQB': (-33.68842, 115.4016),
        'BWT': (-40.9989, 145.731),
        'BXG': (-36.7394, 144.33),
        'CBR': (-35.3069, 149.19501),
        'CFS': (-30.3206, 153.116),
        'CHC': (-43.4894, 172.532),
        'CNJ': (-20.6686, 140.504),
        'CNS': (-16.8858, 145.755),
        'DPO': (-41.1697, 146.42999),
        'DRW': (-12.4147, 130.877),
        'EMD': (-23.5675, 148.179),
        'HBA': (-42.8361, 147.50999),
        'HID': (-10.5864, 142.28999),
        'HTI': (-20.3581, 148.952),
        'HVB': (-25.3189, 152.88),
        'ISA': (-20.6639, 139.489),
        'KGI': (-30.789444, 121.461667),
        'KTA': (-20.7122, 116.773),
        'LDH': (-31.5383, 159.077),
        'LEA': (-22.2356, 114.089),
        'LST': (-41.5453, 147.214),
        'MCY': (-26.6033, 153.091),
        'MKY': (-21.1717, 149.17999),
        'MQL': (-34.2292, 142.086),
        'NLK': (-29.0416, 167.939),
        'NOU': (-22.0146, 166.213),
        'NPE': (-39.4658, 176.87),
        'NTL': (-32.795, 151.834),
        'OOL': (-28.1644, 153.505),
        'PHE': (-20.3778, 118.626),
        'PPP': (-20.495, 148.552),
        'PQQ': (-31.4358, 152.86301),
        'ROK': (-23.3819, 150.47501),
        'ROT': (-38.1092, 176.317),
        'TMW': (-31.0839, 150.847),
        'TSV': (-19.2525, 146.765),
        'VLI': (-17.6993, 168.32001),
        'WEI': (-12.6786, 141.925),
        'WGA': (-35.1653, 147.466),
        'ZNE': (-23.4178, 119.803),
        'ZQN': (-45.0211, 168.739),

        # South America
        'BSB': (-15.86917, -47.92083),
        'CNF': (-19.62444, -43.97194),
        'CWB': (-25.5285, -49.1758),
        'FLN': (-27.67028, -48.5525),
        'FOR': (-3.77628, -38.5326),
        'PNT': (-51.6715, -72.5284),
        'PUQ': (-53.0026, -70.8546),
        'REC': (-8.12649, -34.9236),
        'SSA': (-12.908624, -38.32288),

        # Africa
        'ABJ': (5.26139, -3.92629),
        'ABV': (9.00679, 7.26317),
        'ACC': (5.60519, -0.16679),
        'ACE': (28.9455, -13.6052),
        'AGA': (30.325, -9.41307),
        'AMM': (31.7226, 35.9932),
        'AQJ': (29.6116, 35.0181),
        'BAH': (26.2708, 50.6336),
        'BEY': (33.8209, 35.4884),
        'BGW': (33.2625, 44.2346),
        'BKO': (12.5335, -7.94994),
        'BZV': (-4.2517, 15.253),
        'CKY': (9.57689, -13.612),
        'COO': (6.35723, 2.38435),
        'DLA': (4.00608, 9.71948),
        'DMM': (26.4712, 49.7979),
        'DSS': (14.67111, -17.06694),
        'DUR': (-29.61444, 31.11972),
        'EBB': (0.04239, 32.4435),
        'FIH': (-4.38575, 15.4446),
        'FNC': (32.6979, -16.7745),
        'HRE': (-17.9318, 31.0928),
        'JED': (21.6796, 39.1565),
        'JRO': (-3.42941, 37.0745),
        'KGL': (-1.96863, 30.1395),
        'KWI': (29.22677, 47.97995),
        'LAD': (-8.85837, 13.2312),
        'LCA': (34.8751, 33.6249),
        'LFW': (6.16561, 1.25451),
        'LOS': (6.57737, 3.32116),
        'LPA': (27.9319, -15.3866),
        'LUN': (-15.3308, 28.4526),
        'MED': (24.5534, 39.7051),
        'NSI': (3.72256, 11.5533),
        'PFO': (34.718, 32.4857),
        'RAK': (31.6069, -8.0363),
        'RBA': (34.0515, -6.75152),
        'RUH': (24.9576, 46.6988),
        'SLL': (17.0387, 54.0913),
        'SSH': (27.9773, 34.395),
        'TFN': (28.4827, -16.3415),
        'TFS': (28.0445, -16.5725),
        'TLV': (32.0114, 34.8867),
        'TNR': (-18.7969, 47.4788),
        'ZNZ': (-6.22202, 39.2249),

        # Middle East
        'BUS': (41.6103, 41.5997),
        'EBL': (36.2376, 43.9632),
        'EVN': (40.1473, 44.3959),
        'MCT': (23.5933, 58.2844),
        'SHJ': (25.3286, 55.5172),
        'TBS': (41.6692, 44.9547),

        # Others
        'BRW': (71.28486, -156.76858),
        'KEF': (63.985, -22.6056),
        'MRU': (-20.4302, 57.6836),
        'RUN': (-20.8871, 55.5103),
        'SEZ': (-4.67434, 55.5218),
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
    
    def get_all_airports(self) -> Set[str]:
        """
        Get all unique airport codes from the CSV data
        
        Returns:
            Set of unique airport codes (both origins and destinations)
        """
        airports = set()
        
        for row in self.reader.data:
            # Find origin column
            for col in ['Origin Airport', 'origin airport', 'ORIGIN AIRPORT', 'origin', 'Origin']:
                if col in row:
                    origin = str(row[col]).upper().strip()
                    if origin:
                        airports.add(origin)
                    break
            
            # Find destination column
            for col in ['Destination Airport', 'destination airport', 'DESTINATION AIRPORT', 'destination', 'Destination']:
                if col in row:
                    dest = str(row[col]).upper().strip()
                    if dest:
                        airports.add(dest)
                    break
        
        return airports
    
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

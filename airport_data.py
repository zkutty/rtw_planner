"""
Airport Data Parser - Uses OpenFlights airports.dat for accurate coordinates and metadata

Data source: https://github.com/jpatokal/openflights/blob/master/data/airports.dat
Format: ID, Name, City, Country, IATA, ICAO, Lat, Lon, Altitude, Timezone, DST, TZ, Type, Source
"""
import csv
import os
from typing import Dict, Optional, Tuple

# Singleton instance
_airport_data: Optional[Dict[str, dict]] = None


def _parse_airports_dat(filepath: str = "airports.dat") -> Dict[str, dict]:
    """
    Parse the OpenFlights airports.dat file
    
    Returns:
        Dictionary mapping IATA code to airport info
    """
    airports = {}
    
    if not os.path.exists(filepath):
        print(f"Warning: {filepath} not found. Using fallback coordinates.")
        return airports
    
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            reader = csv.reader(f)
            for row in reader:
                if len(row) < 8:
                    continue
                
                # Fields: ID, Name, City, Country, IATA, ICAO, Lat, Lon, Altitude, ...
                iata = row[4].strip() if row[4] and row[4] != '\\N' else None
                
                if not iata or len(iata) != 3:
                    continue
                
                try:
                    lat = float(row[6])
                    lon = float(row[7])
                except (ValueError, IndexError):
                    continue
                
                airports[iata] = {
                    'name': row[1].strip() if row[1] else iata,
                    'city': row[2].strip() if row[2] else '',
                    'country': row[3].strip() if row[3] else '',
                    'lat': lat,
                    'lon': lon,
                    'icao': row[5].strip() if row[5] and row[5] != '\\N' else None,
                    'altitude': int(row[8]) if row[8] and row[8] != '\\N' else 0,
                    'timezone': row[11].strip() if len(row) > 11 and row[11] != '\\N' else None,
                }
        
        print(f"✓ Loaded {len(airports)} airports from {filepath}")
    except Exception as e:
        print(f"Error loading airports.dat: {e}")
    
    return airports


def get_airport_data() -> Dict[str, dict]:
    """Get the singleton airport data dictionary"""
    global _airport_data
    if _airport_data is None:
        _airport_data = _parse_airports_dat()
    return _airport_data


def get_airport_info(iata_code: str) -> Optional[dict]:
    """
    Get airport information by IATA code
    
    Args:
        iata_code: 3-letter IATA airport code (e.g., 'JFK')
        
    Returns:
        Airport info dict or None if not found
    """
    data = get_airport_data()
    return data.get(iata_code.upper())


def get_airport_coords(iata_code: str) -> Optional[Tuple[float, float]]:
    """
    Get airport coordinates by IATA code
    
    Args:
        iata_code: 3-letter IATA airport code
        
    Returns:
        Tuple of (latitude, longitude) or None if not found
    """
    info = get_airport_info(iata_code)
    if info:
        return (info['lat'], info['lon'])
    return None


def get_airport_name(iata_code: str) -> str:
    """
    Get formatted airport name with city and country
    
    Args:
        iata_code: 3-letter IATA airport code
        
    Returns:
        Formatted name like "New York (JFK), USA" or just the code if not found
    """
    info = get_airport_info(iata_code)
    if info:
        city = info['city']
        country = info['country']
        if city and country:
            return f"{city}, {country}"
        elif city:
            return city
        elif info['name']:
            return info['name']
    return iata_code


def get_all_airport_codes() -> set:
    """Get all available IATA codes"""
    return set(get_airport_data().keys())


# Pre-load on import for faster access
if os.path.exists("airports.dat"):
    get_airport_data()


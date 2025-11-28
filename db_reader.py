#!/usr/bin/env python3
"""
SQLite-based flight data reader - Memory efficient replacement for CSV reader.
Uses ~10MB RAM instead of ~500MB.
"""
import sqlite3
import os
from datetime import datetime, timedelta
from typing import List, Dict, Optional, Set


class DatabaseReader:
    """Memory-efficient flight data reader using SQLite"""
    
    def __init__(self, db_file: str = 'flights.db'):
        self.db_file = db_file
        if not os.path.exists(db_file):
            raise FileNotFoundError(f"Database not found: {db_file}. Run build_database.py first.")
        
        # Test connection
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute('SELECT COUNT(*) FROM flights')
        count = cursor.fetchone()[0]
        conn.close()
        print(f"Database loaded: {count:,} flights")
    
    def _get_connection(self):
        """Get a new database connection"""
        return sqlite3.connect(self.db_file)
    
    def get_flights_from_origin(self, origin: str, target_date: str, date_range_days: int = 2) -> List[Dict]:
        """Get flights from an origin airport within date range"""
        origin = origin.upper().strip()
        
        try:
            target_dt = datetime.strptime(target_date, "%Y-%m-%d")
        except ValueError:
            return []
        
        # Calculate date range
        start_date = (target_dt - timedelta(days=date_range_days)).strftime("%Y-%m-%d")
        end_date = (target_dt + timedelta(days=date_range_days)).strftime("%Y-%m-%d")
        
        conn = self._get_connection()
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT * FROM flights 
            WHERE origin = ? 
            AND date BETWEEN ? AND ?
            AND (business_miles > 0 OR economy_miles > 0)
            ORDER BY 
                ABS(julianday(date) - julianday(?)),
                CASE WHEN business_miles > 0 THEN 0 ELSE 1 END,
                CASE WHEN premium_economy_miles > 0 THEN 0 ELSE 1 END,
                business_miles DESC,
                economy_miles DESC
        ''', (origin, start_date, end_date, target_date))
        
        rows = cursor.fetchall()
        conn.close()
        
        flights = []
        for row in rows:
            date_diff = abs((datetime.strptime(row['date'], "%Y-%m-%d") - target_dt).days)
            
            # Determine if direct
            is_direct = row['business_direct_seats'] > 0 or row['economy_direct_seats'] > 0
            num_stops = 0
            if not is_direct and (row['business_seats'] > 0 or row['economy_seats'] > 0):
                carriers = row['business_carriers'] or row['economy_carriers'] or ''
                if carriers:
                    num_stops = max(len([c.strip() for c in carriers.split(',') if c.strip()]) - 1, 1)
                else:
                    num_stops = 1
            
            flights.append({
                'origin': row['origin'],
                'destination': row['destination'],
                'date': row['date'],
                'date_diff': date_diff,
                'business_seats': row['business_seats'],
                'business_direct_seats': row['business_direct_seats'],
                'business_miles': str(row['business_miles']) if row['business_miles'] else None,
                'business_miles_int': row['business_miles'] or 0,
                'business_carriers': row['business_carriers'],
                'premium_economy_seats': row['premium_economy_seats'],
                'premium_economy_miles': str(row['premium_economy_miles']) if row['premium_economy_miles'] else None,
                'premium_economy_miles_int': row['premium_economy_miles'] or 0,
                'premium_economy_carriers': row['premium_economy_carriers'],
                'economy_seats': row['economy_seats'],
                'economy_direct_seats': row['economy_direct_seats'],
                'economy_miles': str(row['economy_miles']) if row['economy_miles'] else None,
                'economy_miles_int': row['economy_miles'] or 0,
                'economy_carriers': row['economy_carriers'],
                'is_direct': is_direct,
                'num_stops': num_stops
            })
        
        return flights
    
    def get_flights_to_destination(self, destination: str, target_date: str, date_range_days: int = 2) -> List[Dict]:
        """Get flights to a destination airport within date range"""
        destination = destination.upper().strip()
        
        try:
            target_dt = datetime.strptime(target_date, "%Y-%m-%d")
        except ValueError:
            return []
        
        start_date = (target_dt - timedelta(days=date_range_days)).strftime("%Y-%m-%d")
        end_date = (target_dt + timedelta(days=date_range_days)).strftime("%Y-%m-%d")
        
        conn = self._get_connection()
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT * FROM flights 
            WHERE destination = ? 
            AND date BETWEEN ? AND ?
            AND (business_miles > 0 OR economy_miles > 0)
            ORDER BY 
                ABS(julianday(date) - julianday(?)),
                CASE WHEN business_miles > 0 THEN 0 ELSE 1 END,
                business_miles DESC
        ''', (destination, start_date, end_date, target_date))
        
        rows = cursor.fetchall()
        conn.close()
        
        flights = []
        for row in rows:
            date_diff = abs((datetime.strptime(row['date'], "%Y-%m-%d") - target_dt).days)
            is_direct = row['business_direct_seats'] > 0 or row['economy_direct_seats'] > 0
            num_stops = 0 if is_direct else 1
            
            flights.append({
                'origin': row['origin'],
                'destination': row['destination'],
                'date': row['date'],
                'date_diff': date_diff,
                'business_seats': row['business_seats'],
                'business_miles': str(row['business_miles']) if row['business_miles'] else None,
                'business_miles_int': row['business_miles'] or 0,
                'business_carriers': row['business_carriers'],
                'premium_economy_seats': row['premium_economy_seats'],
                'premium_economy_miles': str(row['premium_economy_miles']) if row['premium_economy_miles'] else None,
                'premium_economy_miles_int': row['premium_economy_miles'] or 0,
                'premium_economy_carriers': row['premium_economy_carriers'],
                'economy_seats': row['economy_seats'],
                'economy_miles': str(row['economy_miles']) if row['economy_miles'] else None,
                'economy_miles_int': row['economy_miles'] or 0,
                'economy_carriers': row['economy_carriers'],
                'is_direct': is_direct,
                'num_stops': num_stops
            })
        
        return flights
    
    def airport_has_flights(self, airport: str, start_date: str) -> bool:
        """Check if airport has any flights from a date onwards"""
        airport = airport.upper().strip()
        
        conn = self._get_connection()
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT 1 FROM flights 
            WHERE origin = ? AND date >= ?
            AND (business_miles > 0 OR economy_miles > 0)
            LIMIT 1
        ''', (airport, start_date))
        
        result = cursor.fetchone() is not None
        conn.close()
        
        return result
    
    def get_all_origins(self) -> Set[str]:
        """Get all unique origin airports"""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute('SELECT DISTINCT origin FROM flights')
        origins = {row[0] for row in cursor.fetchall()}
        conn.close()
        return origins
    
    def get_all_destinations(self) -> Set[str]:
        """Get all unique destination airports"""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute('SELECT DISTINCT destination FROM flights')
        destinations = {row[0] for row in cursor.fetchall()}
        conn.close()
        return destinations
    
    def get_all_airports(self) -> Set[str]:
        """Get all unique airports (origins + destinations)"""
        return self.get_all_origins() | self.get_all_destinations()


#!/usr/bin/env python3
"""
Build SQLite database from CSV file.
Run this during Render build step to convert CSV to efficient SQLite.
"""
import csv
import sqlite3
import os
import sys

def build_database(csv_file: str, db_file: str = 'flights.db'):
    """Convert CSV to SQLite database"""
    print(f"Building database from {csv_file}...")
    
    if not os.path.exists(csv_file):
        print(f"Error: CSV file not found: {csv_file}")
        return False
    
    # Remove existing database
    if os.path.exists(db_file):
        os.remove(db_file)
    
    conn = sqlite3.connect(db_file)
    cursor = conn.cursor()
    
    # Create table
    cursor.execute('''
        CREATE TABLE flights (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            origin TEXT NOT NULL,
            destination TEXT NOT NULL,
            date TEXT NOT NULL,
            business_seats INTEGER DEFAULT 0,
            business_direct_seats INTEGER DEFAULT 0,
            business_miles INTEGER DEFAULT 0,
            business_carriers TEXT,
            premium_economy_seats INTEGER DEFAULT 0,
            premium_economy_miles INTEGER DEFAULT 0,
            premium_economy_carriers TEXT,
            economy_seats INTEGER DEFAULT 0,
            economy_direct_seats INTEGER DEFAULT 0,
            economy_miles INTEGER DEFAULT 0,
            economy_carriers TEXT
        )
    ''')
    
    # Create indexes for fast lookups
    cursor.execute('CREATE INDEX idx_origin ON flights(origin)')
    cursor.execute('CREATE INDEX idx_destination ON flights(destination)')
    cursor.execute('CREATE INDEX idx_date ON flights(date)')
    cursor.execute('CREATE INDEX idx_origin_date ON flights(origin, date)')
    cursor.execute('CREATE INDEX idx_dest_date ON flights(destination, date)')
    
    # Read CSV and insert data
    with open(csv_file, 'r', encoding='utf-8') as f:
        sample = f.read(1024)
        f.seek(0)
        sniffer = csv.Sniffer()
        delimiter = sniffer.sniff(sample).delimiter
        
        reader = csv.DictReader(f, delimiter=delimiter)
        
        inserted = 0
        batch = []
        
        for row in reader:
            # Extract values
            origin = None
            dest = None
            date = None
            
            for col in ['Origin Airport', 'origin airport', 'origin', 'Origin']:
                if col in row and row[col]:
                    origin = str(row[col]).upper().strip()
                    break
            
            for col in ['Destination Airport', 'destination airport', 'destination', 'Destination']:
                if col in row and row[col]:
                    dest = str(row[col]).upper().strip()
                    break
            
            for col in ['Date', 'date', 'DATE']:
                if col in row and row[col]:
                    date = str(row[col]).strip().split()[0]  # Get date part only
                    break
            
            if not origin or not dest or not date:
                continue
            
            # Parse numeric values
            def safe_int(val):
                try:
                    return int(str(val).strip()) if val else 0
                except (ValueError, TypeError):
                    return 0

            def safe_str(val):
                return str(val).strip() if val else None
            
            batch.append((
                origin,
                dest,
                date,
                safe_int(row.get('Business Seats', 0)),
                safe_int(row.get('Business Direct Seats', 0)),
                safe_int(row.get('Business Miles', 0)),
                safe_str(row.get('Business Carriers')),
                safe_int(row.get('Premium Economy Seats', 0)),
                safe_int(row.get('Premium Economy Miles', 0)),
                safe_str(row.get('Premium Economy Carriers')),
                safe_int(row.get('Economy Seats', 0)),
                safe_int(row.get('Economy Direct Seats', 0)),
                safe_int(row.get('Economy Miles', 0)),
                safe_str(row.get('Economy Carriers'))
            ))
            
            # Insert in batches
            if len(batch) >= 10000:
                cursor.executemany('''
                    INSERT INTO flights (
                        origin, destination, date,
                        business_seats, business_direct_seats, business_miles, business_carriers,
                        premium_economy_seats, premium_economy_miles, premium_economy_carriers,
                        economy_seats, economy_direct_seats, economy_miles, economy_carriers
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ''', batch)
                inserted += len(batch)
                batch = []
                print(f"  Inserted {inserted} rows...")
        
        # Insert remaining
        if batch:
            cursor.executemany('''
                INSERT INTO flights (
                    origin, destination, date,
                    business_seats, business_direct_seats, business_miles, business_carriers,
                    premium_economy_seats, premium_economy_miles, premium_economy_carriers,
                    economy_seats, economy_direct_seats, economy_miles, economy_carriers
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', batch)
            inserted += len(batch)
    
    conn.commit()
    
    # Get stats
    cursor.execute('SELECT COUNT(*) FROM flights')
    total = cursor.fetchone()[0]
    
    cursor.execute('SELECT COUNT(DISTINCT origin) FROM flights')
    origins = cursor.fetchone()[0]
    
    cursor.execute('SELECT COUNT(DISTINCT destination) FROM flights')
    destinations = cursor.fetchone()[0]
    
    conn.close()
    
    db_size = os.path.getsize(db_file) / (1024 * 1024)
    print(f"✓ Database built: {db_file}")
    print(f"  Total flights: {total:,}")
    print(f"  Unique origins: {origins}")
    print(f"  Unique destinations: {destinations}")
    print(f"  Database size: {db_size:.1f} MB")
    
    return True


if __name__ == '__main__':
    db_file = os.environ.get('DB_FILE', 'flights.db')
    
    # Check if database already exists - if so, skip building to save build time
    if os.path.exists(db_file):
        db_size = os.path.getsize(db_file) / (1024 * 1024)
        print(f"✓ Database already exists: {db_file} ({db_size:.1f} MB)")
        print("  Skipping database build (using existing database)")
        # Verify database has data
        try:
            import sqlite3
            conn = sqlite3.connect(db_file)
            cursor = conn.cursor()
            cursor.execute('SELECT COUNT(*) FROM flights')
            count = cursor.fetchone()[0]
            conn.close()
            if count > 0:
                print(f"  Database contains {count:,} flights - ready to use!")
                sys.exit(0)
            else:
                print("  Warning: Database exists but is empty, will rebuild...")
        except Exception as e:
            print(f"  Warning: Could not verify database ({e}), will rebuild...")
    
    # Find CSV file
    csv_candidates = [
        os.environ.get('CSV_FILE', ''),
        'flights.csv',
        'seats.aero qantas Export.csv',
        'data.csv'
    ]
    
    csv_file = None
    for candidate in csv_candidates:
        if candidate and os.path.exists(candidate):
            csv_file = candidate
            break
    
    if not csv_file:
        print("⚠️  Warning: No CSV file found!")
        if os.path.exists(db_file):
            print(f"  Using existing database: {db_file}")
            sys.exit(0)
        else:
            print("❌ Error: No CSV file and no existing database found!")
            print("  Cannot proceed without data source.")
            sys.exit(1)
    
    try:
        if build_database(csv_file, db_file):
            print("\n✓ Database ready for deployment!")
        else:
            print("\n❌ Database build failed!")
            if os.path.exists(db_file):
                print(f"  Attempting to use existing database: {db_file}")
                sys.exit(0)
            sys.exit(1)
    except Exception as e:
        print(f"\n❌ Error building database: {e}")
        import traceback
        traceback.print_exc()
        if os.path.exists(db_file):
            print(f"\n⚠️  Warning: Build failed, but existing database found: {db_file}")
            print("  Continuing with existing database...")
            sys.exit(0)
        sys.exit(1)



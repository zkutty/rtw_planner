# Round-the-World Trip Planner

An interactive web application for planning oneworld alliance round-the-world tickets using the Seats.aero API.

## Features

- **Interactive Map Visualization**: See available flights on a world map with route previews
- **Real-time Flight Data**: Uses Seats.aero Partner API for live availability
- **Trip Building**: Click flights to build your itinerary step-by-step
- **RTW Validation**: Automatic validation against oneworld RTW rules
- **Multiple Views**: Map view and table view for flight selection
- **Filtering**: Date range, cabin class, and miles program filtering
- **Offline Mode**: Fallback to SQLite database when API limits are hit

## Quick Start

### Prerequisites

- Python 3.11+
- Seats.aero Pro account with API key ([Get your key](https://seats.aero/settings))

### Installation

1. **Clone the repository**
   ```bash
   git clone <your-repo-url>
   cd rtw_planner
   ```

2. **Install dependencies**
   ```bash
   pip install -r requirements.txt
   ```

3. **Configure API key**
   
   Create a `.env` file:
   ```bash
   SEATS_AERO_API_KEY=your_api_key_here
   ```
   
   Or set environment variables:
   ```bash
   export SEATS_AERO_API_KEY=your_api_key_here
   ```

4. **Run the application**
   ```bash
   python app.py
   ```

5. **Open in browser**
   ```
   http://localhost:5001
   ```

## Project Structure

```
rtw_planner/
├── app.py                 # Main Flask application
├── lib/                   # Core library modules
│   ├── seats_aero_partner_api.py  # Seats.aero API client
│   ├── db_reader.py              # Database reader
│   ├── csv_availability_reader.py # CSV data reader
│   ├── interactive_rtw_planner.py # RTW planning logic
│   ├── airport_data.py            # Airport data utilities
│   └── seats_aero_client.py       # Legacy API client
├── scripts/              # Utility scripts
│   ├── build_database.py         # Build SQLite from CSV
│   ├── plan_rtw_trip.py          # CLI trip planner
│   ├── example_usage.py           # API usage examples
│   └── ...                        # Other utility scripts
├── deployment/           # Deployment configuration
│   ├── render.yaml               # Render.com config
│   ├── render_api_client.py       # Render API client
│   └── manage_render.py           # Deployment management
├── docs/                 # Documentation
│   ├── DEPLOYMENT.md             # Deployment guide
│   └── ...                        # Other docs
├── static/              # Static assets
│   ├── css/
│   └── js/
└── templates/          # HTML templates
    ├── index.html
    └── suggestions.html
```

## Usage

### Web Interface

The web interface provides:
- **Map View**: Visual flight selection on an interactive map
- **Table View**: Tabular flight data with filtering
- **Trip Summary**: Real-time trip validation and distance tracking
- **Flight Filters**: Filter by date, cabin class, continent, etc.

### Command Line Tools

#### Interactive Trip Planner
```bash
python scripts/plan_rtw_trip.py
```

#### Build Database from CSV
```bash
python scripts/build_database.py
```

#### Example API Usage
```bash
python scripts/example_usage.py
```

## Configuration

### Environment Variables

- `SEATS_AERO_API_KEY` - Seats.aero Partner API key (required for API mode)
- `USE_DATABASE` - Set to `true` to use database mode instead of API
- `DB_FILE` - Path to SQLite database file (default: `flights.db`)
- `CSV_FILE` - Path to CSV export file (for database building)
- `FLASK_SECRET_KEY` - Secret key for Flask sessions
- `SITE_PASSWORD` - Optional password protection for the site
- `PORT` - Port to run the server on (default: 5001)

### API Mode vs Database Mode

**API Mode (Default)**
- Uses live data from Seats.aero Partner API
- Requires `SEATS_AERO_API_KEY`
- Up-to-date availability
- Subject to API rate limits (1,000 calls/day for Pro)

**Database Mode**
- Uses local SQLite database built from CSV export
- Set `USE_DATABASE=true`
- Offline-capable
- Data from CSV export (may be outdated)

## oneworld RTW Rules

When planning your trip, keep in mind:

- **Minimum 3 segments, maximum 16 segments**
- **Must cross both Atlantic and Pacific oceans**
- **Only one crossing of each ocean permitted**
- **Fare based on number of continents visited (3-6 continents)**
- **Must return to origin city**
- **Maximum 35,000 miles total**

## Deployment

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for detailed deployment instructions.

Quick deploy to Render.com:
1. Push code to git repository
2. Connect repository to Render
3. Set environment variables in Render dashboard
4. Deploy!

## Development

### Running Locally

```bash
# Development mode
python app.py

# Production mode (with gunicorn)
gunicorn app:app --bind 0.0.0.0:5001 --workers 1 --threads 2
```

### Project Structure

- `lib/` - Core library modules (API clients, validators, data readers)
- `scripts/` - Utility scripts for database building, coordinate updates, etc.
- `deployment/` - Deployment configuration and tools
- `docs/` - Documentation

## API Documentation

- Seats.aero Partner API: https://developers.seats.aero/reference/getting-started-p
- Airport data from [OpenFlights Airport Database](https://github.com/jpatokal/openflights)

## License

This project is for personal use. Seats.aero API usage is subject to their terms of service.

## Support

For issues and questions:
- Check [docs/](docs/) for documentation
- Review deployment logs for deployment issues
- Check Seats.aero API status for API-related problems

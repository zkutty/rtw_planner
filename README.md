# Seats.aero Round-the-World Ticket Planner

This project helps you plan a round-the-world ticket using the Seats.aero API, specifically for oneworld alliance flights through Qantas.

## Setup

1. **Get your API key:**
   - Sign up for a Seats.aero Pro account at https://seats.aero
   - Generate your API key at https://seats.aero/apikey
   - Pro accounts get 1,000 API calls per day

2. **Install dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

3. **Configure your API key:**
   ```bash
   cp .env.example .env
   ```
   Then edit `.env` and add your API key:
   ```
   SEATS_AERO_API_KEY=your_api_key_here
   ```

## Usage

### Basic Usage

```python
from seats_aero_client import SeatsAeroClient, RoundTheWorldPlanner

# Initialize client
client = SeatsAeroClient()

# Create planner
planner = RoundTheWorldPlanner(client)

# Search for RTW availability in March 2026
result = planner.search_rtw_availability(
    start_date="2026-03-01",
    duration_days=30,
    start_city="SYD"
)

print(result)
```

### Run the example script

```bash
python seats_aero_client.py
```

## Features

- **SeatsAeroClient**: Direct API client for seats.aero
  - Search availability for specific routes
  - Bulk availability searches
  - Get trip and route details

- **RoundTheWorldPlanner**: Helper class for RTW planning
  - Plan multi-segment round-the-world trips
  - Filter by oneworld alliance and Qantas
  - Calculate segment dates based on trip duration

## oneworld Round-the-World Rules

When planning your RTW trip, keep in mind:

- **Minimum 3 segments, maximum 16 segments**
- **Must cross both Atlantic and Pacific oceans**
- **Only one crossing of each ocean permitted**
- **Fare based on number of continents visited (3-6 continents)**
- **Must return to origin city**

## API Documentation

For detailed API documentation, visit:
- https://developers.seats.aero/reference/getting-started-p

## Notes

- The API uses cached data by default (Pro users)
- Live search requires a commercial agreement
- API rate limit: 1,000 calls per day for Pro users
- Some endpoints may require specific parameters - check the API docs

## Git Repository

This project is initialized as a git repository. To push to a remote:

### Quick Setup

Run the interactive setup script:
```bash
./setup_remote.sh
```

### Manual Setup

See [PUSH_INSTRUCTIONS.md](PUSH_INSTRUCTIONS.md) for detailed instructions on pushing to GitHub, GitLab, Bitbucket, or a custom remote.

## Customization

You can customize the RTW route by modifying the `plan_rtw_trip` method in `RoundTheWorldPlanner` class. The example uses:
- SYD → HKG → LHR → JFK → LAX → SYD

Adjust the `sample_route` list to match your preferred itinerary.


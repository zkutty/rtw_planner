# Switching to Database Mode (CSV/Offline)

When you hit your daily API call limit, you can switch to using the local database/CSV file instead.

## Current Status

✅ Your `.env` file has been updated with `USE_DATABASE=true`

## How to Use

### Local Development

1. **Restart your Flask server** if it's running:
   ```bash
   # Stop the current server (Ctrl+C)
   # Then restart:
   python3 app.py
   ```

2. The app will now use `flights.db` (your SQLite database) instead of the API.

### Render Deployment

To switch your deployed app on Render:

1. Go to your Render dashboard
2. Select your `rtw-planner` service
3. Go to **Environment** tab
4. Add or update this environment variable:
   - **Key:** `USE_DATABASE`
   - **Value:** `true`
5. Save and redeploy (or just save - Render will auto-redeploy)

## How It Works

- **When `USE_DATABASE=true`**: The app uses `flights.db` (SQLite database)
- **When `USE_DATABASE` is not set or false**: The app uses the Seats.aero API

The database is built from your CSV file (`seats.aero qantas Export.csv`) automatically if `flights.db` doesn't exist.

## Switching Back to API

When you want to use the API again (after your daily limit resets):

1. **Local**: Remove or comment out `USE_DATABASE=true` in your `.env` file
2. **Render**: Remove the `USE_DATABASE` environment variable or set it to `false`

## Notes

- Database mode uses the data from your CSV export, so it won't have the latest availability
- The database will be read-only - no API calls are made
- This helps you continue planning even when you've hit your daily API limit!


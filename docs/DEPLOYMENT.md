# Deployment Guide

This guide covers deploying the RTW Planner application to Render.com.

## Quick Start

1. **Set Environment Variables** in Render Dashboard:
   - `SEATS_AERO_API_KEY` - Your Seats.aero API key (for API mode)
   - `USE_DATABASE` - Set to `true` to use database mode instead of API
   - `FLASK_SECRET_KEY` - Secret key for Flask sessions
   - `SITE_PASSWORD` - (Optional) Password to protect the site
   - `DB_FILE` - (Optional) Database file path (default: `flights.db`)

2. **Deploy**: Push to your git repository and Render will auto-deploy.

## Deployment Modes

### API Mode (Default)
- Uses Seats.aero Partner API for live data
- Requires `SEATS_AERO_API_KEY` environment variable
- No database build needed
- Best for production with API access

### Database Mode
- Uses local SQLite database from CSV export
- Set `USE_DATABASE=true` environment variable
- Database is built from CSV during deployment
- Useful when API rate limits are hit

## Build Process

The build process:
1. Installs Python dependencies from `requirements.txt`
2. If `USE_DATABASE=true`, builds database from CSV file
3. Otherwise, skips database build (uses API)

## Troubleshooting

### Build Failures
- Check Render Dashboard logs for specific errors
- Verify all environment variables are set correctly
- Ensure CSV file exists if using database mode

### Database Build Issues
- Large CSV files (60MB+) may cause timeouts
- Consider pre-building database and committing it
- Or use API mode to skip database build

## Using Deployment Tools

The `deployment/` directory contains tools for managing Render:

```bash
# Check deployment status
python deployment/check_deployment.py

# Manage services via CLI
python deployment/manage_render.py status rtw_planner
python deployment/manage_render.py deploy rtw_planner
python deployment/manage_render.py env rtw_planner
```

See [RENDER_API_USAGE.md](RENDER_API_USAGE.md) for full API client documentation.

## Configuration Files

- `deployment/render.yaml` - Render.com service configuration
- `deployment/Procfile` - Process configuration for gunicorn




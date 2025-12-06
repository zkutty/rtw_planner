# Render API Client Usage

This project includes a Python client for managing your Render services via the Render REST API.

## Setup

The API key is already configured in the scripts. The client uses:
- **API Key**: `rnd_KSfch1qfb5CaigK85v719pOsJhuP`
- **API Base URL**: `https://api.render.com/v1`

## Files

- **`render_api_client.py`** - Main API client class with all methods
- **`manage_render.py`** - CLI script for quick management commands

## Quick Start

### Test Connection

```bash
python3 render_api_client.py
```

This will:
- List all your services
- Show information about your `rtw_planner` service
- Display environment variables
- Show recent deployments

### Using the CLI Script

```bash
# List all services
python3 manage_render.py list

# Get service information
python3 manage_render.py info rtw_planner

# List environment variables
python3 manage_render.py env rtw_planner

# Set an environment variable
python3 manage_render.py set-env rtw_planner USE_DATABASE true

# Delete an environment variable
python3 manage_render.py del-env rtw_planner USE_DATABASE

# Restart service
python3 manage_render.py restart rtw_planner

# Trigger new deployment
python3 manage_render.py deploy rtw_planner

# View recent logs
python3 manage_render.py logs rtw_planner

# Check service status
python3 manage_render.py status rtw_planner
```

## Using the API Client in Python

```python
from render_api_client import RenderAPIClient

# Initialize client
client = RenderAPICLient("rnd_KSfch1qfb5CaigK85v719pOsJhuP")

# List all services
services = client.list_services()

# Find service by name
service = client.find_service_by_name("rtw_planner")

# Get service details
service_info = client.get_service(service['id'])

# List environment variables
env_vars = client.list_env_vars(service['id'])

# Set environment variable
client.set_env_var(service['id'], "USE_DATABASE", "true")

# Update multiple environment variables
client.update_env_vars(service['id'], {
    "USE_DATABASE": "true",
    "SEATS_AERO_API_KEY": "your_key_here"
})

# Trigger deployment
client.trigger_deploy(service['id'])

# Restart service
client.restart_service(service['id'])
```

## Available Methods

### Services
- `list_services()` - List all services
- `get_service(service_id)` - Get service details
- `update_service(service_id, updates)` - Update service
- `restart_service(service_id)` - Restart service
- `suspend_service(service_id)` - Suspend service
- `resume_service(service_id)` - Resume service
- `find_service_by_name(name)` - Find service by name

### Environment Variables
- `list_env_vars(service_id)` - List all env vars
- `get_env_var(service_id, key)` - Get specific env var
- `set_env_var(service_id, key, value)` - Set/update env var
- `delete_env_var(service_id, key)` - Delete env var
- `update_env_vars(service_id, env_vars_dict)` - Update multiple at once

### Deployments
- `list_deploys(service_id)` - List all deploys
- `trigger_deploy(service_id, clear_cache=False)` - Trigger new deploy
- `get_deploy(service_id, deploy_id)` - Get deploy details
- `cancel_deploy(service_id, deploy_id)` - Cancel running deploy
- `rollback_deploy(service_id, deploy_id)` - Rollback to previous deploy

### Logs
- `get_logs(service_id, limit=100)` - Get recent logs

## Your Services

Based on the API connection, you have:

1. **rtw_planner** (srv-d4l339muk2gs7385rjv0)
   - URL: https://rtw-planner.onrender.com
   - Type: web_service

2. **fpl-optimum** (srv-d434bjruibrs73all82g)
   - Type: web_service

## API Reference

Full API documentation: https://api-docs.render.com/reference/introduction

## Security Note

The API key is currently hardcoded in the scripts. For production use, consider:
- Storing the API key in an environment variable
- Using a `.env` file (not committed to git)
- Using a secrets management system

Example:
```python
import os
api_key = os.environ.get("RENDER_API_KEY")
client = RenderAPIClient(api_key)
```


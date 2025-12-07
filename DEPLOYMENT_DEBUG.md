# Deployment Debugging Guide

## Current Status

Your Render service `rtw_planner` has been experiencing deployment failures. All recent deployments show `update_failed` status.

## Viewing Build Logs

Since the Render API doesn't provide detailed build logs, you can view them directly in the Render Dashboard:

**Dashboard URL**: https://dashboard.render.com/web/srv-d4l339muk2gs7385rjv0

1. Go to your service dashboard
2. Click on "Events" or "Deploys" tab
3. Click on a failed deploy to see the build logs
4. Look for error messages in the logs

## Common Deployment Issues & Fixes

### 1. Build Timeout
The CSV file is 61MB and building 350k+ rows can take time. If builds are timing out:
- The build script now checks if database already exists and skips rebuilding
- Consider using an existing database file instead of rebuilding each time

### 2. Memory Issues
Building the database uses memory. If you're hitting memory limits:
- The build process is already optimized with batch inserts
- Consider increasing Render service memory allocation

### 3. Missing Dependencies
All required packages should be in `requirements.txt`. Verify:
```bash
pip install -r requirements.txt
```

### 4. CSV File Not Found
The CSV file is tracked in git. If it's missing during build:
- The build script now gracefully handles missing CSV
- It will use existing database if available

## Recent Changes That Might Affect Deployment

Recent commits added:
- `render_api_client.py` - Utility script (not imported by app)
- `manage_render.py` - CLI tool (not imported by app)
- Table view improvements in JavaScript

These files shouldn't affect deployment, but verify they're not causing issues.

## Manual Deployment Check

You can test the build locally:

```bash
# Test database build
python3 build_database.py

# Test app startup
python3 app.py
```

## Next Steps

1. **Check Render Dashboard** for actual build error messages
2. **Verify all files are committed** to git:
   ```bash
   git status
   ```
3. **Check if CSV file is too large** for git (61MB might cause issues)
4. **Try manual deploy** through Render dashboard to see detailed logs

## Using Render API to Manage Deployments

You can also use the Render API client to trigger deployments and check status:

```bash
# Trigger new deployment
python3 manage_render.py deploy rtw_planner

# Check service status
python3 manage_render.py status rtw_planner

# View environment variables
python3 manage_render.py env rtw_planner
```

## Contact

If deployment continues to fail, check the Render dashboard logs for specific error messages and share them for further debugging.


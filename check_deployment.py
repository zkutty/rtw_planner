#!/usr/bin/env python3
"""
Check Render deployment status and diagnose issues
"""
from render_api_client import RenderAPIClient
import json

API_KEY = "rnd_KSfch1qfb5CaigK85v719pOsJhuP"

def main():
    client = RenderAPIClient(API_KEY)
    
    # Find service
    service = client.find_service_by_name("rtw_planner") or client.find_service_by_name("rtw_planner".replace("-", "_"))
    if not service:
        print("Service not found!")
        return
    
    service_id = service['id']
    print(f"Service: {service.get('name')} ({service_id})")
    print("=" * 60)
    
    # Get recent deploys
    deploys = client.list_deploys(service_id)
    print(f"\nRecent Deploys ({len(deploys)}):\n")
    
    for i, deploy_item in enumerate(deploys[:5]):
        deploy = deploy_item.get('deploy', {})
        print(f"{i+1}. Deploy {deploy.get('id', 'N/A')}")
        print(f"   Status: {deploy.get('status', 'N/A')}")
        print(f"   Commit: {deploy.get('commit', {}).get('message', 'N/A')[:50]}")
        print(f"   Created: {deploy.get('createdAt', 'N/A')}")
        print(f"   Finished: {deploy.get('finishedAt', 'N/A')}")
        print()
    
    # Get latest failed deploy details
    if deploys:
        latest = deploys[0].get('deploy', {})
        if latest.get('status') in ['update_failed', 'build_failed']:
            print("=" * 60)
            print(f"Latest Failed Deploy: {latest.get('id')}")
            print("=" * 60)
            
            deploy_details = client.get_deploy(service_id, latest.get('id'))
            print(json.dumps(deploy_details, indent=2))
    
    print("\n" + "=" * 60)
    print("NOTE: Full build logs are available in the Render Dashboard:")
    print(f"https://dashboard.render.com/web/{service_id}")
    print("=" * 60)

if __name__ == "__main__":
    main()


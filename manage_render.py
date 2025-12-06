#!/usr/bin/env python3
"""
Render Management Script
Quick commands to manage your Render services via CLI
"""

import sys
import os
from render_api_client import RenderAPIClient

# API key
API_KEY = "rnd_KSfch1qfb5CaigK85v719pOsJhuP"

def print_usage():
    print("""
Render Management Script

Usage: python manage_render.py <command> [args]

Commands:
  list                    - List all services
  info <service_name>     - Show service information
  env <service_name>      - List environment variables
  set-env <service_name> <key> <value>  - Set environment variable
  del-env <service_name> <key>          - Delete environment variable
  restart <service_name>  - Restart service
  deploy <service_name>   - Trigger new deployment
  logs <service_name>     - Show recent logs
  status <service_name>   - Show service status
    """)

def main():
    if len(sys.argv) < 2:
        print_usage()
        return
    
    client = RenderAPIClient(API_KEY)
    command = sys.argv[1].lower()
    
    try:
        if command == "list":
            services = client.list_services()
            print(f"\n📋 Found {len(services)} service(s):\n")
            for service in services:
                s = service.get("service", {})
                print(f"  • {s.get('name', 'N/A')} ({s.get('id', 'N/A')})")
                print(f"    Type: {s.get('type', 'N/A')}")
                print()
        
        elif command == "info":
            if len(sys.argv) < 3:
                print("Error: Service name required")
                return
            service_name = sys.argv[2]
            service = client.find_service_by_name(service_name) or client.find_service_by_name(service_name.replace("-", "_"))
            if service:
                client.print_service_info(service.get('id'))
            else:
                print(f"Service '{service_name}' not found")
        
        elif command == "env":
            if len(sys.argv) < 3:
                print("Error: Service name required")
                return
            service_name = sys.argv[2]
            service = client.find_service_by_name(service_name) or client.find_service_by_name(service_name.replace("-", "_"))
            if service:
                env_vars = client.list_env_vars(service.get('id'))
                print(f"\n📝 Environment Variables for {service.get('name')}:\n")
                if env_vars:
                    for item in env_vars:
                        # Handle nested envVar structure from API
                        env_var = item.get('envVar', item)
                        key = env_var.get('key', 'N/A')
                        value = env_var.get('value', '')
                        # Mask long values (likely secrets)
                        if len(value) > 30:
                            value = value[:15] + "..." + value[-5:]
                        print(f"  {key} = {value}")
                else:
                    print("  No environment variables set.")
            else:
                print(f"Service '{service_name}' not found")
        
        elif command == "set-env":
            if len(sys.argv) < 5:
                print("Error: Usage: set-env <service_name> <key> <value>")
                return
            service_name = sys.argv[2]
            key = sys.argv[3]
            value = sys.argv[4]
            service = client.find_service_by_name(service_name) or client.find_service_by_name(service_name.replace("-", "_"))
            if service:
                result = client.set_env_var(service.get('id'), key, value)
                print(f"✓ Set {key} = {value}")
            else:
                print(f"Service '{service_name}' not found")
        
        elif command == "del-env":
            if len(sys.argv) < 4:
                print("Error: Usage: del-env <service_name> <key>")
                return
            service_name = sys.argv[2]
            key = sys.argv[3]
            service = client.find_service_by_name(service_name) or client.find_service_by_name(service_name.replace("-", "_"))
            if service:
                client.delete_env_var(service.get('id'), key)
                print(f"✓ Deleted environment variable: {key}")
            else:
                print(f"Service '{service_name}' not found")
        
        elif command == "restart":
            if len(sys.argv) < 3:
                print("Error: Service name required")
                return
            service_name = sys.argv[2]
            service = client.find_service_by_name(service_name) or client.find_service_by_name(service_name.replace("-", "_"))
            if service:
                result = client.restart_service(service.get('id'))
                print(f"✓ Restarted service: {service.get('name')}")
            else:
                print(f"Service '{service_name}' not found")
        
        elif command == "deploy":
            if len(sys.argv) < 3:
                print("Error: Service name required")
                return
            service_name = sys.argv[2]
            service = client.find_service_by_name(service_name) or client.find_service_by_name(service_name.replace("-", "_"))
            if service:
                result = client.trigger_deploy(service.get('id'))
                print(f"✓ Triggered deployment for: {service.get('name')}")
                print(f"  Deploy ID: {result.get('deploy', {}).get('id', 'N/A')}")
            else:
                print(f"Service '{service_name}' not found")
        
        elif command == "logs":
            if len(sys.argv) < 3:
                print("Error: Service name required")
                return
            service_name = sys.argv[2]
            service = client.find_service_by_name(service_name) or client.find_service_by_name(service_name.replace("-", "_"))
            if service:
                logs = client.get_logs(service.get('id'), limit=50)
                print(f"\n📋 Recent logs for {service.get('name')}:\n")
                for log in logs[:20]:  # Show last 20
                    print(log.get('message', ''))
            else:
                print(f"Service '{service_name}' not found")
        
        elif command == "status":
            if len(sys.argv) < 3:
                print("Error: Service name required")
                return
            service_name = sys.argv[2]
            service = client.find_service_by_name(service_name) or client.find_service_by_name(service_name.replace("-", "_"))
            if service:
                service_id = service.get('id')
                service_info = client.get_service(service_id)
                print(f"\n📊 Status for {service.get('name')}:\n")
                print(f"  ID: {service_id}")
                print(f"  Type: {service_info.get('type', 'N/A')}")
                print(f"  Status: {service_info.get('serviceDetails', {}).get('healthCheckStatus', 'N/A')}")
                print(f"  URL: {service_info.get('serviceDetails', {}).get('url', 'N/A')}")
                print(f"  Created: {service_info.get('createdAt', 'N/A')}")
                print(f"  Updated: {service_info.get('updatedAt', 'N/A')}")
            else:
                print(f"Service '{service_name}' not found")
        
        else:
            print(f"Unknown command: {command}")
            print_usage()
    
    except Exception as e:
        print(f"Error: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    main()


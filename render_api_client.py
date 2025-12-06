"""
Render API Client
Connects to Render API to manage services, environment variables, and deployments.
API Reference: https://api-docs.render.com/reference/introduction
"""

import requests
import json
from typing import Optional, Dict, List, Any


class RenderAPIClient:
    """Client for interacting with Render's REST API"""
    
    BASE_URL = "https://api.render.com/v1"
    
    def __init__(self, api_key: str):
        """
        Initialize Render API client
        
        Args:
            api_key: Your Render API key (starts with rnd_)
        """
        self.api_key = api_key
        self.headers = {
            "Authorization": f"Bearer {api_key}",
            "Accept": "application/json",
            "Content-Type": "application/json"
        }
    
    def _make_request(self, method: str, endpoint: str, data: Optional[Dict] = None) -> Dict:
        """
        Make an HTTP request to the Render API
        
        Args:
            method: HTTP method (GET, POST, PATCH, DELETE, etc.)
            endpoint: API endpoint (e.g., '/services')
            data: Optional request body data
            
        Returns:
            Response JSON as dictionary
        """
        url = f"{self.BASE_URL}{endpoint}"
        
        try:
            if method.upper() == "GET":
                response = requests.get(url, headers=self.headers)
            elif method.upper() == "POST":
                response = requests.post(url, headers=self.headers, json=data)
            elif method.upper() == "PATCH":
                response = requests.patch(url, headers=self.headers, json=data)
            elif method.upper() == "PUT":
                response = requests.put(url, headers=self.headers, json=data)
            elif method.upper() == "DELETE":
                response = requests.delete(url, headers=self.headers)
            else:
                raise ValueError(f"Unsupported HTTP method: {method}")
            
            response.raise_for_status()
            return response.json() if response.content else {}
            
        except requests.exceptions.HTTPError as e:
            error_msg = f"HTTP {e.response.status_code}: {e.response.text}"
            print(f"Error: {error_msg}")
            raise
        except requests.exceptions.RequestException as e:
            print(f"Request error: {e}")
            raise
    
    # =============================================================================
    # Services
    # =============================================================================
    
    def list_services(self) -> List[Dict]:
        """List all services in your account"""
        return self._make_request("GET", "/services")
    
    def get_service(self, service_id: str) -> Dict:
        """Retrieve a specific service by ID"""
        return self._make_request("GET", f"/services/{service_id}")
    
    def update_service(self, service_id: str, updates: Dict) -> Dict:
        """
        Update a service
        
        Args:
            service_id: Service ID
            updates: Dictionary of fields to update (e.g., {'name': 'new-name'})
        """
        return self._make_request("PATCH", f"/services/{service_id}", updates)
    
    def restart_service(self, service_id: str) -> Dict:
        """Restart a service"""
        return self._make_request("POST", f"/services/{service_id}/restart")
    
    def suspend_service(self, service_id: str) -> Dict:
        """Suspend a service"""
        return self._make_request("POST", f"/services/{service_id}/suspend")
    
    def resume_service(self, service_id: str) -> Dict:
        """Resume a suspended service"""
        return self._make_request("POST", f"/services/{service_id}/resume")
    
    # =============================================================================
    # Environment Variables
    # =============================================================================
    
    def list_env_vars(self, service_id: str) -> List[Dict]:
        """List all environment variables for a service"""
        return self._make_request("GET", f"/services/{service_id}/env-vars")
    
    def get_env_var(self, service_id: str, env_var_key: str) -> Dict:
        """Get a specific environment variable"""
        return self._make_request("GET", f"/services/{service_id}/env-vars/{env_var_key}")
    
    def set_env_var(self, service_id: str, key: str, value: str) -> Dict:
        """Add or update an environment variable"""
        return self._make_request("PUT", f"/services/{service_id}/env-vars/{key}", {"value": value})
    
    def delete_env_var(self, service_id: str, key: str) -> Dict:
        """Delete an environment variable"""
        return self._make_request("DELETE", f"/services/{service_id}/env-vars/{key}")
    
    def update_env_vars(self, service_id: str, env_vars: Dict[str, str]) -> Dict:
        """
        Update multiple environment variables at once
        
        Args:
            service_id: Service ID
            env_vars: Dictionary of key-value pairs
        """
        # Convert dict to list format expected by API
        env_vars_list = [{"key": k, "value": v} for k, v in env_vars.items()]
        return self._make_request("PUT", f"/services/{service_id}/env-vars", env_vars_list)
    
    # =============================================================================
    # Deploys
    # =============================================================================
    
    def list_deploys(self, service_id: str) -> List[Dict]:
        """List all deploys for a service"""
        return self._make_request("GET", f"/services/{service_id}/deploys")
    
    def trigger_deploy(self, service_id: str, clear_cache: bool = False) -> Dict:
        """
        Trigger a new deployment
        
        Args:
            service_id: Service ID
            clear_cache: Whether to clear build cache
        """
        return self._make_request("POST", f"/services/{service_id}/deploys", {
            "clearBuildCache": clear_cache
        })
    
    def get_deploy(self, service_id: str, deploy_id: str) -> Dict:
        """Get details of a specific deploy"""
        return self._make_request("GET", f"/services/{service_id}/deploys/{deploy_id}")
    
    def cancel_deploy(self, service_id: str, deploy_id: str) -> Dict:
        """Cancel a running deployment"""
        return self._make_request("POST", f"/services/{service_id}/deploys/{deploy_id}/cancel")
    
    def rollback_deploy(self, service_id: str, deploy_id: str) -> Dict:
        """Rollback to a previous deployment"""
        return self._make_request("POST", f"/services/{service_id}/deploys/{deploy_id}/rollback")
    
    # =============================================================================
    # Logs
    # =============================================================================
    
    def get_logs(self, service_id: str, limit: int = 100) -> List[Dict]:
        """Get recent logs for a service"""
        return self._make_request("GET", f"/services/{service_id}/logs?limit={limit}")
    
    # =============================================================================
    # Helper Methods
    # =============================================================================
    
    def find_service_by_name(self, name: str) -> Optional[Dict]:
        """Find a service by name"""
        services = self.list_services()
        for service in services:
            if service.get("service", {}).get("name") == name:
                return service.get("service")
        return None
    
    def print_service_info(self, service_id: str):
        """Print formatted information about a service"""
        service = self.get_service(service_id)
        print(f"\nService: {service.get('name', 'N/A')}")
        print(f"ID: {service.get('id', 'N/A')}")
        print(f"Type: {service.get('type', 'N/A')}")
        print(f"Status: {service.get('serviceDetails', {}).get('healthCheckStatus', 'N/A')}")
        print(f"URL: {service.get('serviceDetails', {}).get('url', 'N/A')}")
        print(f"Created: {service.get('createdAt', 'N/A')}")
        print(f"Updated: {service.get('updatedAt', 'N/A')}")


def main():
    """Example usage of the Render API client"""
    import os
    
    # Get API key from environment or use provided one
    api_key = os.environ.get("RENDER_API_KEY", "rnd_KSfch1qfb5CaigK85v719pOsJhuP")
    
    if not api_key:
        print("Error: RENDER_API_KEY environment variable not set")
        return
    
    client = RenderAPIClient(api_key)
    
    print("=" * 60)
    print("Render API Client - Testing Connection")
    print("=" * 60)
    
    try:
        # Test connection by listing services
        print("\n📋 Listing all services...")
        services = client.list_services()
        
        if services:
            print(f"\nFound {len(services)} service(s):\n")
            for service in services:
                service_data = service.get("service", {})
                print(f"  • {service_data.get('name', 'N/A')} ({service_data.get('id', 'N/A')})")
                print(f"    Type: {service_data.get('type', 'N/A')}")
                print(f"    Status: {service_data.get('serviceDetails', {}).get('healthCheckStatus', 'N/A')}")
                print()
        else:
            print("No services found.")
        
        # Try to find rtw-planner service (check both naming conventions)
        print("\n🔍 Looking for RTW planner service...")
        rtw_service = client.find_service_by_name("rtw-planner") or client.find_service_by_name("rtw_planner")
        
        if rtw_service:
            print(f"✓ Found service: {rtw_service.get('name')}")
            print(f"  ID: {rtw_service.get('id')}")
            
            # List environment variables
            print("\n📝 Environment Variables:")
            env_vars = client.list_env_vars(rtw_service.get('id'))
            if env_vars:
                for env_var in env_vars:
                    key = env_var.get('key', 'N/A')
                    # Don't print sensitive values
                    value = env_var.get('value', '')
                    if len(value) > 20:
                        value = value[:20] + "..."
                    print(f"  • {key} = {value}")
            else:
                print("  No environment variables set.")
            
            # List recent deploys
            print("\n🚀 Recent Deploys:")
            deploys = client.list_deploys(rtw_service.get('id'))
            if deploys:
                for deploy in deploys[:5]:  # Show last 5
                    deploy_data = deploy.get('deploy', {})
                    print(f"  • {deploy_data.get('id', 'N/A')} - {deploy_data.get('status', 'N/A')} - {deploy_data.get('createdAt', 'N/A')}")
            else:
                print("  No deploys found.")
        else:
            print("✗ Service 'rtw-planner' not found.")
        
        print("\n" + "=" * 60)
        print("✓ Connection successful!")
        print("=" * 60)
        
    except Exception as e:
        print(f"\n✗ Error: {e}")
        print("\nMake sure your API key is correct and has proper permissions.")


if __name__ == "__main__":
    main()


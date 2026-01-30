import asyncio
from kubernetes import client, config
from kubernetes.client.rest import ApiException

async def diagnose_metrics():
    try:
        config.load_kube_config()
        custom_api = client.CustomObjectsApi()
        
        print("--- Checking Node Metrics ---")
        try:
            nodes = custom_api.list_cluster_custom_object(
                group="metrics.k8s.io",
                version="v1beta1",
                plural="nodes"
            )
            print(f"Found {len(nodes.get('items', []))} nodes in metrics")
        except ApiException as e:
            print(f"Failed to get node metrics: {e}")

        print("\n--- Checking Pod Metrics (All Namespaces) ---")
        try:
            pods = custom_api.list_cluster_custom_object(
                group="metrics.k8s.io",
                version="v1beta1",
                plural="pods"
            )
            items = pods.get('items', [])
            print(f"Found {len(items)} pods in metrics")
            if items:
                print(f"Sample pod: {items[0]['metadata']['name']} in {items[0]['metadata']['namespace']}")
        except ApiException as e:
            print(f"Failed to get pod metrics: {e}")

    except Exception as e:
        print(f"Diagnostic error: {e}")

if __name__ == "__main__":
    asyncio.run(diagnose_metrics())

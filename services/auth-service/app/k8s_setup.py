from datetime import datetime
from typing import Tuple

from kubernetes import client, config
from kubernetes.client.rest import ApiException
from urllib.request import Request, urlopen
import json


class KubeconfigValidationError(Exception):
    pass


def _load_kube_config() -> None:
    try:
        config.load_incluster_config()
    except Exception:
        config.load_kube_config()


def _get_clients() -> Tuple[client.CoreV1Api, client.AppsV1Api]:
    _load_kube_config()
    return client.CoreV1Api(), client.AppsV1Api()


def upsert_kubeconfig_secret(
    *,
    namespace: str,
    name: str,
    kubeconfig_text: str,
) -> None:
    v1, _ = _get_clients()
    body = client.V1Secret(
        metadata=client.V1ObjectMeta(name=name, namespace=namespace),
        type="Opaque",
        string_data={"kubeconfig.yaml": kubeconfig_text or ""},
    )

    try:
        v1.read_namespaced_secret(name=name, namespace=namespace)
        v1.replace_namespaced_secret(name=name, namespace=namespace, body=body)
    except ApiException as e:
        if e.status == 404:
            v1.create_namespaced_secret(namespace=namespace, body=body)
        else:
            raise


def patch_configmap(
    *,
    namespace: str,
    name: str,
    data: dict,
) -> None:
    v1, _ = _get_clients()
    v1.patch_namespaced_config_map(name=name, namespace=namespace, body={"data": data})


def restart_deployment(*, namespace: str, name: str) -> None:
    _, apps = _get_clients()
    patch = {
        "spec": {
            "template": {
                "metadata": {
                    "annotations": {
                        "kubectl.kubernetes.io/restartedAt": datetime.utcnow().isoformat()
                    }
                }
            }
        }
    }
    apps.patch_namespaced_deployment(name=name, namespace=namespace, body=patch)


def validate_kubeconfig_connection(*, kubeconfig: dict, timeout: int = 5) -> None:
    api_client = config.new_client_from_config_dict(kubeconfig)
    try:
        try:
            data, status, _ = api_client.call_api(
                "/healthz",
                "GET",
                response_type="str",
                _return_http_data_only=False,
                _request_timeout=timeout,
            )
        except ApiException as e:
            raise KubeconfigValidationError(f"{e.status} {e.reason}") from e
        except Exception as e:
            raise KubeconfigValidationError(str(e)) from e
    finally:
        api_client.close()

    if status < 200 or status >= 300:
        raise KubeconfigValidationError(f"Health check failed with status {status}")

    if isinstance(data, (bytes, bytearray)):
        data = data.decode("utf-8", errors="ignore")
    if isinstance(data, str) and data.strip().lower() not in {"ok", "healthy"}:
        # Some apiservers return plain "ok" for /healthz.
        # We accept any 2xx, but also guard against unexpected content.
        snippet = data.strip()[:200]
        raise KubeconfigValidationError(f"Health check did not return ok: {snippet}")


def check_k8s_service_health(*, url: str = "http://k8s-service:8002/health", timeout: int = 2) -> dict:
    try:
        req = Request(url, headers={"Accept": "application/json"})
        with urlopen(req, timeout=timeout) as response:
            raw = response.read()
        payload = json.loads(raw.decode("utf-8"))
        if isinstance(payload, dict):
            return payload
    except Exception:
        return {}
    return {}

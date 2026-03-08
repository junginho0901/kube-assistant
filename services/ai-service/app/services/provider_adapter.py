"""
Provider-Aware OpenAI Adapter — AsyncOpenAI drop-in replacement.

각 LLM 프로바이더(OpenAI, Anthropic, Google, Ollama 등)의
OpenAI-compatible 엔드포인트를 사용하여,
기존 self.client.chat.completions.create(...) 호출을 변경 없이
모든 프로바이더에서 사용할 수 있게 합니다.
"""

from __future__ import annotations

from typing import Optional, Dict, Any
from openai import AsyncOpenAI
import httpx


# 프로바이더별 기본 OpenAI-compatible 엔드포인트
_PROVIDER_BASE_URLS: Dict[str, str] = {
    "openai": "https://api.openai.com/v1",
    "anthropic": "https://api.anthropic.com/v1/",
    "google": "https://generativelanguage.googleapis.com/v1beta/openai/",
    "gemini": "https://generativelanguage.googleapis.com/v1beta/openai/",
    "ollama": "http://localhost:11434/v1",
    # Azure는 사용자가 base_url을 직접 지정해야 함 (endpoint + deployment)
    # "azure": "https://<resource>.openai.azure.com/openai/deployments/<deployment>/",
}


class ProviderAdapter:
    """
    AsyncOpenAI drop-in replacement.

    프로바이더에 따라 적절한 base_url을 자동 설정합니다.
    기존 코드에서 self.client.chat.completions.create(...) 호출이
    그대로 작동합니다.

    사용 예:
        adapter = ProviderAdapter(
            provider="anthropic",
            model="claude-sonnet-4-20250514",
            api_key="sk-ant-...",
        )
        resp = await adapter.chat.completions.create(
            model="claude-sonnet-4-20250514",
            messages=[...],
        )
    """

    def __init__(
        self,
        provider: str = "openai",
        model: str = "gpt-4o-mini",
        api_key: str = "",
        base_url: Optional[str] = None,
        tls_verify: bool = True,
        default_headers: Optional[Dict[str, str]] = None,
        **_kwargs: Any,
    ):
        self.provider = (provider or "openai").strip().lower()
        self.model = model
        self.api_key = api_key

        # base_url 결정: 사용자 지정 > 프로바이더 기본값
        clean_base_url = (base_url or "").strip()

        if clean_base_url:
            resolved_base_url = clean_base_url
        else:
            resolved_base_url = _PROVIDER_BASE_URLS.get(
                self.provider, "https://api.openai.com/v1"
            )

        http_client = httpx.AsyncClient(verify=tls_verify)

        # Ollama 등 로컬 모델은 API 키 불필요 — 빈 값이면 더미값 사용
        effective_api_key = api_key if api_key else "ollama"

        # AsyncOpenAI 클라이언트 생성
        self._openai_client = AsyncOpenAI(
            api_key=effective_api_key,
            base_url=resolved_base_url,
            default_headers=default_headers if default_headers else None,
            http_client=http_client,
        )

        # chat.completions 인터페이스를 그대로 노출
        self.chat = self._openai_client.chat

        print(
            f"[Provider Adapter] provider={self.provider}, "
            f"model={model}, base_url={resolved_base_url}",
            flush=True,
        )

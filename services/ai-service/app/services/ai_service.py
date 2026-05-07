"""
AI 트러블슈팅 서비스
"""
from openai import AsyncOpenAI
from typing import Callable, List, Dict, Optional
import httpx
import re
import json
import os
import sys
import time
from app.config import settings
from datetime import datetime
from app.security import decode_access_token
from app.models.ai import (
    LogAnalysisRequest,
    LogAnalysisResponse,
    TroubleshootRequest,
    TroubleshootResponse,
    ChatRequest,
    ChatResponse,
    ErrorPattern,
    SeverityLevel
)
from app.services.k8s_client import K8sServiceClient
from app.services.tool_server_client import ToolServerClient
from app.services.provider_adapter import ProviderAdapter
from app.services.ai.prompts import SYSTEM_MESSAGE
from app.services.ai.tools import K8S_READONLY_TOOLS, K8S_WRITE_TOOLS
from app.services.ai.language import detect_response_language, build_language_directive
from app.services.ai.tool_dispatch import execute_function_with_context
from app.services.ai import formatters, permissions
from app.services.ai import streaming as streaming_module


class TTLCache(dict):
    """dict 호환 캐시 — 5분 TTL 자동 만료"""
    TTL = 300

    def __contains__(self, key):
        if not super().__contains__(key):
            return False
        ts, _ = super().__getitem__(key)
        if time.time() - ts > self.TTL:
            self.pop(key, None)
            return False
        return True

    def __getitem__(self, key):
        ts, val = super().__getitem__(key)
        if time.time() - ts > self.TTL:
            self.pop(key, None)
            raise KeyError(key)
        return val

    def __setitem__(self, key, value):
        super().__setitem__(key, (time.time(), value))


class ToolContext:
    """Tool 실행 컨텍스트"""
    def __init__(self, session_id: str):
        self.session_id = session_id
        self.state = {}  # 실행 상태
        self.cache = TTLCache()  # 결과 캐시 (5분 TTL)


class AIService:
    """AI 트러블슈팅 서비스"""
    
    def __init__(
        self,
        authorization: Optional[str] = None,
        provider: Optional[str] = None,
        model: Optional[str] = None,
        base_url: Optional[str] = None,
        api_key: Optional[str] = None,
        extra_headers: Optional[Dict[str, str]] = None,
        tls_verify: Optional[bool] = True,
    ):
        """프로바이더별 AsyncOpenAI 어댑터 기반 클라이언트 초기화"""
        resolved_api_key = api_key if api_key is not None else settings.OPENAI_API_KEY
        resolved_model = model or settings.OPENAI_MODEL
        resolved_provider = (provider or "openai").strip().lower()
        # base_url: 사용자가 커스텀 엔드포인트를 지정한 경우만 전달
        resolved_base_url = (base_url or "").strip() or None

        self.client = ProviderAdapter(
            provider=resolved_provider,
            model=resolved_model,
            api_key=resolved_api_key,
            base_url=resolved_base_url,
            tls_verify=tls_verify if tls_verify is not None else True,
            default_headers=extra_headers,
        )
        self.model = resolved_model
        self.provider = resolved_provider  # public name used in streamed model_info
        self._provider_name = resolved_provider
        self.user_role = self._resolve_user_role(authorization)
        self.k8s_service = K8sServiceClient(authorization=authorization)
        tool_server_url = self._resolve_tool_server_url(self.user_role)
        self.tool_server = ToolServerClient(authorization=authorization, base_url=tool_server_url)
        self.tool_contexts: Dict[str, ToolContext] = {}  # {session_id: ToolContext}
        print(f"[AI Service] 초기화 완료 - provider: {resolved_provider}, 모델: {self.model}, role: {self.user_role}", flush=True)

    def update_authorization(self, authorization: Optional[str] = None) -> None:
        """
        Update per-request authorization context without recreating the
        heavy LLM client.  This is called when the singleton AIService
        is reused across different users.
        """
        new_role = self._resolve_user_role(authorization)  # also sets self._token_payload
        if new_role != self.user_role or True:
            self.user_role = new_role
            self.k8s_service = K8sServiceClient(authorization=authorization)
            tool_server_url = self._resolve_tool_server_url(self.user_role)
            self.tool_server = ToolServerClient(authorization=authorization, base_url=tool_server_url)

    def _resolve_user_role(self, authorization: Optional[str]) -> str:
        return permissions.resolve_user_role(self, authorization)

    @property
    def token(self):
        return getattr(self, "_token_payload", None)

    def _resolve_tool_server_url(self, role: str) -> Optional[str]:
        # Permission-based: check if user has write/admin-level permissions
        if self.token and self.token.has_permission("*"):
            return os.getenv("TOOL_SERVER_URL_ADMIN")
        if self.token and self.token.has_permission("ai.tool.*"):
            return os.getenv("TOOL_SERVER_URL_WRITE")
        return os.getenv("TOOL_SERVER_URL_READ")

    async def _call_tool_server(self, function_name: str, function_args: Dict) -> str:
        return await self.tool_server.call_tool(function_name, function_args)

    def _role_allows_write(self) -> bool:
        return permissions.role_allows_write(self)

    def _role_allows_admin(self) -> bool:
        return permissions.role_allows_admin(self)

    def _is_tool_allowed(self, function_name: str) -> bool:
        return permissions.is_tool_allowed(self, function_name)

    def _filter_tools_by_role(self, tools: List[Dict]) -> List[Dict]:
        return permissions.filter_tools_by_role(self, tools)

    def _detect_response_language(self, text: str) -> str:
        return detect_response_language(text)

    def _build_language_directive(self, user_message: str) -> str:
        return build_language_directive(user_message)

    def _sanitize_history_content(self, role: str, content: Optional[str]) -> str:
        """LLM 히스토리에 넣기 전에 tool 결과 블록을 제거/축약"""
        if not isinstance(content, str):
            return ""
        if role != "assistant":
            return content

        # Remove tool result blocks (KAgent-style <details> with 🔧 summary)
        sanitized = re.sub(
            r"<details>\s*<summary>🔧.*?</details>\s*",
            "",
            content,
            flags=re.DOTALL,
        ).strip()

        # Hard cap to avoid context blow-up even after stripping
        max_chars = 8000
        if len(sanitized) > max_chars:
            sanitized = sanitized[:max_chars] + "\n... (truncated) ..."
        return sanitized

    async def analyze_logs(self, request: LogAnalysisRequest) -> LogAnalysisResponse:
        """로그 분석"""
        
        # 에러 패턴 추출
        error_patterns = self._extract_error_patterns(request.logs)
        
        # GPT를 사용한 상세 분석
        prompt = f"""
다음은 Kubernetes Pod의 로그입니다:

Namespace: {request.namespace}
Pod: {request.pod_name}
Container: {request.container or 'N/A'}

로그:
```
{request.logs[:4000]}  # 토큰 제한을 위해 일부만
```

다음을 분석해주세요:
1. 로그 요약
2. 발견된 에러의 근본 원인
3. 해결 방안 (구체적이고 실행 가능한 단계)
4. 관련된 일반적인 이슈들

JSON 형식으로 응답해주세요:
{{
  "summary": "로그 요약",
  "root_cause": "근본 원인",
  "recommendations": ["해결방안1", "해결방안2"],
  "related_issues": ["관련이슈1", "관련이슈2"]
}}
"""
        
        try:
            print(f"[AI Service] Analyze Logs API 호출 - 요청 모델: {self.model}", flush=True)
            _base_kwargs = dict(
                model=self.model,
                messages=[
                    {"role": "system", "content": "당신은 Kubernetes 전문가이자 DevOps 엔지니어입니다. 로그를 분석하고 문제를 해결하는 데 도움을 줍니다. 반드시 JSON 형식으로만 응답하세요."},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.3,
            )
            try:
                response = await self.client.chat.completions.create(**_base_kwargs, response_format={"type": "json_object"})
            except Exception:
                # 모델이 response_format을 지원하지 않는 경우 fallback
                response = await self.client.chat.completions.create(**_base_kwargs)
            print(f"[AI Service] Analyze Logs API 응답 - 실제 사용 모델: {response.model}", flush=True)
            
            # OpenAI 응답 전체 로그 출력
            import json
            response_dict = {
                "id": response.id,
                "model": response.model,
                "created": response.created,
                "choices": [
                    {
                        "index": choice.index,
                        "message": {
                            "role": choice.message.role,
                            "content": choice.message.content,
                            "tool_calls": [{"id": tc.id, "type": tc.type, "function": {"name": tc.function.name, "arguments": tc.function.arguments}} for tc in (choice.message.tool_calls or [])]
                        },
                        "finish_reason": choice.finish_reason
                    } for choice in response.choices
                ],
                "usage": {
                    "prompt_tokens": response.usage.prompt_tokens if response.usage else None,
                    "completion_tokens": response.usage.completion_tokens if response.usage else None,
                    "total_tokens": response.usage.total_tokens if response.usage else None
                } if response.usage else None
            }
            print(f"[OPENAI RESPONSE][analyze_logs] {json.dumps(response_dict, ensure_ascii=False, indent=2)}", flush=True)
            
            result = json.loads(response.choices[0].message.content)
            
            return LogAnalysisResponse(
                summary=result.get("summary", ""),
                errors=error_patterns,
                root_cause=result.get("root_cause"),
                recommendations=result.get("recommendations", []),
                related_issues=result.get("related_issues", [])
            )
        except Exception as e:
            # Fallback: GPT 없이도 기본 분석 제공
            return LogAnalysisResponse(
                summary="로그에서 에러 패턴을 감지했습니다.",
                errors=error_patterns,
                root_cause="상세 분석을 위해 AI 서비스가 필요합니다.",
                recommendations=["로그를 확인하고 에러 메시지를 검색하세요."],
                related_issues=[]
            )
    
    async def troubleshoot(self, request: TroubleshootRequest) -> TroubleshootResponse:
        """종합 트러블슈팅"""
        
        # 리소스 정보 수집
        context = await self._gather_resource_context(request)
        
        prompt = f"""
다음 Kubernetes 리소스에 문제가 발생했습니다:

Namespace: {request.namespace}
Resource Type: {request.resource_type}
Resource Name: {request.resource_name}

컨텍스트:
{context}

다음을 분석해주세요:
1. 진단 (무엇이 문제인가?)
2. 심각도 (critical/high/medium/low/info)
3. 근본 원인들
4. 해결 방안들 (단계별로 구체적으로)
5. 예방 조치

JSON 형식으로 응답해주세요:
{{
  "diagnosis": "진단 내용",
  "severity": "심각도",
  "root_causes": ["원인1", "원인2"],
  "solutions": [
    {{"step": 1, "action": "조치1", "command": "kubectl 명령어"}},
    {{"step": 2, "action": "조치2", "command": "kubectl 명령어"}}
  ],
  "preventive_measures": ["예방조치1", "예방조치2"],
  "estimated_fix_time": "예상 해결 시간"
}}
"""
        
        try:
            print(f"[AI Service] Troubleshoot API 호출 - 요청 모델: {self.model}", flush=True)
            _base_kwargs = dict(
                model=self.model,
                messages=[
                    {"role": "system", "content": "당신은 Kubernetes 트러블슈팅 전문가입니다. 반드시 JSON 형식으로만 응답하세요."},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.3,
            )
            try:
                response = await self.client.chat.completions.create(**_base_kwargs, response_format={"type": "json_object"})
            except Exception:
                response = await self.client.chat.completions.create(**_base_kwargs)
            print(f"[AI Service] Troubleshoot API 응답 - 실제 사용 모델: {response.model}", flush=True)
            
            # OpenAI 응답 전체 로그 출력
            import json
            response_dict = {
                "id": response.id,
                "model": response.model,
                "created": response.created,
                "choices": [
                    {
                        "index": choice.index,
                        "message": {
                            "role": choice.message.role,
                            "content": choice.message.content,
                            "tool_calls": [{"id": tc.id, "type": tc.type, "function": {"name": tc.function.name, "arguments": tc.function.arguments}} for tc in (choice.message.tool_calls or [])]
                        },
                        "finish_reason": choice.finish_reason
                    } for choice in response.choices
                ],
                "usage": {
                    "prompt_tokens": response.usage.prompt_tokens if response.usage else None,
                    "completion_tokens": response.usage.completion_tokens if response.usage else None,
                    "total_tokens": response.usage.total_tokens if response.usage else None
                } if response.usage else None
            }
            print(f"[OPENAI RESPONSE][troubleshoot] {json.dumps(response_dict, ensure_ascii=False, indent=2)}", flush=True)
            
            result = json.loads(response.choices[0].message.content)
            
            return TroubleshootResponse(
                diagnosis=result.get("diagnosis", ""),
                severity=SeverityLevel(result.get("severity", "medium")),
                root_causes=result.get("root_causes", []),
                solutions=result.get("solutions", []),
                preventive_measures=result.get("preventive_measures", []),
                estimated_fix_time=result.get("estimated_fix_time")
            )
        except Exception as e:
            raise Exception(f"Troubleshooting failed: {e}")
    
    async def chat(self, request: ChatRequest) -> ChatResponse:
        """AI 챗봇 with Function Calling"""
        
        # 시스템 메시지
        system_message = """
    당신은 Kubernetes 클러스터를 관리하는 AI Agent입니다.
    사용자의 질문에 답하기 위해 필요한 경우 Kubernetes API를 직접 호출할 수 있습니다.
    실시간 클러스터 정보를 조회하여 정확한 답변을 제공하세요.

    **Language**: Respond in the same language as the user's latest message
    (Korean → Korean, English → English, etc.). Keep commands/code/resource names verbatim.

    중요: 사용자가 네임스페이스를 명시하지 않은 요청에서 `default`를 임의로 가정하지 마세요.
    사용자가 리소스 이름을 "대충" 던지는 경우(정확한 전체 이름이 아닌 식별자/부분 문자열)에는,
    먼저 `k8s_get_resources`를 `all_namespaces=true`로 호출해 모든 네임스페이스에서 후보를 찾고
    그 결과의 `namespace`/`name`을 사용해 후속 도구(로그/describe 등)를 호출하세요.
    YAML 요청은 `k8s_get_resource_yaml`에서만 지원합니다. 그 외에는 JSON으로 조회하고 화면에는 kubectl 테이블로 표시합니다.
    """
        
        # 메시지 변환
        messages = [{"role": "system", "content": system_message}]
        for msg in request.messages:
            messages.append({
                "role": msg.role,
                "content": self._sanitize_history_content(msg.role, msg.content),
            })

        # 컨텍스트 추가 (마지막 user/assistant 메시지에 append)
        if request.context:
            context_str = f"\n\n현재 컨텍스트:\n{request.context}"
            messages[-1]["content"] += context_str

        # Inject language directive after history so it overrides Korean-biased prompt.
        latest_user_msg = ""
        for msg in reversed(request.messages):
            if msg.role == "user" and isinstance(msg.content, str):
                latest_user_msg = msg.content
                break
        messages.append({
            "role": "system",
            "content": self._build_language_directive(latest_user_msg),
        })
        
        # Function definitions
        tools = [
            {
                "type": "function",
                "function": {
                    "name": "get_cluster_overview",
                    "description": "클러스터 전체 개요 (네임스페이스, Pod, Service 등의 총 개수)를 조회합니다",
                    "parameters": {"type": "object", "properties": {}}
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "get_pod_metrics",
                    "description": "Pod 리소스 사용량(CPU/Memory) 조회 (kubectl top pods)",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "namespace": {"type": "string", "description": "네임스페이스 (선택)"}
                        }
                    }
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "get_node_metrics",
                    "description": "Node 리소스 사용량(CPU/Memory) 조회 (kubectl top nodes)",
                    "parameters": {"type": "object", "properties": {}}
                }
            }
        ]
        tools.extend(K8S_READONLY_TOOLS)
        # YAML/WIDE 요청 시 legacy JSON-only 도구는 제외
        latest_user_message = next((m.content for m in reversed(request.messages) if m.role == "user"), None)
        tools = self._filter_tools_for_output_preference(tools, latest_user_message)
        
        try:
            # 첫 번째 GPT 호출 (function calling 포함)
            print(f"[AI Service] Chat API 호출 - 요청 모델: {self.model}", flush=True)
            _chat_kwargs = dict(
                model=self.model,
                messages=messages,
                tools=tools,
                temperature=0.7,
            )
            try:
                response = await self.client.chat.completions.create(**_chat_kwargs, tool_choice="auto")
            except Exception:
                response = await self.client.chat.completions.create(**_chat_kwargs)
            print(f"[AI Service] Chat API 응답 - 실제 사용 모델: {response.model}", flush=True)
            
            # OpenAI 응답 전체 로그 출력
            import json
            response_dict = {
                "id": response.id,
                "model": response.model,
                "created": response.created,
                "choices": [
                    {
                        "index": choice.index,
                        "message": {
                            "role": choice.message.role,
                            "content": choice.message.content,
                            "tool_calls": [{"id": tc.id, "type": tc.type, "function": {"name": tc.function.name, "arguments": tc.function.arguments}} for tc in (choice.message.tool_calls or [])]
                        },
                        "finish_reason": choice.finish_reason
                    } for choice in response.choices
                ],
                "usage": {
                    "prompt_tokens": response.usage.prompt_tokens if response.usage else None,
                    "completion_tokens": response.usage.completion_tokens if response.usage else None,
                    "total_tokens": response.usage.total_tokens if response.usage else None
                } if response.usage else None
            }
            print(f"[OPENAI RESPONSE][chat first] {json.dumps(response_dict, ensure_ascii=False, indent=2)}", flush=True)
            
            response_message = response.choices[0].message
            tool_calls = response_message.tool_calls
            
            # Function calling이 있으면 실행
            if tool_calls:
                messages.append(response_message)
                
                for tool_call in tool_calls:
                    function_name = tool_call.function.name
                    function_args = json.loads(tool_call.function.arguments)
                    
                    # 함수 실행
                    function_response = await self._execute_function(function_name, function_args)
                    formatted_result, _, _ = formatters._format_tool_result(
                        function_name,
                        function_args,
                        function_response,
                    )
                    tool_message_content = formatters._truncate_tool_result_for_llm(formatted_result)
                    
                    messages.append({
                        "tool_call_id": tool_call.id,
                        "role": "tool",
                        "name": function_name,
                        "content": tool_message_content
                    })
                
                # 함수 결과를 바탕으로 최종 답변 생성
                print(f"[AI Service] Chat API 두 번째 호출 - 요청 모델: {self.model}", flush=True)
                second_response = await self.client.chat.completions.create(
                    model=self.model,
                    messages=messages,
                    temperature=0.7
                )
                print(f"[AI Service] Chat API 두 번째 응답 - 실제 사용 모델: {second_response.model}", flush=True)
                
                # OpenAI 응답 전체 로그 출력
                import json
                response_dict = {
                    "id": second_response.id,
                    "model": second_response.model,
                    "created": second_response.created,
                    "choices": [
                        {
                            "index": choice.index,
                            "message": {
                                "role": choice.message.role,
                                "content": choice.message.content,
                                "tool_calls": [{"id": tc.id, "type": tc.type, "function": {"name": tc.function.name, "arguments": tc.function.arguments}} for tc in (choice.message.tool_calls or [])]
                            },
                            "finish_reason": choice.finish_reason
                        } for choice in second_response.choices
                    ],
                    "usage": {
                        "prompt_tokens": second_response.usage.prompt_tokens if second_response.usage else None,
                        "completion_tokens": second_response.usage.completion_tokens if second_response.usage else None,
                        "total_tokens": second_response.usage.total_tokens if second_response.usage else None
                    } if second_response.usage else None
                }
                print(f"[OPENAI RESPONSE][chat second] {json.dumps(response_dict, ensure_ascii=False, indent=2)}", flush=True)
                
                message = second_response.choices[0].message.content
            else:
                message = response_message.content
            
            suggestions = self._extract_suggestions(message)
            
            return ChatResponse(
                message=message,
                suggestions=suggestions,
                actions=[]
            )
        except Exception as e:
            raise Exception(f"Chat failed: {e}")
    
    async def explain_resource(self, resource_type: str, resource_yaml: str) -> str:
        """리소스 YAML 설명"""
        
        prompt = f"""
다음 Kubernetes {resource_type} 리소스를 분석해주세요:

```yaml
{resource_yaml}
```

다음을 설명해주세요:
1. 이 리소스가 하는 일
2. 주요 설정 설명
3. 잠재적 문제점이나 개선 사항
4. 베스트 프랙티스 권장사항
"""
        
        try:
            response = await self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": "당신은 Kubernetes 리소스 설정 전문가입니다."},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.5
            )
            
            # OpenAI 응답 전체 로그 출력
            import json
            response_dict = {
                "id": response.id,
                "model": response.model,
                "created": response.created,
                "choices": [
                    {
                        "index": choice.index,
                        "message": {
                            "role": choice.message.role,
                            "content": choice.message.content,
                            "tool_calls": [{"id": tc.id, "type": tc.type, "function": {"name": tc.function.name, "arguments": tc.function.arguments}} for tc in (choice.message.tool_calls or [])]
                        },
                        "finish_reason": choice.finish_reason
                    } for choice in response.choices
                ],
                "usage": {
                    "prompt_tokens": response.usage.prompt_tokens if response.usage else None,
                    "completion_tokens": response.usage.completion_tokens if response.usage else None,
                    "total_tokens": response.usage.total_tokens if response.usage else None
                } if response.usage else None
            }
            print(f"[OPENAI RESPONSE][explain_resource] {json.dumps(response_dict, ensure_ascii=False, indent=2)}", flush=True)
            
            return response.choices[0].message.content
        except Exception as e:
            raise Exception(f"Resource explanation failed: {e}")
    
    async def suggest_optimization(self, namespace: str) -> List[str]:
        """리소스 최적화 제안"""

        observations = await self._build_optimization_observations(namespace)

        prompt = f"""
아래는 Kubernetes 네임스페이스의 **관측 데이터(스펙/상태/메트릭/이벤트)** 요약입니다.
이 데이터에 근거해서 리소스 최적화 제안을 작성하세요.

중요:
- 추측/일반론만 쓰지 말고, 반드시 숫자/리소스명 등 관측값을 인용하세요.
- 관측 데이터에 없는 내용은 "추가 확인 필요"로 남기세요.

관측 요약:
{observations['observations_md']}

요구사항:
1) 우선순위(High/Med/Low)와 기대효과(비용/성능/안정성)를 같이 표기
2) 각 항목마다 "근거(관측)"를 1줄 이상 포함
3) 가능하면 kubectl 패치 예시(짧게) 포함

출력은 마크다운으로, 리스트 형태로 작성하세요.
"""

        try:
            response = await self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": "당신은 Kubernetes 리소스 최적화 전문가입니다. 반드시 관측 데이터에 근거해 답하세요."},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.5
            )
            
            # OpenAI 응답 전체 로그 출력
            import json
            response_dict = {
                "id": response.id,
                "model": response.model,
                "created": response.created,
                "choices": [
                    {
                        "index": choice.index,
                        "message": {
                            "role": choice.message.role,
                            "content": choice.message.content,
                            "tool_calls": [{"id": tc.id, "type": tc.type, "function": {"name": tc.function.name, "arguments": tc.function.arguments}} for tc in (choice.message.tool_calls or [])]
                        },
                        "finish_reason": choice.finish_reason
                    } for choice in response.choices
                ],
                "usage": {
                    "prompt_tokens": response.usage.prompt_tokens if response.usage else None,
                    "completion_tokens": response.usage.completion_tokens if response.usage else None,
                    "total_tokens": response.usage.total_tokens if response.usage else None
                } if response.usage else None
            }
            print(f"[OPENAI RESPONSE][suggest_optimization] {json.dumps(response_dict, ensure_ascii=False, indent=2)}", flush=True)
            
            content = response.choices[0].message.content
            # 제안을 리스트로 파싱
            suggestions = [line.strip() for line in content.split('\n') if line.strip() and (line.strip().startswith('-') or line.strip().startswith('•'))]
            
            return suggestions if suggestions else [content]
        except Exception as e:
            raise Exception(f"Optimization suggestion failed: {e}")

    async def suggest_optimization_stream(self, namespace: str):
        async for chunk in streaming_module.suggest_optimization_stream(self, namespace):
            yield chunk

    def _parse_cpu_quantity_to_m(self, value: Optional[str]) -> Optional[int]:
        if value is None:
            return None
        s = str(value).strip()
        if not s:
            return None
        try:
            if s.endswith("m"):
                return int(float(s[:-1]))
            if s.endswith("n"):
                # nano cores -> millicores
                return int(float(s[:-1]) / 1_000_000)
            # assume cores
            return int(float(s) * 1000)
        except Exception:
            return None

    def _parse_memory_quantity_to_mi(self, value: Optional[str]) -> Optional[int]:
        if value is None:
            return None
        s = str(value).strip()
        if not s:
            return None
        try:
            if s.endswith("Ki"):
                return int(float(s[:-2]) / 1024)
            if s.endswith("Mi"):
                return int(float(s[:-2]))
            if s.endswith("Gi"):
                return int(float(s[:-2]) * 1024)
            if s.endswith("Ti"):
                return int(float(s[:-2]) * 1024 * 1024)
            # bytes
            return int(float(s) / (1024 * 1024))
        except Exception:
            return None

    def _median_int(self, values: List[int]) -> Optional[int]:
        if not values:
            return None
        values_sorted = sorted(values)
        return values_sorted[len(values_sorted) // 2]

    def _round_up_int(self, value: int, step: int) -> int:
        if step <= 0:
            return value
        return int(((value + step - 1) // step) * step)

    def _labels_match_selector(self, labels: Dict, selector: Dict) -> bool:
        if not selector:
            return False
        if not labels:
            return False
        for k, v in selector.items():
            if labels.get(k) != v:
                return False
        return True

    def _extract_image_tag_flag(self, image: str) -> str:
        if not image:
            return "unknown"
        # image without ':' after last '/' is often untagged -> defaults to latest
        last_segment = image.split("/")[-1]
        if ":" not in last_segment:
            return "untagged"
        if image.endswith(":latest"):
            return "latest"
        return "pinned"

    async def _build_optimization_observations(self, namespace: str) -> Dict[str, str]:
        """최적화 제안용 관측 데이터 요약 생성 (LLM 입력 + UI 표시용)"""
        overview = None
        try:
            overview = await self.k8s_service.get_cluster_overview()
        except Exception as e:
            overview = {"error": str(e)}

        deployments = await self.k8s_service.get_deployments(namespace)
        pods = await self.k8s_service.get_pods(namespace)

        pod_metrics: Optional[List[Dict]] = None
        pod_metrics_error: Optional[str] = None
        try:
            pod_metrics = await self.k8s_service.get_pod_metrics(namespace)
        except Exception as e:
            pod_metrics = None
            pod_metrics_error = str(e)

        events: List[Dict] = []
        events_error: Optional[str] = None
        try:
            events = await self.k8s_service.get_events(namespace)
        except Exception as e:
            events_error = str(e)

        deployments_sorted = sorted(
            deployments,
            key=lambda d: len((d.get("selector") or {})),
            reverse=True,
        )

        # Map pod -> deployment by selector (most specific selector wins)
        pod_to_deployment: Dict[str, str] = {}
        deployment_to_pods: Dict[str, List[Dict]] = {d.get("name"): [] for d in deployments_sorted if d.get("name")}
        unmatched_pods: List[Dict] = []
        for pod in pods:
            labels = pod.get("labels") or {}
            matched_name: Optional[str] = None
            for dep in deployments_sorted:
                dep_name = dep.get("name")
                selector = dep.get("selector") or {}
                if not dep_name:
                    continue
                if self._labels_match_selector(labels, selector):
                    matched_name = dep_name
                    break
            if matched_name:
                pod_to_deployment[pod.get("name", "")] = matched_name
                deployment_to_pods.setdefault(matched_name, []).append(pod)
            else:
                unmatched_pods.append(pod)

        metrics_by_pod: Dict[str, Dict] = {}
        if pod_metrics:
            for item in pod_metrics:
                key = f"{item.get('namespace')}/{item.get('name')}"
                metrics_by_pod[key] = item

        metrics_window_sample: Optional[str] = None
        metrics_timestamp_max: Optional[str] = None
        if pod_metrics:
            windows = [str(m.get("window")) for m in pod_metrics if m.get("window")]
            if windows:
                # "30s" 같은 값이 대부분이므로 샘플 1개만 표기(가장 흔한 값 우선)
                counts: Dict[str, int] = {}
                for w in windows:
                    counts[w] = counts.get(w, 0) + 1
                metrics_window_sample = sorted(counts.items(), key=lambda kv: kv[1], reverse=True)[0][0]

            timestamps = [str(m.get("timestamp")) for m in pod_metrics if m.get("timestamp")]
            if timestamps:
                # ISO8601이면 max timestamp를 표기(파싱 실패 시 문자열 max로 fallback)
                try:
                    from datetime import datetime

                    parsed = []
                    for ts in timestamps:
                        parsed.append(datetime.fromisoformat(ts.replace("Z", "+00:00")))
                    metrics_timestamp_max = max(parsed).isoformat()
                except Exception:
                    metrics_timestamp_max = max(timestamps)

        def pod_resource_totals(pod: Dict):
            cpu_req_m_vals: List[int] = []
            cpu_lim_m_vals: List[int] = []
            mem_req_mi_vals: List[int] = []
            mem_lim_mi_vals: List[int] = []
            missing_req_any = 0
            missing_lim_any = 0
            missing_cpu_req = 0
            missing_mem_req = 0
            missing_cpu_lim = 0
            missing_mem_lim = 0

            for c in (pod.get("containers") or []):
                req = c.get("requests") or {}
                lim = c.get("limits") or {}
                cpu_req_m = self._parse_cpu_quantity_to_m(req.get("cpu"))
                mem_req_mi = self._parse_memory_quantity_to_mi(req.get("memory"))
                cpu_lim_m = self._parse_cpu_quantity_to_m(lim.get("cpu"))
                mem_lim_mi = self._parse_memory_quantity_to_mi(lim.get("memory"))

                if cpu_req_m is None:
                    missing_cpu_req += 1
                if mem_req_mi is None:
                    missing_mem_req += 1
                if cpu_lim_m is None:
                    missing_cpu_lim += 1
                if mem_lim_mi is None:
                    missing_mem_lim += 1

                if cpu_req_m is None or mem_req_mi is None:
                    missing_req_any += 1
                if cpu_lim_m is None or mem_lim_mi is None:
                    missing_lim_any += 1

                if cpu_req_m is not None:
                    cpu_req_m_vals.append(cpu_req_m)
                if cpu_lim_m is not None:
                    cpu_lim_m_vals.append(cpu_lim_m)
                if mem_req_mi is not None:
                    mem_req_mi_vals.append(mem_req_mi)
                if mem_lim_mi is not None:
                    mem_lim_mi_vals.append(mem_lim_mi)

            return {
                "cpu_request_m": sum(cpu_req_m_vals) if cpu_req_m_vals else None,
                "cpu_limit_m": sum(cpu_lim_m_vals) if cpu_lim_m_vals else None,
                "mem_request_mi": sum(mem_req_mi_vals) if mem_req_mi_vals else None,
                "mem_limit_mi": sum(mem_lim_mi_vals) if mem_lim_mi_vals else None,
                "containers_total": len(pod.get("containers") or []),
                "containers_missing_requests": missing_req_any,
                "containers_missing_limits": missing_lim_any,
                "containers_missing_cpu_requests": missing_cpu_req,
                "containers_missing_mem_requests": missing_mem_req,
                "containers_missing_cpu_limits": missing_cpu_lim,
                "containers_missing_mem_limits": missing_mem_lim,
            }

        def pod_usage(pod: Dict):
            key = f"{pod.get('namespace')}/{pod.get('name')}"
            m = metrics_by_pod.get(key)
            if not m:
                return {"cpu_m": None, "mem_mi": None}
            return {
                "cpu_m": self._parse_cpu_quantity_to_m(m.get("cpu")),
                "mem_mi": self._parse_memory_quantity_to_mi(m.get("memory")),
                "timestamp": m.get("timestamp"),
                "window": m.get("window"),
            }

        deployment_rows = []
        findings: List[str] = []

        node_count = None
        if isinstance(overview, dict):
            node_count = overview.get("node_count")
        node_count = int(node_count) if isinstance(node_count, (int, float)) else None

        for dep in deployments_sorted[:25]:
            dep_name = dep.get("name")
            if not dep_name:
                continue
            dep_pods = deployment_to_pods.get(dep_name, [])

            restarts = [int(p.get("restart_count") or 0) for p in dep_pods]
            total_restarts = sum(restarts)
            max_restarts = max(restarts) if restarts else 0
            not_ready = 0
            for p in dep_pods:
                ready_str = str(p.get("ready") or "")
                try:
                    ready_ok = ready_str and ready_str.split("/")[0] == ready_str.split("/")[1]
                except Exception:
                    ready_ok = False
                if not ready_ok:
                    not_ready += 1

            per_pod_cpu_req = []
            per_pod_cpu_lim = []
            per_pod_mem_req = []
            per_pod_mem_lim = []
            missing_req_containers = 0
            missing_lim_containers = 0
            missing_cpu_req_containers = 0
            missing_mem_req_containers = 0
            missing_cpu_lim_containers = 0
            missing_mem_lim_containers = 0
            containers_total = 0

            cpu_usage_vals = []
            mem_usage_vals = []

            image_flags = []
            reason_counts: Dict[str, int] = {}
            for p in dep_pods:
                totals = pod_resource_totals(p)
                containers_total += totals["containers_total"]
                missing_req_containers += totals["containers_missing_requests"]
                missing_lim_containers += totals["containers_missing_limits"]
                missing_cpu_req_containers += totals.get("containers_missing_cpu_requests", 0) or 0
                missing_mem_req_containers += totals.get("containers_missing_mem_requests", 0) or 0
                missing_cpu_lim_containers += totals.get("containers_missing_cpu_limits", 0) or 0
                missing_mem_lim_containers += totals.get("containers_missing_mem_limits", 0) or 0
                if totals["cpu_request_m"] is not None:
                    per_pod_cpu_req.append(totals["cpu_request_m"])
                if totals["cpu_limit_m"] is not None:
                    per_pod_cpu_lim.append(totals["cpu_limit_m"])
                if totals["mem_request_mi"] is not None:
                    per_pod_mem_req.append(totals["mem_request_mi"])
                if totals["mem_limit_mi"] is not None:
                    per_pod_mem_lim.append(totals["mem_limit_mi"])

                u = pod_usage(p)
                if u.get("cpu_m") is not None:
                    cpu_usage_vals.append(int(u["cpu_m"]))
                if u.get("mem_mi") is not None:
                    mem_usage_vals.append(int(u["mem_mi"]))

                for c in (p.get("containers") or []):
                    img = str(c.get("image") or "")
                    if img:
                        image_flags.append(self._extract_image_tag_flag(img))

                    # container state / last_state reasons
                    for state_key in ("state", "last_state"):
                        st = c.get(state_key) or {}
                        if not isinstance(st, dict):
                            continue
                        waiting = st.get("waiting") if isinstance(st.get("waiting"), dict) else None
                        if waiting and waiting.get("reason"):
                            reason = str(waiting.get("reason"))
                            reason_counts[reason] = reason_counts.get(reason, 0) + 1
                        terminated = st.get("terminated") if isinstance(st.get("terminated"), dict) else None
                        if terminated and terminated.get("reason"):
                            reason = str(terminated.get("reason"))
                            reason_counts[reason] = reason_counts.get(reason, 0) + 1

            cpu_req_med = self._median_int(per_pod_cpu_req)
            mem_req_med = self._median_int(per_pod_mem_req)
            cpu_lim_med = self._median_int(per_pod_cpu_lim)
            mem_lim_med = self._median_int(per_pod_mem_lim)

            cpu_usage_avg = int(sum(cpu_usage_vals) / len(cpu_usage_vals)) if cpu_usage_vals else None
            mem_usage_avg = int(sum(mem_usage_vals) / len(mem_usage_vals)) if mem_usage_vals else None

            cpu_util = None
            if missing_cpu_req_containers == 0 and cpu_req_med and cpu_usage_avg is not None and cpu_req_med > 0:
                cpu_util = round(cpu_usage_avg / cpu_req_med * 100, 1)
            mem_util = None
            if missing_mem_req_containers == 0 and mem_req_med and mem_usage_avg is not None and mem_req_med > 0:
                mem_util = round(mem_usage_avg / mem_req_med * 100, 1)

            image_flag = "unknown"
            if image_flags:
                # If any latest/untagged exists, highlight
                if "latest" in image_flags:
                    image_flag = "latest"
                elif "untagged" in image_flags:
                    image_flag = "untagged"
                else:
                    image_flag = "pinned"

            deployment_rows.append(
                {
                    "name": dep_name,
                    "replicas": dep.get("replicas"),
                    "ready": dep.get("ready_replicas"),
                    "pods": len(dep_pods),
                    "not_ready": not_ready,
                    "restarts_total": total_restarts,
                    "restarts_max": max_restarts,
                    "cpu_req_m": cpu_req_med,
                    "cpu_lim_m": cpu_lim_med,
                    "mem_req_mi": mem_req_med,
                    "mem_lim_mi": mem_lim_med,
                    "cpu_usage_m_avg": cpu_usage_avg,
                    "mem_usage_mi_avg": mem_usage_avg,
                    "cpu_util_pct": cpu_util,
                    "mem_util_pct": mem_util,
                    "containers_total": containers_total,
                    "missing_req_containers": missing_req_containers,
                    "missing_lim_containers": missing_lim_containers,
                    "missing_cpu_req_containers": missing_cpu_req_containers,
                    "missing_mem_req_containers": missing_mem_req_containers,
                    "missing_cpu_lim_containers": missing_cpu_lim_containers,
                    "missing_mem_lim_containers": missing_mem_lim_containers,
                    "image_flag": image_flag,
                    "selector": dep.get("selector") or {},
                    "reason_counts": reason_counts,
                }
            )

        # Aggregate findings (less spammy than per-deployment repetition)
        def sample(names: List[str], limit: int = 6) -> str:
            if not names:
                return ""
            head = names[:limit]
            suffix = "…" if len(names) > limit else ""
            return ", ".join(f"`{n}`" for n in head) + suffix

        if node_count and node_count >= 2:
            single_replica = [r["name"] for r in deployment_rows if r.get("replicas") == 1]
            if single_replica:
                findings.append(
                    f"- replicas=1 deployments: {len(single_replica)}/{len(deployment_rows)} (node_count={node_count}) 예: {sample(single_replica)}"
                )

        missing_resources = [
            r["name"]
            for r in deployment_rows
            if (r.get("missing_req_containers", 0) > 0 or r.get("missing_lim_containers", 0) > 0) and r.get("pods", 0) > 0
        ]
        if missing_resources:
            findings.append(f"- requests/limits 누락 컨테이너가 있는 deployment: {len(missing_resources)} 예: {sample(missing_resources)}")

        missing_cpu_req = [r["name"] for r in deployment_rows if (r.get("missing_cpu_req_containers") or 0) > 0]
        if missing_cpu_req:
            findings.append(f"- cpu requests 누락 컨테이너(부분 누락 포함): {len(missing_cpu_req)} 예: {sample(missing_cpu_req)}")

        missing_mem_req = [r["name"] for r in deployment_rows if (r.get("missing_mem_req_containers") or 0) > 0]
        if missing_mem_req:
            findings.append(f"- memory requests 누락 컨테이너(부분 누락 포함): {len(missing_mem_req)} 예: {sample(missing_mem_req)}")

        missing_cpu_lim = [r["name"] for r in deployment_rows if (r.get("missing_cpu_lim_containers") or 0) > 0]
        if missing_cpu_lim:
            findings.append(f"- cpu limits 누락 컨테이너(부분 누락 포함): {len(missing_cpu_lim)} 예: {sample(missing_cpu_lim)}")

        missing_mem_lim = [r["name"] for r in deployment_rows if (r.get("missing_mem_lim_containers") or 0) > 0]
        if missing_mem_lim:
            findings.append(f"- memory limits 누락 컨테이너(부분 누락 포함): {len(missing_mem_lim)} 예: {sample(missing_mem_lim)}")

        image_issues = [r["name"] for r in deployment_rows if r.get("image_flag") in ("latest", "untagged")]
        if image_issues:
            findings.append(f"- latest/미태깅 이미지 가능성: {len(image_issues)} 예: {sample(image_issues)}")

        # Common runtime issues
        def count_reason(deployment: Dict, reason: str) -> int:
            rc = deployment.get("reason_counts") or {}
            if not isinstance(rc, dict):
                return 0
            return int(rc.get(reason) or 0)

        crashloops = [r["name"] for r in deployment_rows if count_reason(r, "CrashLoopBackOff") > 0]
        if crashloops:
            findings.append(f"- CrashLoopBackOff 감지: {len(crashloops)} 예: {sample(crashloops)}")

        oomkilled = [r["name"] for r in deployment_rows if count_reason(r, "OOMKilled") > 0]
        if oomkilled:
            findings.append(f"- OOMKilled 감지: {len(oomkilled)} 예: {sample(oomkilled)}")

        imagepull = [
            r["name"]
            for r in deployment_rows
            if count_reason(r, "ImagePullBackOff") > 0 or count_reason(r, "ErrImagePull") > 0
        ]
        if imagepull:
            findings.append(f"- ImagePullBackOff/ErrImagePull 감지: {len(imagepull)} 예: {sample(imagepull)}")

        not_ready_deps = [r["name"] for r in deployment_rows if (r.get("not_ready") or 0) > 0]
        if not_ready_deps:
            findings.append(f"- Ready 아닌 pod가 있는 deployment: {len(not_ready_deps)} 예: {sample(not_ready_deps)}")

        high_restarts = [r["name"] for r in deployment_rows if (r.get("restarts_total") or 0) >= 3]
        if high_restarts:
            findings.append(f"- 재시작(>=3) 발생 deployment: {len(high_restarts)} 예: {sample(high_restarts)}")

        cpu_over = [
            r["name"]
            for r in deployment_rows
            if r.get("cpu_util_pct") is not None and (r.get("cpu_req_m") or 0) >= 200 and float(r["cpu_util_pct"]) < 20
        ]
        if cpu_over:
            findings.append(f"- CPU request 과대 가능성(util<20% & req>=200m): {len(cpu_over)} 예: {sample(cpu_over)}")

        mem_over = [
            r["name"]
            for r in deployment_rows
            if r.get("mem_util_pct") is not None and (r.get("mem_req_mi") or 0) >= 256 and float(r["mem_util_pct"]) < 20
        ]
        if mem_over:
            findings.append(f"- Memory request 과대 가능성(util<20% & req>=256Mi): {len(mem_over)} 예: {sample(mem_over)}")

        mem_hot = [r["name"] for r in deployment_rows if r.get("mem_util_pct") is not None and float(r["mem_util_pct"]) >= 90]
        if mem_hot:
            findings.append(f"- Memory request 대비 사용량 높음(util>=90%): {len(mem_hot)} 예: {sample(mem_hot)}")

        cpu_hot = [r["name"] for r in deployment_rows if r.get("cpu_util_pct") is not None and float(r["cpu_util_pct"]) >= 90]
        if cpu_hot:
            findings.append(f"- CPU request 대비 사용량 높음(util>=90%): {len(cpu_hot)} 예: {sample(cpu_hot)}")

        # Events: keep Warning-ish events only, and trim
        event_lines: List[str] = []
        if events:
            warnings = []
            for ev in events:
                if not isinstance(ev, dict):
                    continue
                t = str(ev.get("type") or "")
                reason = str(ev.get("reason") or "")
                msg = str(ev.get("message") or "")
                if t.lower() in ("warning",) or reason in ("FailedScheduling", "FailedMount", "Failed", "BackOff", "ErrImagePull", "ImagePullBackOff"):
                    warnings.append((t, reason, msg))
            for t, reason, msg in warnings[:12]:
                trimmed = (msg[:180] + "…") if len(msg) > 180 else msg
                event_lines.append(f"- [{t or 'Event'}] {reason}: {trimmed}")

        # Build markdown
        header_lines = [
            f"## Observed data (`{namespace}`)",
        ]
        if isinstance(overview, dict) and overview.get("error"):
            header_lines.append(f"- Cluster overview: error={overview.get('error')}")
        else:
            if isinstance(overview, dict):
                header_lines.append(f"- Nodes: {overview.get('node_count', 'N/A')}, Cluster version: {overview.get('cluster_version', 'N/A')}")
        header_lines.append(f"- Deployments: {len(deployments)}, Pods: {len(pods)}")
        if pod_metrics_error:
            header_lines.append(f"- Pod metrics: error={pod_metrics_error}")
        else:
            header_lines.append(f"- Pod metrics: {'available' if pod_metrics is not None else 'unavailable'}")
        header_lines.append(
            "- Note: `usage`는 metrics-server **스냅샷(현재값)** 이며, 표의 `usage` 값은 **파드별 스냅샷을 deployment 단위로 평균** 낸 값입니다. `req/lim`은 컨테이너별 합(누락 컨테이너가 있으면 과소추정)입니다."
        )
        if metrics_window_sample or metrics_timestamp_max:
            header_lines.append(
                f"- Pod metrics snapshot info: window={metrics_window_sample or 'N/A'}, timestamp(max)={metrics_timestamp_max or 'N/A'}"
            )
        if events_error:
            header_lines.append(f"- Events: error={events_error}")
        elif event_lines:
            header_lines.append(f"- Warning events (sample): {len(event_lines)}")

        table_lines = [
            "",
            "### Deployments summary",
            "| deployment | replicas(ready) | pods(notReady) | restarts(total/max) | cpu req/lim (m, per-pod) | cpu usage (m, pods avg snapshot) | mem req/lim (Mi, per-pod) | mem usage (Mi, pods avg snapshot) | util cpu/mem (vs req) | image |",
            "|---|---:|---:|---:|---:|---:|---:|---:|---:|---|",
        ]
        for row in deployment_rows:
            replicas = row.get("replicas")
            ready = row.get("ready")
            pods_count = row.get("pods")
            not_ready = row.get("not_ready")
            restarts_total = row.get("restarts_total")
            restarts_max = row.get("restarts_max")
            cpu_req = row.get("cpu_req_m")
            cpu_lim = row.get("cpu_lim_m")
            mem_req = row.get("mem_req_mi")
            mem_lim = row.get("mem_lim_mi")
            cpu_u = row.get("cpu_usage_m_avg")
            mem_u = row.get("mem_usage_mi_avg")
            cpu_util = row.get("cpu_util_pct")
            mem_util = row.get("mem_util_pct")
            util_text = ""
            if cpu_util is not None or mem_util is not None:
                util_text = f"{cpu_util if cpu_util is not None else 'N/A'}%/{mem_util if mem_util is not None else 'N/A'}%"
            image_flag = row.get("image_flag")

            cpu_req_text = cpu_req if cpu_req is not None else "N/A"
            cpu_lim_text = cpu_lim if cpu_lim is not None else "N/A"
            mem_req_text = mem_req if mem_req is not None else "N/A"
            mem_lim_text = mem_lim if mem_lim is not None else "N/A"
            cpu_u_text = cpu_u if cpu_u is not None else "N/A"
            mem_u_text = mem_u if mem_u is not None else "N/A"
            table_lines.append(
                f"| `{row.get('name')}` | {replicas}({ready}) | {pods_count}({not_ready}) | {restarts_total}/{restarts_max} | {cpu_req_text}/{cpu_lim_text} | {cpu_u_text} | {mem_req_text}/{mem_lim_text} | {mem_u_text} | {util_text or 'N/A'} | {image_flag} |"
            )

        md = "\n".join(header_lines + table_lines)
        if event_lines:
            md += "\n\n### Warning events (sample)\n" + "\n".join(event_lines)
        if findings:
            md += "\n\n### Auto findings (based on observed data)\n" + "\n".join(findings[:30])

        # Build deterministic action plan (so "표"와 "제안"이 연결되게)
        def is_probably_control_plane(name: str) -> bool:
            lowered = name.lower()
            keywords = ("operator", "controller", "admission", "webhook", "converter", "crd")
            return any(k in lowered for k in keywords)

        def is_probably_user_facing(name: str) -> bool:
            lowered = name.lower()
            keywords = ("gateway", "ingress", "web", "api", "console", "dashboard")
            return any(k in lowered for k in keywords)

        def fmt_m(value: Optional[int]) -> str:
            return f"{value}m" if isinstance(value, int) else "N/A"

        def fmt_mi(value: Optional[int]) -> str:
            return f"{value}Mi" if isinstance(value, int) else "N/A"

        def rec_cpu_request_m(row: Dict) -> Optional[int]:
            usage = row.get("cpu_usage_m_avg")
            if not isinstance(usage, int) or usage <= 0:
                return None
            # p95가 없으니 보수적으로 avg*2를 권장(최소 50m)
            return self._round_up_int(max(int(usage * 2), 50), 10)

        def rec_mem_request_mi(row: Dict) -> Optional[int]:
            usage = row.get("mem_usage_mi_avg")
            if not isinstance(usage, int) or usage <= 0:
                return None
            # avg 기반으로 1.5x(최소 128Mi)
            return self._round_up_int(max(int(usage * 1.5), 128), 64)

        def rec_limit_from_request(request: Optional[int], factor: float, step: int) -> Optional[int]:
            if not isinstance(request, int) or request <= 0:
                return None
            return self._round_up_int(max(int(request * factor), request), step)

        # Hot/overprovision lists
        hot_mem = sorted(
            [r for r in deployment_rows if isinstance(r.get("mem_util_pct"), (int, float)) and float(r["mem_util_pct"]) >= 90],
            key=lambda r: float(r.get("mem_util_pct") or 0),
            reverse=True,
        )
        hot_cpu = sorted(
            [r for r in deployment_rows if isinstance(r.get("cpu_util_pct"), (int, float)) and float(r["cpu_util_pct"]) >= 90],
            key=lambda r: float(r.get("cpu_util_pct") or 0),
            reverse=True,
        )
        over_cpu = sorted(
            [r for r in deployment_rows if isinstance(r.get("cpu_util_pct"), (int, float)) and float(r["cpu_util_pct"]) < 20 and (r.get("cpu_req_m") or 0) >= 200],
            key=lambda r: float(r.get("cpu_util_pct") or 0),
        )

        missing_resources_rows = [
            r
            for r in deployment_rows
            if (r.get("missing_req_containers", 0) > 0 or r.get("missing_lim_containers", 0) > 0 or r.get("cpu_req_m") is None or r.get("mem_req_mi") is None)
        ]

        latest_images_rows = [r for r in deployment_rows if r.get("image_flag") in ("latest", "untagged")]

        oom_rows = [r for r in deployment_rows if isinstance(r.get("reason_counts"), dict) and (r["reason_counts"].get("OOMKilled") or 0) > 0]

        failed_scheduling = any("FailedScheduling" in line for line in event_lines)
        readiness_failed = any("Readiness probe failed" in line or "ReadinessProbe" in line for line in event_lines)

        action_lines: List[str] = []
        action_lines.append("### High")

        # HA recommendation (nuanced)
        if node_count and node_count >= 2:
            user_facing_single = [r["name"] for r in deployment_rows if r.get("replicas") == 1 and is_probably_user_facing(r.get("name", ""))]
            controllers_single = [r["name"] for r in deployment_rows if r.get("replicas") == 1 and is_probably_control_plane(r.get("name", ""))]
            if user_facing_single:
                sample_names = ", ".join(f"`{n}`" for n in user_facing_single[:6]) + ("…" if len(user_facing_single) > 6 else "")
                action_lines.append(
                    f"- **[High] 사용자 트래픽/게이트웨이 계열 HA 보강 (효과: 안정성)**  \n"
                    f"  - 근거: node_count={node_count}인데 replicas=1. 사용자 facing으로 보이는 deployment {len(user_facing_single)}개 예: {sample_names}  \n"
                    f"  - 권장: 우선 사용자 요청 경로(gateway/web/api/dashboard)부터 replicas=2+로 올리고, readiness/liveness를 확인  \n"
                    f"  - 적용 예시: `spec.replicas: 2`"
                )
            if controllers_single:
                action_lines.append(
                    f"- **[High] operator/controller는 replicas=1 유지 여부 검토 (효과: 안정성)**  \n"
                    f"  - 근거: operator/controller로 보이는 deployment도 replicas=1 다수(예: `{controllers_single[0]}` 등)  \n"
                    f"  - 권장: leader election 지원 여부 확인 후 2로 확장(지원 시) 또는 1 유지(의도된 싱글톤인 경우)"
                )

        # Missing resources
        if missing_resources_rows:
            examples = ", ".join(f"`{r['name']}`" for r in missing_resources_rows[:6]) + ("…" if len(missing_resources_rows) > 6 else "")
            action_lines.append(
                f"- **[High] requests/limits 누락 정리 (효과: 안정성/비용)**  \n"
                f"  - 근거: requests/limits 누락 의심 deployment {len(missing_resources_rows)}개 예: {examples}  \n"
                f"  - 권장: 최소한 `cpu/memory requests`를 먼저 채우고, 안정화 후 `limits` 적용"
            )

        # Hot memory targets with numbers + recommended values
        if hot_mem:
            action_lines.append("- **[High] Memory request 상향(스케줄링/eviction 리스크 감소) (효과: 안정성)**")
            for r in hot_mem[:6]:
                name = r["name"]
                req = r.get("mem_req_mi")
                lim = r.get("mem_lim_mi")
                usage = r.get("mem_usage_mi_avg")
                util = r.get("mem_util_pct")
                missing_req = int(r.get("missing_mem_req_containers") or 0)
                missing_lim = int(r.get("missing_mem_lim_containers") or 0)
                action_lines.append(
                    f"  - 근거: `{name}` mem usage(pods avg snapshot)={fmt_mi(usage)} vs request={fmt_mi(req)} (util≈{util}%), limit={fmt_mi(lim)}"
                )
                if missing_req > 0:
                    action_lines.append(
                        f"  - 주의: memory requests 누락 컨테이너가 있어(util 계산이 부정확할 수 있음) 먼저 컨테이너별 requests를 채운 뒤 재평가하세요. (missing={missing_req})"
                    )
                    continue
                if missing_lim > 0:
                    action_lines.append(
                        f"  - 주의: memory limits 누락 컨테이너가 있어(limit 합계가 과소추정일 수 있음) 먼저 컨테이너별 limits를 확인/정리하세요. (missing={missing_lim})"
                    )
                    continue
                suspicious = (
                    isinstance(lim, int)
                    and isinstance(usage, int)
                    and lim > 0
                    and usage > int(lim * 1.1)
                )
                if suspicious:
                    action_lines.append(
                        "  - 주의: **표상 usage(pods avg snapshot)가 limit보다 큼** → (1) 컨테이너별 limits 일부 누락 (2) 여러 컨테이너 합산/파싱 차이 가능. Pod 스펙으로 컨테이너별 resources를 먼저 확인하세요."
                    )
                    continue

                rec_req = rec_mem_request_mi(r)
                rec_lim = rec_limit_from_request(rec_req, 2.0, 128)
                if rec_req and rec_lim:
                    action_lines.append(
                        f"  - 권장(초안): requests.memory≈`{fmt_mi(rec_req)}` (pods avg snapshot*1.5, round) / limits.memory≈`{fmt_mi(rec_lim)}` (request*2)  \n"
                        f"    - 적용 예시:\n"
                        f"      ```json\n"
                        f"      {{\n"
                        f"        \"resources\": {{\n"
                        f"          \"requests\": {{\"memory\": \"{rec_req}Mi\"}},\n"
                        f"          \"limits\": {{\"memory\": \"{rec_lim}Mi\"}}\n"
                        f"        }}\n"
                        f"      }}\n"
                        f"      ```"
                    )

        # Hot CPU targets
        if hot_cpu:
            action_lines.append("- **[High] CPU request 상향 또는 HPA 검토 (효과: 안정성/성능)**")
            for r in hot_cpu[:4]:
                name = r["name"]
                req = r.get("cpu_req_m")
                lim = r.get("cpu_lim_m")
                usage = r.get("cpu_usage_m_avg")
                util = r.get("cpu_util_pct")
                missing_req = int(r.get("missing_cpu_req_containers") or 0)
                missing_lim = int(r.get("missing_cpu_lim_containers") or 0)
                action_lines.append(
                    f"  - 근거: `{name}` cpu usage(pods avg snapshot)={fmt_m(usage)} vs request={fmt_m(req)} (util≈{util}%), limit={fmt_m(lim)}"
                )
                if missing_req > 0:
                    action_lines.append(
                        f"  - 주의: cpu requests 누락 컨테이너가 있어(util 계산이 부정확할 수 있음) 먼저 컨테이너별 requests를 채운 뒤 재평가하세요. (missing={missing_req})"
                    )
                    continue
                if missing_lim > 0:
                    action_lines.append(
                        f"  - 주의: cpu limits 누락 컨테이너가 있어(limit 합계가 과소추정일 수 있음) 먼저 컨테이너별 limits를 확인/정리하세요. (missing={missing_lim})"
                    )
                    continue
                suspicious = (
                    isinstance(lim, int)
                    and isinstance(usage, int)
                    and lim > 0
                    and usage > int(lim * 1.1)
                )
                if suspicious:
                    action_lines.append(
                        "  - 주의: **표상 usage(pods avg snapshot)가 limit보다 큼** → (1) 컨테이너별 limits 일부 누락 (2) 여러 컨테이너 합산/파싱 차이 가능. Pod 스펙으로 컨테이너별 resources를 먼저 확인하세요."
                    )
                    continue

                rec_req = rec_cpu_request_m(r)
                rec_lim = rec_limit_from_request(rec_req, 2.0, 100)
                if rec_req and rec_lim:
                    action_lines.append(
                        f"  - 권장(초안): requests.cpu≈`{fmt_m(rec_req)}` (pods avg snapshot*2, round) / limits.cpu≈`{fmt_m(rec_lim)}`  \n"
                        f"    - 적용 예시:\n"
                        f"      ```json\n"
                        f"      {{\n"
                        f"        \"resources\": {{\n"
                        f"          \"requests\": {{\"cpu\": \"{rec_req}m\"}},\n"
                        f"          \"limits\": {{\"cpu\": \"{rec_lim}m\"}}\n"
                        f"        }}\n"
                        f"      }}\n"
                        f"      ```"
                    )

        # Scheduling / readiness event hints
        if failed_scheduling:
            action_lines.append(
                "- **[High] FailedScheduling(affinity/nodeSelector) 원인 확인 (효과: 안정성)**  \n"
                "  - 근거: Warning events에 `FailedScheduling` 존재 (node affinity/selector 불일치)  \n"
                "  - 권장: 해당 Pod의 `nodeSelector/affinity/tolerations`와 노드 label/taint를 비교해서 스케줄 가능하도록 조정"
            )
        if readiness_failed:
            action_lines.append(
                "- **[High] Readiness probe 실패 원인 점검 (효과: 안정성/가용성)**  \n"
                "  - 근거: Warning events에 `Readiness probe failed` 존재  \n"
                "  - 권장: probe endpoint/timeout/initialDelaySeconds 확인 + 앱 로그/헬스체크 응답 시간 측정"
            )

        action_lines.append("")
        action_lines.append("### Medium")

        if latest_images_rows:
            examples = ", ".join(f"`{r['name']}`" for r in latest_images_rows[:6]) + ("…" if len(latest_images_rows) > 6 else "")
            action_lines.append(
                f"- **[Medium] 이미지 태그 pinning (효과: 안정성/재현성)**  \n"
                f"  - 근거: latest/미태깅 이미지 가능성 {len(latest_images_rows)}개 예: {examples}  \n"
                f"  - 권장: `:latest` 대신 버전 태그 또는 digest 사용"
            )

        if oom_rows:
            examples = ", ".join(f"`{r['name']}`" for r in oom_rows[:6]) + ("…" if len(oom_rows) > 6 else "")
            action_lines.append(
                f"- **[Medium] OOMKilled 원인 분석 및 memory limit/request 재조정 (효과: 안정성)**  \n"
                f"  - 근거: OOMKilled 감지 deployment {len(oom_rows)}개 예: {examples}  \n"
                f"  - 권장: (1) OOMKilled 시점 로그/메트릭 확인 (2) memory limit이 실제 피크를 수용하는지 확인 (3) 누수/캐시 설정 점검"
            )

        if over_cpu:
            action_lines.append("- **[Medium] CPU request 과대(낭비) 의심 - 하향 검토 (효과: 비용)**")
            for r in over_cpu[:4]:
                name = r["name"]
                req = r.get("cpu_req_m")
                usage = r.get("cpu_usage_m_avg")
                util = r.get("cpu_util_pct")
                if not isinstance(req, int):
                    continue
                suggested = self._round_up_int(max(int((usage or 0) * 2), 50), 10) if isinstance(usage, int) else max(int(req * 0.5), 50)
                action_lines.append(
                    f"  - 근거: `{name}` cpu usage(pods avg snapshot)={fmt_m(usage)} vs request={fmt_m(req)} (util≈{util}%)  \n"
                    f"  - 권장(초안): requests.cpu≈`{fmt_m(suggested)}`로 낮추고 모니터링(p95 기반으로 재조정)"
                )

        action_plan_md = "\n".join(action_lines).strip()

        # Text-only version (for LLM; keep same content but without heavy markdown table constraints)
        text = {
            "namespace": namespace,
            "overview": overview,
            "deployments_count": len(deployments),
            "pods_count": len(pods),
            "deployment_rows": deployment_rows,
            "warning_events_sample": event_lines,
            "auto_findings": findings[:40],
            "pod_metrics_available": pod_metrics is not None,
            "action_plan_md": action_plan_md,
        }

        return {
            "observations_md": md,
            "observations_text": json.dumps(text, ensure_ascii=False),
            "action_plan_md": action_plan_md,
        }
    
    def _extract_error_patterns(self, logs: str) -> List[ErrorPattern]:
        """로그에서 에러 패턴 추출"""
        patterns = []
        
        # 일반적인 에러 패턴
        error_keywords = [
            (r'ERROR|Error|error', SeverityLevel.HIGH),
            (r'FATAL|Fatal|fatal', SeverityLevel.CRITICAL),
            (r'WARN|Warning|warning', SeverityLevel.MEDIUM),
            (r'Exception|exception', SeverityLevel.HIGH),
            (r'Failed|failed|failure', SeverityLevel.HIGH),
            (r'OOMKilled', SeverityLevel.CRITICAL),
            (r'CrashLoopBackOff', SeverityLevel.CRITICAL),
        ]
        
        for pattern, severity in error_keywords:
            matches = re.findall(pattern, logs)
            if matches:
                patterns.append(ErrorPattern(
                    pattern=pattern,
                    severity=severity,
                    occurrences=len(matches),
                    first_seen=None,
                    last_seen=None
                ))
        
        return patterns
    
    async def _gather_resource_context(self, request: TroubleshootRequest) -> str:
        """리소스 컨텍스트 수집"""
        context = ""
        
        try:
            if request.resource_type.lower() == "pod":
                pods = await self.k8s_service.get_pods(request.namespace)
                pod = next((p for p in pods if p["name"] == request.resource_name), None)
                if pod:
                    context += f"Pod Status: {pod.get('status', 'N/A')}\n"
                    context += f"Phase: {pod.get('phase', 'N/A')}\n"
                    context += f"Restart Count: {pod.get('restart_count', 0)}\n"
                    context += f"Node: {pod.get('node_name', 'N/A')}\n"
                
                if request.include_logs:
                    logs = await self.k8s_service.get_pod_logs(
                        request.namespace,
                        request.resource_name,
                        tail_lines=50
                    )
                    context += f"\nRecent Logs:\n{logs}\n"
            
            if request.include_events:
                events = await self.k8s_service.get_events(request.namespace)
                if events:
                    context += "\nRecent Events:\n"
                    for event in events[:5]:
                        context += f"- [{event['type']}] {event['reason']}: {event['message']}\n"
        
        except Exception as e:
            context += f"\nError gathering context: {e}\n"
        
        return context
    
    async def chat_stream(self, request: ChatRequest):
        async for chunk in streaming_module.chat_stream(self, request):
            yield chunk

    async def _execute_function(self, function_name: str, function_args: dict):
        from app.services.ai.tool_dispatch import execute_function
        return await execute_function(self, function_name, function_args)

    def _detect_output_preference(self, text: Optional[str]) -> Optional[str]:
        if not isinstance(text, str):
            return None
        lowered = text.lower()
        if "yaml" in lowered or "yml" in lowered:
            return "yaml"
        if "wide" in lowered:
            return "wide"
        if "json" in lowered:
            return "json"
        return None

    def _detect_write_intent(self, text: Optional[str]) -> bool:
        if not isinstance(text, str):
            return False
        lowered = text.lower()
        keywords = [
            "create",
            "apply",
            "delete",
            "patch",
            "scale",
            "rollout",
            "restart",
            "exec",
            "annotate",
            "label",
            "kubectl apply",
            "kubectl delete",
            "manifest",
            "deploy",
            "배포",
            "적용",
            "생성",
            "만들어",
            "만들기",
            "삭제",
            "지워",
            "패치",
            "수정",
            "스케일",
            "롤아웃",
            "재시작",
            "실행",
            "명령",
            "어노테이션",
            "라벨",
            "레이블",
        ]
        return any(k in lowered for k in keywords)

    def _mentions_events(self, text: Optional[str]) -> bool:
        if not isinstance(text, str):
            return False
        lowered = text.lower()
        return "event" in lowered or "이벤트" in lowered

    def _mentions_logs(self, text: Optional[str]) -> bool:
        if not isinstance(text, str):
            return False
        lowered = text.lower()
        return "log" in lowered or "로그" in lowered

    def _mentions_describe(self, text: Optional[str]) -> bool:
        if not isinstance(text, str):
            return False
        lowered = text.lower()
        return "describe" in lowered or "상세" in lowered or "디스크라이브" in lowered

    def _filter_tools_for_output_preference(self, tools: List[Dict], user_text: Optional[str]) -> List[Dict]:
        pref = self._detect_output_preference(user_text)
        if pref not in {"json", "wide", "yaml"}:
            return tools

        want_events = self._mentions_events(user_text)
        want_logs = self._mentions_logs(user_text)
        want_describe = self._mentions_describe(user_text)

        # Strongly prefer format-specific tools when output format is requested.
        if pref == "yaml":
            allow = {"k8s_get_resource_yaml"}
        else:
            allow = {"k8s_get_resources"}
        if want_events:
            allow.add("k8s_get_events")
        if want_logs:
            allow.add("k8s_get_pod_logs")
        if want_describe:
            allow.add("k8s_describe_resource")

        filtered = []
        for tool in tools:
            fn = tool.get("function", {}).get("name")
            if fn in allow:
                filtered.append(tool)

        # If for some reason nothing matched, fall back to original tools
        return filtered or tools

    def _render_k8s_resource_payload(self, payload) -> str:
        """k8s_get_resources 결과 포맷을 문자열로 변환"""
        try:
            if isinstance(payload, dict) and "format" in payload:
                return json.dumps(payload.get("data"), ensure_ascii=False)
            return json.dumps(payload, ensure_ascii=False)
        except Exception:
            return str(payload)
    
    def _extract_suggestions(self, message: str) -> List[str]:
        """메시지에서 제안 추출"""
        suggestions = []
        
        # "다음을 시도해보세요:", "권장사항:" 등의 패턴 찾기
        lines = message.split('\n')
        in_suggestion_block = False
        
        for line in lines:
            if any(keyword in line.lower() for keyword in ['시도', '권장', '제안', 'try', 'recommend', 'suggest']):
                in_suggestion_block = True
                continue
            
            if in_suggestion_block and line.strip().startswith(('-', '•', '*', '1.', '2.', '3.')):
                suggestions.append(line.strip().lstrip('-•*123456789. '))
        
        return suggestions[:5]  # 최대 5개
    
    async def session_chat_stream(
        self,
        session_id: str,
        message: str,
        *,
        system_prompt_override: Optional[str] = None,
        tool_filter: Optional[Callable[[list], list]] = None,
        extra_context_block: Optional[str] = None,
        title_prefix: Optional[str] = None,
        audit_actor: Optional[dict] = None,
        audit_http: Optional[dict] = None,
    ):
        async for chunk in streaming_module.session_chat_stream(
            self,
            session_id,
            message,
            system_prompt_override=system_prompt_override,
            tool_filter=tool_filter,
            extra_context_block=extra_context_block,
            title_prefix=title_prefix,
            audit_actor=audit_actor,
            audit_http=audit_http,
        ):
            yield chunk

    def _get_tools_definition(self) -> List[Dict]:
        """Tools 정의 반환 (상세한 설명 포함)"""
        tools = [
            {
                "type": "function",
                "function": {
                    "name": "get_cluster_overview",
                    "description": """Get a comprehensive overview of the entire Kubernetes cluster health.
                    
                    Returns:
                    - Total counts: namespaces, pods, services, deployments, PVCs, PVs
                    - Pod status breakdown (Running, Pending, Failed, etc.)
                    - Node count and cluster version
                    
                    Use this FIRST when user asks about cluster health or wants a general status check.""",
                    "parameters": {"type": "object", "properties": {}}
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "get_pod_metrics",
                    "description": """Get pod resource usage (CPU and memory) - equivalent to 'kubectl top pods'.
                    
                    Use this to:
                    - Check which pods are consuming the most resources
                    - Identify resource-heavy workloads
                    - Diagnose performance issues
                    - Monitor resource utilization""",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "namespace": {"type": "string", "description": "Optional namespace filter. If not provided, shows all pods across all namespaces."}
                        }
                    }
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "get_node_metrics",
                    "description": """Get node resource usage (CPU and memory) - equivalent to 'kubectl top nodes'.
                    
                    Use this to:
                    - Check node resource utilization
                    - Identify nodes under heavy load
                    - Monitor cluster capacity
                    - Diagnose node-level performance issues""",
                    "parameters": {"type": "object", "properties": {}}
                }
            }
        ]

        tools.extend(K8S_READONLY_TOOLS)
        tools.extend(K8S_WRITE_TOOLS)
        return self._filter_tools_by_role(tools)

    async def _execute_function_with_context(
        self,
        function_name: str,
        function_args: Dict,
        tool_context: ToolContext
    ) -> str:
        return await execute_function_with_context(self, function_name, function_args, tool_context)

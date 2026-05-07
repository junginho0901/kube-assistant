# streaming 회귀 — SSE 응답 형식 / yield 순서 / error path 검증.
#
# 4a (이번 PR): suggest_optimization_stream 만. 4b/4c 에서 이 파일에 chat_stream /
# session_chat_stream 테스트 추가.
#
# OpenAI / Anthropic SDK client 의 async stream 은 mock 하기 복잡 (async
# iterable + chunk.choices[0].delta.content / chunk.usage 형식). 핵심 회귀
# 가드만 단위 테스트로 cover, 실제 streaming 흐름은 e2e (ai-chat.spec) +
# 사용자 UI 검증으로.

import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.services.ai.streaming import suggest_optimization_stream


def _make_service():
    """Minimal AIService mock."""
    service = SimpleNamespace()
    service.model = "gpt-4"
    service.client = MagicMock()
    # _build_optimization_observations 는 dict 반환 (관측 표 + draft)
    service._build_optimization_observations = AsyncMock(
        return_value={
            "observations_md": "| ns | pod | cpu |\n|---|---|---|\n| default | foo | 100m |",
            "action_plan_md": "Test draft action plan",
        }
    )
    return service


def _make_stream_chunks(contents: list[str], usage=None, finish_reason="stop"):
    """OpenAI streaming chunk 형식의 async iterable mock."""
    chunks = []
    for i, content in enumerate(contents):
        is_last = i == len(contents) - 1
        delta = SimpleNamespace(content=content)
        choice = SimpleNamespace(
            delta=delta,
            finish_reason=finish_reason if is_last else None,
        )
        chunk = SimpleNamespace(
            choices=[choice],
            usage=usage if is_last else None,
        )
        chunks.append(chunk)

    class FakeStream:
        def __aiter__(self):
            return self

        def __init__(self):
            self._iter = iter(chunks)

        async def __anext__(self):
            try:
                return next(self._iter)
            except StopIteration:
                raise StopAsyncIteration

    return FakeStream()


@pytest.mark.asyncio
async def test_observations_failure_yields_error_and_done():
    """_build_optimization_observations 가 raise 하면 SSE error + DONE 으로 끝."""
    service = _make_service()
    service._build_optimization_observations = AsyncMock(
        side_effect=RuntimeError("k8s api unreachable")
    )

    events = []
    async for chunk in suggest_optimization_stream(service, "default"):
        events.append(chunk)

    assert len(events) == 2, f"expected error + DONE, got: {events}"
    # 첫 이벤트: error JSON
    assert events[0].startswith("data: ")
    payload = json.loads(events[0][len("data: "):].rstrip("\n"))
    assert payload.get("kind") == "error"
    assert "k8s api unreachable" in payload.get("error", "")
    # 둘째: DONE
    assert events[1] == "data: [DONE]\n\n"


@pytest.mark.asyncio
async def test_happy_path_yields_observed_then_answer_then_meta_then_done():
    """정상 흐름: observed → answer chunks → meta → (usage if available) → DONE."""
    service = _make_service()
    usage = SimpleNamespace(prompt_tokens=10, completion_tokens=20, total_tokens=30)
    service.client.chat.completions.create = AsyncMock(
        return_value=_make_stream_chunks(
            contents=["답변", " 시작", " 끝"], usage=usage, finish_reason="stop"
        )
    )

    events = []
    async for chunk in suggest_optimization_stream(service, "default"):
        events.append(chunk)

    # SSE payload 만 파싱
    parsed = []
    for ev in events:
        if ev == "data: [DONE]\n\n":
            parsed.append({"_done": True})
            continue
        body = ev[len("data: "):].rstrip("\n")
        parsed.append(json.loads(body))

    kinds = [p.get("kind") if not p.get("_done") else "DONE" for p in parsed]

    # observed 가 첫 번째
    assert kinds[0] == "observed"
    # answer chunks 들이 그 다음 (3개)
    assert kinds[1:4] == ["answer", "answer", "answer"]
    # meta 다음
    assert kinds[4] == "meta"
    # usage (선택적)
    assert kinds[5] == "usage"
    # DONE 마지막
    assert kinds[-1] == "DONE"

    # observed 의 content 가 markdown 표 + draft 헤더 포함
    assert "최적화 제안" in parsed[0]["content"]
    # answer content 합치면 원본 chunk 와 같음
    answer_concat = "".join(p["content"] for p in parsed[1:4])
    assert answer_concat == "답변 시작 끝"
    # usage 데이터 보존
    assert parsed[5]["usage"]["total_tokens"] == 30


@pytest.mark.asyncio
async def test_stream_create_fallback_when_stream_options_unsupported():
    """첫 client.chat.completions.create() 호출이 raise (e.g., 모델이
    stream_options 미지원) 면 stream_options 없이 재호출."""
    service = _make_service()
    usage = SimpleNamespace(prompt_tokens=5, completion_tokens=5, total_tokens=10)
    create_calls = []

    async def create_mock(**kwargs):
        create_calls.append(kwargs)
        # 첫 호출 (stream_options 포함) → 실패
        # 둘째 호출 (stream_options 없음) → 성공
        if "stream_options" in kwargs:
            raise RuntimeError("stream_options not supported by this model")
        return _make_stream_chunks(contents=["ok"], usage=usage)

    service.client.chat.completions.create = create_mock

    events = []
    async for chunk in suggest_optimization_stream(service, "default"):
        events.append(chunk)

    # 두 번 호출됨 (첫째 실패, 둘째 성공)
    assert len(create_calls) == 2
    assert "stream_options" in create_calls[0]
    assert "stream_options" not in create_calls[1]
    # 정상 종료 (DONE 포함)
    assert events[-1] == "data: [DONE]\n\n"

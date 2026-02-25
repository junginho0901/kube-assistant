import json
from typing import Any, Optional


def sse_event(event: str, data: Any, event_id: Optional[str] = None) -> str:
    payload = json.dumps(data, ensure_ascii=False)
    lines = []
    if event_id:
        lines.append(f"id: {event_id}")
    if event:
        lines.append(f"event: {event}")
    for line in payload.splitlines():
        lines.append(f"data: {line}")
    return "\n".join(lines) + "\n\n"


def sse_comment(message: str) -> str:
    return f": {message}\n\n"

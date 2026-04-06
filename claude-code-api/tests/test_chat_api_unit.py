"""Unit tests for chat API error handling."""

import json

import pytest
from fastapi import HTTPException, status

from claude_code_api.api import chat as chat_api
from claude_code_api.utils.streaming import OpenAIStreamConverter


class FakeSessionManager:
    async def update_session(self, **_kwargs):
        return None


class FailedClaudeProcess:
    def __init__(self, reason: str):
        self._reason = reason

    async def get_output(self):
        if False:
            yield {}

    def get_failure_reason(self):
        return self._reason


@pytest.mark.asyncio
async def test_collect_non_streaming_response_returns_503_on_process_failure():
    process = FailedClaudeProcess("WebSearch is not available in this environment")

    with pytest.raises(HTTPException) as exc_info:
        await chat_api._collect_non_streaming_response(
            claude_process=process,
            session_manager=FakeSessionManager(),
            session_id="sess-failed",
            model="claude-sonnet-4-5-20250929",
            project_id="proj-failed",
        )

    assert exc_info.value.status_code == status.HTTP_503_SERVICE_UNAVAILABLE
    detail = exc_info.value.detail["error"]
    assert detail["code"] == "claude_execution_failed"
    assert "WebSearch is not available" in detail["message"]


@pytest.mark.asyncio
async def test_stream_converter_emits_error_event_on_process_failure():
    converter = OpenAIStreamConverter(
        model="claude-sonnet-4-5-20250929", session_id="sess-failed"
    )
    process = FailedClaudeProcess("ToolSearch is not available in this environment")

    chunks = [chunk async for chunk in converter.convert_stream(process)]

    assert chunks[-1] == "data: [DONE]\n\n"

    error_events = []
    for chunk in chunks[:-1]:
        if not chunk.startswith("data: "):
            continue
        payload = json.loads(chunk[6:])
        if "error" in payload:
            error_events.append(payload["error"])

    assert error_events
    assert error_events[0]["type"] == "service_unavailable"
    assert "ToolSearch is not available" in error_events[0]["message"]

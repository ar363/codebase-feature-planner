import os
import json
import logging
import httpx
from dotenv import load_dotenv

from core.retrieve import query
from core.tools import tree, read_file, search_files, search_in_files, list_dir, search_in_file

load_dotenv()

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are a senior software engineer analyzing a codebase to plan feature implementation.
You have been given relevant code chunks from RAG retrieval as initial context.
You also have tools to explore the codebase further if needed.

Your final output must be a structured implementation plan in this exact format:
## Plan: [feature name]

### Files to modify
- filepath: reason

### Files to create
- filepath: reason

### Implementation steps
1. [file: specific_file.py] [lines: ~X-Y] What to do and why
2. ...

### Potential issues
- Any edge cases, breaking changes, or dependencies to watch

Do not write any code. Write precise instructions a developer can follow."""

TOOL_DEFINITIONS = [
    {
        "type": "function",
        "function": {
            "name": "tree",
            "description": "Recursively list directory structure. Use this to understand the project layout.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Path to the directory"},
                    "depth": {"type": "integer", "description": "Max recursion depth", "default": 3},
                },
                "required": ["path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_dir",
            "description": "List a single directory's contents (non-recursive) with file sizes.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Path to the directory"},
                },
                "required": ["path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "read_file",
            "description": "Read a file with line numbers. Optionally specify start_line and end_line to read a section.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Path to the file"},
                    "start_line": {"type": "integer", "description": "First line to read (1-indexed)", "default": 1},
                    "end_line": {"type": "integer", "description": "Last line to read (defaults to EOF)"},
                },
                "required": ["path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_files",
            "description": "Find files by name pattern (case-insensitive substring match). Optionally filter by extension.",
            "parameters": {
                "type": "object",
                "properties": {
                    "pattern": {"type": "string", "description": "File name pattern to search for"},
                    "path": {"type": "string", "description": "Directory to search in"},
                    "extension": {"type": "string", "description": "File extension filter (e.g. '.py')"},
                },
                "required": ["pattern", "path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_in_files",
            "description": "Search for text inside files (case-insensitive). Returns filepath:linenum: content. Capped at 50 results.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Text to search for"},
                    "path": {"type": "string", "description": "Directory to search in"},
                    "extension": {"type": "string", "description": "File extension filter (e.g. '.py')"},
                },
                "required": ["query", "path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_in_file",
            "description": "Search a single file using a regex pattern. Use this to find specific definitions, calls, or patterns.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Path to the file"},
                    "pattern": {"type": "string", "description": "Regex pattern to search for"},
                },
                "required": ["path", "pattern"],
            },
        },
    },
]

AVAILABLE_TOOLS = {
    "tree": lambda **kw: tree(kw["path"], kw.get("depth", 3)),
    "list_dir": lambda **kw: list_dir(kw["path"]),
    "read_file": lambda **kw: read_file(kw["path"], kw.get("start_line", 1), kw.get("end_line")),
    "search_files": lambda **kw: search_files(kw["pattern"], kw["path"], kw.get("extension")),
    "search_in_files": lambda **kw: search_in_files(kw["query"], kw["path"], kw.get("extension")),
    "search_in_file": lambda **kw: search_in_file(kw["path"], kw["pattern"]),
}

MAX_TOOL_RESULT_CHARS = 2000  # Cap tool results to avoid bloating context


def _get_provider_config():
    provider = os.environ.get("LLM_PROVIDER", "groq").lower().strip()
    if provider == "ollama":
        return {
            "base_url": os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434/v1").rstrip("/"),
            "model": os.environ.get("OLLAMA_MODEL", "llama3.1"),
            "api_key": "",
        }
    return {
        "base_url": "https://api.groq.com/openai/v1",
        "model": os.environ.get("GROQ_MODEL", "llama-3.3-70b-versatile"),
        "api_key": os.environ.get("GROQ_API_KEY", ""),
    }


def _make_headers(config):
    headers = {"Content-Type": "application/json"}
    if config["api_key"]:
        headers["Authorization"] = f"Bearer {config['api_key']}"
    return headers


def _build_messages(feature_request, codebase_path):
    try:
        retrieved = query(feature_request, top_k=5)
        context_parts = [
            f"--- {r['filepath']}:{r['start_line']}-{r['end_line']} ---\n{r['content']}"
            for r in retrieved
        ]
        initial_context = "\n\n".join(context_parts)
        # Cap context size to avoid token overflow
        if len(initial_context) > 3000:
            initial_context = initial_context[:3000] + "\n... [context truncated]"
    except Exception as e:
        logger.warning(f"RAG retrieval failed: {e}. Proceeding without context.")
        initial_context = "(RAG index not available — use tools to explore the codebase directly.)"

    return [
        {"role": "system", "content": SYSTEM_PROMPT},
        {
            "role": "user",
            "content": (
                f"Codebase path: {codebase_path}\n\n"
                f"Feature request: {feature_request}\n\n"
                f"Relevant code context from RAG retrieval:\n{initial_context}\n\n"
                "Use the available tools to explore the codebase further if needed, "
                "then produce a structured implementation plan."
            ),
        },
    ]


def _call_llm(config, messages, tools=None):
    """
    Makes a single non-streaming LLM call.
    Returns (content: str, tool_calls: list | None).
    Raises on HTTP or parse errors.
    """
    body = {
        "model": config["model"],
        "messages": messages,
        "stream": False,
    }
    if tools:
        body["tools"] = tools
        body["tool_choice"] = "auto"

    with httpx.Client(timeout=120) as client:
        resp = client.post(
            f"{config['base_url']}/chat/completions",
            headers=_make_headers(config),
            json=body,
        )

    if resp.status_code != 200:
        try:
            err = resp.json()
            detail = err.get("error", {}).get("message", resp.text)
        except Exception:
            detail = resp.text
        raise RuntimeError(f"LLM API error {resp.status_code}: {detail}")

    data = resp.json()
    choice = data["choices"][0]
    message = choice["message"]
    content = message.get("content") or ""
    finish_reason = choice.get("finish_reason", "")

    raw_tool_calls = message.get("tool_calls")
    if finish_reason == "tool_calls" and raw_tool_calls:
        tool_calls = [
            {
                "id": tc["id"],
                "function": {
                    "name": tc["function"]["name"],
                    "arguments": tc["function"]["arguments"],
                },
            }
            for tc in raw_tool_calls
        ]
        return content, tool_calls

    return content, None


def _call_llm_streaming(config, messages, tools=None):
    """
    Makes a streaming LLM call, yielding text chunks as they arrive.
    Returns (full_content: str, tool_calls: list | None) at the end.
    Yields ("chunk", text) tuples while streaming.
    Raises on HTTP errors.
    """
    body = {
        "model": config["model"],
        "messages": messages,
        "stream": True,
    }
    if tools:
        body["tools"] = tools
        body["tool_choice"] = "auto"

    content_buffer = ""
    # tool_calls_buffer: index -> {id, function: {name, arguments}}
    tool_calls_buffer: dict = {}
    finish_reason = None

    with httpx.Client(timeout=120) as client:
        with client.stream(
            "POST",
            f"{config['base_url']}/chat/completions",
            headers=_make_headers(config),
            json=body,
        ) as resp:
            if resp.status_code != 200:
                # Read the error body before closing
                body_bytes = b"".join(resp.iter_bytes())
                try:
                    err = json.loads(body_bytes)
                    detail = err.get("error", {}).get("message", body_bytes.decode())
                except Exception:
                    detail = body_bytes.decode()
                raise RuntimeError(f"LLM API error {resp.status_code}: {detail}")

            for line in resp.iter_lines():
                line = line.strip()
                if not line or not line.startswith("data:"):
                    continue
                payload = line[5:].strip()
                if payload == "[DONE]":
                    break
                if not payload:
                    continue

                try:
                    chunk = json.loads(payload)
                except json.JSONDecodeError:
                    continue

                choices = chunk.get("choices", [])
                if not choices:
                    continue

                choice = choices[0]
                delta = choice.get("delta", {})
                finish_reason = choice.get("finish_reason") or finish_reason

                # Accumulate text content
                text = delta.get("content") or ""
                if text:
                    content_buffer += text
                    yield ("chunk", text)

                # Accumulate tool call fragments
                for tc in (delta.get("tool_calls") or []):
                    idx = tc.get("index", 0)
                    if idx not in tool_calls_buffer:
                        tool_calls_buffer[idx] = {
                            "id": tc.get("id", ""),
                            "function": {"name": "", "arguments": ""},
                        }
                    fn = tc.get("function", {})
                    if fn.get("name"):
                        tool_calls_buffer[idx]["function"]["name"] += fn["name"]
                    if fn.get("arguments"):
                        tool_calls_buffer[idx]["function"]["arguments"] += fn["arguments"]

    # After stream ends, emit the final result
    if finish_reason == "tool_calls" and tool_calls_buffer:
        tool_calls = [tool_calls_buffer[i] for i in sorted(tool_calls_buffer.keys())]
        yield ("result", content_buffer, tool_calls)
    else:
        yield ("result", content_buffer, None)


def stream_plan(feature_request, codebase_path):
    """
    Main generator. Yields SSE-style event dicts:
      {type: "thought" | "chunk" | "tool_call" | "tool_result" | "plan_chunk" | "done" | "error", data: ...}
    """
    config = _get_provider_config()

    if not config["api_key"] and "groq.com" in config["base_url"]:
        yield {"type": "error", "data": "GROQ_API_KEY not set. Add it to .env"}
        return

    # ── Step 1: RAG retrieval ──────────────────────────────────────────────
    yield {"type": "thought", "data": "Retrieving relevant context via RAG..."}
    try:
        messages = _build_messages(feature_request, codebase_path)
    except Exception as e:
        yield {"type": "error", "data": f"Failed to build context: {e}"}
        return

    yield {"type": "thought", "data": "Starting LLM agent loop..."}

    # ── Step 2: Agentic tool-use loop (up to 5 turns) ─────────────────────
    for turn in range(5):
        yield {"type": "thought", "data": f"Analyzing codebase (turn {turn + 1})..."}

        # Always use non-streaming for tool-use turns — SSE streaming with
        # tool_calls finish_reason is unreliable across providers. We get the
        # complete structured response and surface tool calls cleanly.
        try:
            content, tool_calls = _call_llm(config, messages, tools=TOOL_DEFINITIONS)
        except Exception as e:
            yield {"type": "error", "data": f"LLM call failed (turn {turn + 1}): {e}"}
            return

        # If no tool calls → model produced the plan directly
        if not tool_calls:
            if content.strip():
                yield {"type": "plan_chunk", "data": content}
                yield {"type": "done", "data": content}
                return
            # Empty response — model may have been confused, retry
            yield {"type": "thought", "data": f"Empty response on turn {turn + 1}, retrying with explicit instruction..."}
            messages.append({"role": "user", "content": "Please provide the implementation plan now."})
            continue

        # ── Append assistant message with tool calls ───────────────────────
        messages.append({
            "role": "assistant",
            "content": content or "",
            "tool_calls": [
                {
                    "id": tc["id"],
                    "type": "function",
                    "function": {
                        "name": tc["function"]["name"],
                        "arguments": tc["function"]["arguments"],
                    },
                }
                for tc in tool_calls
            ],
        })

        # ── Execute each tool ──────────────────────────────────────────────
        for tc in tool_calls:
            name = tc["function"]["name"]
            try:
                args = json.loads(tc["function"]["arguments"])
            except (json.JSONDecodeError, TypeError):
                args = {}

            yield {"type": "tool_call", "data": {"name": name, "arguments": args}}

            fn = AVAILABLE_TOOLS.get(name)
            if fn:
                try:
                    result = fn(**args)
                    # Cap large tool outputs
                    if len(result) > MAX_TOOL_RESULT_CHARS:
                        result = result[:MAX_TOOL_RESULT_CHARS] + f"\n... [truncated, {len(result)} chars total]"
                except Exception as e:
                    result = f"Error executing tool: {e}"
            else:
                result = f"Unknown tool: {name}"

            yield {"type": "tool_result", "data": {"name": name, "result": result[:500]}}

            messages.append({
                "role": "tool",
                "tool_call_id": tc["id"],
                "content": str(result),
            })

    # ── Step 3: Final forced plan generation (no tools) ───────────────────
    yield {"type": "thought", "data": "Generating final implementation plan..."}
    try:
        content = ""
        for item in _call_llm_streaming(config, messages):   # no tools → forces text output
            if item[0] == "chunk":
                _, text = item
                content += text
                yield {"type": "plan_chunk", "data": text}
            elif item[0] == "result":
                _, content, _ = item
    except Exception as e:
        yield {"type": "error", "data": f"Final plan generation failed: {e}"}
        return

    yield {"type": "done", "data": content}


def generate_plan(feature_request, codebase_path):
    """Blocking wrapper around stream_plan for the non-streaming /plan endpoint."""
    full = ""
    for event in stream_plan(feature_request, codebase_path):
        et = event["type"]
        if et == "plan_chunk":
            full += event["data"]
        elif et == "done":
            if event["data"]:
                full = event["data"]
        elif et == "error":
            raise ValueError(event["data"])
    return full

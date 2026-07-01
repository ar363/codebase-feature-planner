import os
import json
from groq import Groq
from dotenv import load_dotenv

from core.retrieve import query
from core.tools import tree, read_file, search_files, search_in_files, list_dir, search_in_file

load_dotenv()

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


def generate_plan(feature_request, codebase_path, model="llama-3.3-70b-versatile"):
    api_key = os.environ.get("GROQ_API_KEY")
    if not api_key:
        raise ValueError("GROQ_API_KEY not set. Add it to .env or environment variables.")

    client = Groq(api_key=api_key)

    retrieved = query(feature_request, top_k=8)
    context_parts = []
    for r in retrieved:
        context_parts.append(
            f"--- {r['filepath']}:{r['start_line']}-{r['end_line']} ---\n{r['content']}"
        )
    initial_context = "\n\n".join(context_parts)

    messages = [
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

    for _ in range(5):
        response = client.chat.completions.create(
            model=model,
            messages=messages,
            tools=TOOL_DEFINITIONS,
            tool_choice="auto",
        )

        choice = response.choices[0]
        msg = choice.message

        if not msg.tool_calls:
            return msg.content

        messages.append({
            "role": "assistant",
            "content": msg.content or "",
            "tool_calls": [
                {
                    "id": tc.id,
                    "type": "function",
                    "function": {"name": tc.function.name, "arguments": tc.function.arguments},
                }
                for tc in msg.tool_calls
            ],
        })

        for tc in msg.tool_calls:
            name = tc.function.name
            try:
                args = json.loads(tc.function.arguments)
            except json.JSONDecodeError:
                args = {}

            fn = AVAILABLE_TOOLS.get(name)
            if fn:
                try:
                    result = fn(**args)
                except Exception as e:
                    result = f"Error: {e}"
            else:
                result = f"Unknown tool: {name}"

            messages.append({
                "role": "tool",
                "tool_call_id": tc.id,
                "content": str(result),
            })

    final = client.chat.completions.create(
        model=model,
        messages=messages,
    )
    return final.choices[0].message.content

import os
import re
import pickle

import chromadb
from chromadb.config import Settings
from sentence_transformers import SentenceTransformer
from rank_bm25 import BM25Okapi
import pathspec

from core.tools import SKIP_DIRS, SKIP_EXTS


DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "chroma_data")
CHROMA_DIR = os.path.join(DATA_DIR, "chroma_db")
BM25_PATH = os.path.join(DATA_DIR, "bm25_index.pkl")
CHUNKS_PATH = os.path.join(DATA_DIR, "chunks.pkl")

CODE_EXTENSIONS = {".py", ".js", ".ts", ".jsx", ".tsx", ".rs", ".go", ".java", ".kt", ".kts", ".c", ".h", ".cpp", ".hpp", ".cs", ".rb", ".php", ".swift"}
CODE_BOUNDARY = re.compile(
    r"^\s*(export\s+)?(default\s+)?(async\s+)?(function\s+\*?\s*|def\s+|class\s+|struct\s+|enum\s+|trait\s+|interface\s+|const\s+|let\s+|var\s+)"
    r"|^\s*(public|private|protected)\s+"
    r"|^\s*@\w+"
    r"|^\s*(pub\s+)?fn\s+"
    r"|^\s*func\s+"
    r"|^\s*(import|from)\s+"
)

TEXT_EXTENSIONS = {".md", ".txt", ".yaml", ".yml", ".toml", ".json", ".xml", ".html", ".css", ".scss", ".less", ".sql", ".graphql", ".mdx"}

CHUNK_SIZE = 40
CHUNK_OVERLAP = 10


def _get_language(ext):
    ext = ext.lower()
    if ext == ".py":
        return "python"
    elif ext in (".js", ".mjs", ".cjs"):
        return "javascript"
    elif ext == ".ts":
        return "typescript"
    elif ext in (".jsx",):
        return "jsx"
    elif ext in (".tsx",):
        return "tsx"
    elif ext == ".rs":
        return "rust"
    elif ext == ".go":
        return "go"
    elif ext == ".java":
        return "java"
    elif ext in (".kt", ".kts"):
        return "kotlin"
    elif ext in (".c", ".h"):
        return "c"
    elif ext in (".cpp", ".hpp"):
        return "cpp"
    elif ext == ".cs":
        return "csharp"
    elif ext == ".rb":
        return "ruby"
    elif ext == ".php":
        return "php"
    elif ext == ".swift":
        return "swift"
    elif ext == ".md":
        return "markdown"
    elif ext == ".json":
        return "json"
    elif ext == ".yaml" or ext == ".yml":
        return "yaml"
    elif ext == ".toml":
        return "toml"
    elif ext in (".txt",):
        return "text"
    else:
        return "text"


def _should_chunk_code(ext):
    return ext.lower() in CODE_EXTENSIONS


def _chunk_code(filepath, lines):
    ext = os.path.splitext(filepath)[1]
    language = _get_language(ext)
    chunks = []
    boundaries = []

    for i, line in enumerate(lines):
        if CODE_BOUNDARY.match(line):
            boundaries.append(i)

    if not boundaries:
        boundaries.append(0)

    for idx, start in enumerate(boundaries):
        end = boundaries[idx + 1] if idx + 1 < len(boundaries) else len(lines)
        content = "".join(lines[start:end]).rstrip()
        if content.strip():
            chunks.append({
                "content": content,
                "filepath": filepath,
                "start_line": start + 1,
                "end_line": end,
                "language": language,
            })

    return chunks


def _chunk_text(filepath, lines):
    ext = os.path.splitext(filepath)[1]
    language = _get_language(ext)
    chunks = []

    for start in range(0, len(lines), CHUNK_SIZE - CHUNK_OVERLAP):
        end = min(start + CHUNK_SIZE, len(lines))
        content = "".join(lines[start:end]).rstrip()
        if content.strip():
            chunks.append({
                "content": content,
                "filepath": filepath,
                "start_line": start + 1,
                "end_line": end,
                "language": language,
            })
        if end == len(lines):
            break

    return chunks


def _load_gitignore(path):
    gitignore_path = os.path.join(path, ".gitignore")
    if not os.path.isfile(gitignore_path):
        return None
    try:
        with open(gitignore_path, encoding="utf-8", errors="replace") as f:
            return pathspec.PathSpec.from_lines("gitwildmatch", f)
    except Exception:
        return None


def ingest(path):
    if not os.path.isdir(path):
        raise ValueError(f"Not a directory: {path}")

    os.makedirs(DATA_DIR, exist_ok=True)

    model = SentenceTransformer("all-MiniLM-L6-v2")
    client = chromadb.PersistentClient(path=CHROMA_DIR, settings=Settings(anonymized_telemetry=False))

    try:
        client.delete_collection("code_chunks")
    except ValueError:
        pass
    collection = client.get_or_create_collection(name="code_chunks")

    spec = _load_gitignore(path)

    chunks = []

    for root, dirs, files in os.walk(path):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        files = [f for f in files if f not in SKIP_DIRS]

        rel = os.path.relpath(root, path)
        prefix = "" if rel == "." else rel.replace("\\", "/") + "/"

        if spec:
            dirs[:] = [d for d in dirs if not spec.match_file(prefix + d)]
            files = [f for f in files if not spec.match_file(prefix + f)]

        ext_skip = SKIP_EXTS
        files = [f for f in files if os.path.splitext(f)[1].lower() not in ext_skip]

        for f in files:
            filepath = os.path.join(root, f)
            ext = os.path.splitext(f)[1].lower()

            try:
                with open(filepath, encoding="utf-8", errors="replace") as fh:
                    lines = fh.readlines()
            except (PermissionError, OSError):
                continue

            if not lines:
                continue

            if _should_chunk_code(ext):
                file_chunks = _chunk_code(filepath, lines)
            else:
                file_chunks = _chunk_text(filepath, lines)

            chunks.extend(file_chunks)

    if not chunks:
        return 0

    texts = [c["content"] for c in chunks]
    embeddings = model.encode(texts, show_progress_bar=True).tolist()

    ids = [str(i) for i in range(len(chunks))]
    metadatas = [
        {
            "filepath": c["filepath"],
            "start_line": c["start_line"],
            "end_line": c["end_line"],
            "language": c["language"],
        }
        for c in chunks
    ]
    collection.add(ids=ids, embeddings=embeddings, metadatas=metadatas, documents=texts)

    tokenized = [text.split() for text in texts]
    bm25 = BM25Okapi(tokenized)

    with open(BM25_PATH, "wb") as f:
        pickle.dump(bm25, f)

    with open(CHUNKS_PATH, "wb") as f:
        pickle.dump(chunks, f)

    return len(chunks)

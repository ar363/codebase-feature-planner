import os


SKIP_DIRS = {
    "node_modules", ".git", ".venv", "venv", "env", ".env",
    "__pycache__", "dist", "build", ".next", ".turbo",
    ".idea", ".vscode", ".bzr", ".hg", ".svn",
    "target", "vendor", ".tox", ".eggs", "eggs",
    "chroma_data",
}

SKIP_EXTS = {
    ".lock", ".sqlite3", ".sqlite", ".db",
    ".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico",
    ".woff", ".woff2", ".ttf", ".eot",
    ".zip", ".tar", ".gz", ".rar",
    ".exe", ".dll", ".so", ".dylib",
    ".pyc", ".pyo",
}


def _skip_dir(name):
    return name in SKIP_DIRS


def tree(path, depth=3):
    if not os.path.isdir(path):
        return f"Error: {path} is not a directory"

    path = os.path.abspath(path)
    lines = [os.path.basename(path) + "/"]

    def _walk(dir_path, prefix, remaining_depth):
        if remaining_depth < 0:
            lines.append(prefix + "    ...")
            return
        try:
            entries = os.listdir(dir_path)
        except PermissionError:
            lines.append(prefix + "    [permission denied]")
            return

        dirs = sorted(e for e in entries if os.path.isdir(os.path.join(dir_path, e)))
        files = sorted(e for e in entries if not os.path.isdir(os.path.join(dir_path, e)))
        all_entries = [(d, True) for d in dirs] + [(f, False) for f in files]
        all_entries = [(n, is_dir) for n, is_dir in all_entries if not _skip_dir(n)]

        for i, (entry, is_dir) in enumerate(all_entries):
            full_path = os.path.join(dir_path, entry)
            is_last = i == len(all_entries) - 1
            connector = "+-- " if is_last else "|-- "
            sub_prefix = "    " if is_last else "|   "

            if is_dir:
                lines.append(prefix + connector + entry + "/")
                _walk(full_path, prefix + sub_prefix, remaining_depth - 1)
            else:
                lines.append(prefix + connector + entry)

    _walk(path, "", depth - 1)
    return "\n".join(lines)


def list_dir(path):
    if not os.path.isdir(path):
        return f"Error: {path} is not a directory"

    entries = []
    try:
        names = os.listdir(path)
    except PermissionError:
        return "[permission denied]"

    for name in sorted(names):
        if _skip_dir(name):
            continue
        full = os.path.join(path, name)
        if os.path.isdir(full):
            entries.append(f"{name}/")
        else:
            size = os.path.getsize(full)
            entries.append(f"{name}  ({size} bytes)")

    return "\n".join(entries) if entries else "(empty)"


def search_in_file(path, pattern):
    if not os.path.isfile(path):
        return f"Error: {path} is not a file"

    import re
    try:
        regex = re.compile(pattern)
    except re.error as e:
        return f"Invalid regex: {e}"

    results = []
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            for i, line in enumerate(f, 1):
                stripped = line.rstrip()
                if regex.search(stripped):
                    results.append(f"{i}: {stripped}")
    except (PermissionError, OSError) as e:
        return f"Error reading file: {e}"

    if not results:
        return "No matches found."
    return "\n".join(results)


def read_file(path, start_line=1, end_line=None):
    if not os.path.isfile(path):
        return f"Error: {path} is not a file"

    with open(path, encoding="utf-8", errors="replace") as f:
        lines = f.readlines()

    total = len(lines)
    if start_line < 1:
        start_line = 1
    if end_line is None or end_line > total:
        end_line = total

    result = []
    for i in range(start_line - 1, end_line):
        result.append(f"{i + 1}: {lines[i].rstrip()}")

    return "\n".join(result)


def search_files(pattern, path, extension=None):
    if not os.path.isdir(path):
        return f"Error: {path} is not a directory"

    matches = []
    pattern_lower = pattern.lower()

    for root, dirs, files in os.walk(path):
        dirs[:] = [d for d in dirs if not _skip_dir(d)]
        for f in files:
            if pattern_lower in f.lower():
                if extension is None or f.endswith(extension):
                    matches.append(os.path.join(root, f))

    if not matches:
        return "No files found."
    return "\n".join(sorted(matches))


def search_in_files(query, path, extension=None):
    if not os.path.isdir(path):
        return f"Error: {path} is not a directory"

    results = []
    query_lower = query.lower()

    for root, dirs, files in os.walk(path):
        dirs[:] = [d for d in dirs if not _skip_dir(d)]
        for f in files:
            if extension and not f.endswith(extension):
                continue
            filepath = os.path.join(root, f)
            try:
                with open(filepath, encoding="utf-8", errors="replace") as fh:
                    for i, line in enumerate(fh, 1):
                        if query_lower in line.lower():
                            results.append(f"{filepath}:{i}: {line.rstrip()}")
                            if len(results) >= 50:
                                return "\n".join(results)
            except (PermissionError, OSError):
                continue

    if not results:
        return "No matches found."
    return "\n".join(results)

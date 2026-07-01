import os
import fnmatch


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
            entries = sorted(os.listdir(dir_path))
        except PermissionError:
            lines.append(prefix + "    [permission denied]")
            return

        for i, entry in enumerate(entries):
            full_path = os.path.join(dir_path, entry)
            is_last = i == len(entries) - 1
            connector = "+-- " if is_last else "|-- "
            sub_prefix = "    " if is_last else "|   "

            if os.path.isdir(full_path):
                lines.append(prefix + connector + entry + "/")
                _walk(full_path, prefix + sub_prefix, remaining_depth - 1)
            else:
                lines.append(prefix + connector + entry)

    _walk(path, "", depth - 1)
    return "\n".join(lines)


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
        dirs[:] = [d for d in dirs if not d.startswith(".")]
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
        dirs[:] = [d for d in dirs if not d.startswith(".")]
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

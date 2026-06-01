# tools/list/main.py
# Python 3.10+; запуск:  python tools/list/main.py  --root .  --out tree.txt  --list files.txt
# (исторически) Python 3.10+; запуск:  python tools/list.py  --root .  --out tree.txt  --list files.txt  --json files.json
# Изменён так, чтобы файлы dump/ по умолчанию создавались в папке самого скрипта (tools).
# Сейчас: дамп только в txt; дерево можно отключить константой ENABLE_TREE_DUMP.

import os
import sys
import fnmatch
import argparse
from pathlib import Path
from typing import List

# Можно отключить генерацию ASCII-дерева, если поставить в False
ENABLE_TREE_DUMP = True

DEFAULT_IGNORES = [
    ".git", ".hg", ".svn",
    "__pycache__", ".pytest_cache", ".mypy_cache",
    "venv", ".venv", "env", ".env",
    "build", "dist", ".idea", ".vscode",
    "*.pyc", "*.pyo", "*.pyd", "*.orig",
    "*.log", "*.tmp", "_archive", "_archive",
    "main.build", "main.dist", "_logs", "_out", "_tmp", "_work",
    "logs", "pyinstxtractor", "logs", "%SCONS_INLINE%", "nuitka-cache",
    # "tools",
    "documents", "upx", "onefile_dump",
    "*.png", "__init__.py", "node_modules",
]

def parse_args():
    p = argparse.ArgumentParser(
        description="Сделать список всех файлов проекта и древо каталогов."
    )
    # Корень проекта: по умолчанию определяется автоматически от расположения скрипта
    p.add_argument(
        "--root",
        default=None,
        help="Корень проекта. По умолчанию ищется от местоположения скрипта вверх (по .git / pyproject.toml и т.п.).",
    )
    # По умолчанию создаём рядом со скриптом: tree.txt и files.txt
    p.add_argument(
        "--out",
        default="tree.txt",
        help="Файл для ASCII-дерева.",
    )
    p.add_argument(
        "--list",
        dest="list_out",
        default="files.txt",
        help="Файл для плоского списка путей.",
    )
    p.add_argument(
        "--max-depth",
        type=int,
        default=0,
        help="Ограничить глубину дерева (0 = без ограничений).",
    )
    p.add_argument(
        "--ignore",
        action="append",
        default=[],
        help="Паттерн(ы) игнора (можно указывать несколько раз).",
    )
    return p.parse_args()

def _split_patterns(extra: List[str]) -> List[str]:
    out: List[str] = []
    for s in extra:
        for token in s.split(";"):
            t = token.strip()
            if t:
                out.append(t)
    return out

def should_ignore(path: Path, patterns: List[str]) -> bool:
    # игнор по любому компоненту пути или по целому относительному пути
    rel = str(path).replace("\\", "/")
    parts = rel.split("/")
    for pat in patterns:
        if fnmatch.fnmatch(rel, pat):
            return True
        for part in parts:
            if fnmatch.fnmatch(part, pat):
                return True
    return False

def natural_sort_key(name: str):
    import re
    return [
        int(text) if text.isdigit() else text.lower()
        for text in re.split(r"(\d+)", name)
    ]

def detect_project_root(start: Path) -> Path:
    """
    Пытаемся найти корень проекта, поднимаясь вверх от start.
    Ищем маркеры репозитория / проекта: .git, pyproject.toml, setup.cfg, requirements.txt.
    Если ничего не нашли — если видим структуру .../tools/list, считаем корнем родителя tools.
    В крайнем случае возвращаем start.
    """
    markers_dirs = [".git", ".hg", ".svn"]
    markers_files = ["pyproject.toml", "setup.cfg", "requirements.txt"]

    for p in [start] + list(start.parents):
        for d in markers_dirs:
            if (p / d).exists():
                return p
        for f in markers_files:
            if (p / f).exists():
                return p

    # Хардкод под типичный случай: .../PROJECT/tools/list/main.py
    if start.name == "list" and start.parent.name == "tools":
        return start.parent.parent

    return start

def walk_tree(root: Path, patterns: List[str], max_depth: int = 0):
    root = root.resolve()
    R = len(str(root))

    def _rel(p: Path) -> str:
        s = str(p)[R + 1 :] if str(p).startswith(str(root)) else str(p)
        return s.replace("\\", "/")

    dirs: List[str] = []
    files: List[str] = []

    for dirpath, dirnames, filenames in os.walk(root):
        dpath = Path(dirpath)

        # фильтруем dirnames in-place, чтобы os.walk не заходил внутрь игнора
        dirnames[:] = [
            d for d in dirnames
            if not should_ignore(dpath / d, patterns)
        ]
        dirnames.sort(key=natural_sort_key)

        # ограничение глубины
        if max_depth > 0:
            depth_rel = _rel(dpath)
            depth = len(depth_rel.split("/")) if depth_rel else 0
            if depth >= max_depth:
                dirnames[:] = []  # не углубляемся дальше

        # директории
        if dpath != root:
            dirs.append(_rel(dpath))

        # файлы
        for fn in sorted(filenames, key=natural_sort_key):
            p = dpath / fn
            if should_ignore(p, patterns):
                continue
            files.append(_rel(p))

    return dirs, files

def draw_tree(root: Path, dirs: List[str], files: List[str]) -> str:
    # построим структуру каталогов
    tree = {"name": root.name, "children": {}, "files": []}

    def insert_path(container, rel_parts: List[str], is_file: bool):
        if not rel_parts:
            return
        head = rel_parts[0]
        if len(rel_parts) == 1 and is_file:
            container.setdefault("files", []).append(head)
            return
        children = container.setdefault("children", {})
        node = children.setdefault(
            head, {"name": head, "children": {}, "files": []}
        )
        insert_path(node, rel_parts[1:], is_file)

    for d in dirs:
        parts = d.split("/") if d else []
        if parts:
            insert_path(tree, parts, is_file=False)
    for f in files:
        parts = f.split("/") if f else []
        if parts:
            insert_path(tree, parts, is_file=True)

    # печать ASCII
    lines: List[str] = [root.name]

    def render(node, prefix: str = ""):
        # печатаем подпапки
        keys = sorted(node.get("children", {}).keys(), key=natural_sort_key)
        total = len(keys) + len(node.get("files", []))
        idx = 0

        for k in keys:
            idx += 1
            last = (idx == total and len(node.get("files", [])) == 0)
            branch = "└── " if last else "├── "
            lines.append(prefix + branch + k)
            new_prefix = prefix + ("    " if last else "│   ")
            render(node["children"][k], new_prefix)

        # файлы
        files_sorted = sorted(node.get("files", []), key=natural_sort_key)
        for i, fname in enumerate(files_sorted, 1):
            last = (idx + i == total)
            branch = "└── " if last else "├── "
            lines.append(prefix + branch + fname)

    render(tree, "")
    return "\n".join(lines)

def main():
    args = parse_args()

    # Папка со скриптом (например .../tools/list); сюда кладём tree.txt и files.txt
    script_dir = Path(__file__).parent.resolve()

    # Корень проекта:
    #  - если передан --root, берём его (относительно текущей CWD),
    #  - иначе детектим автоматически от расположения скрипта.
    if args.root is not None:
        root = Path(args.root).resolve()
    else:
        root = detect_project_root(script_dir)

    patterns = DEFAULT_IGNORES + _split_patterns(args.ignore)

    if not root.exists():
        print(f"[E] root not found: {root}", file=sys.stderr)
        sys.exit(2)

    dirs, files = walk_tree(root, patterns, max_depth=args.max_depth)

    # Файлы результата — рядом со скриптом
    def make_output_path(p: str) -> Path:
        ppath = Path(p)
        return ppath if ppath.is_absolute() else (script_dir / ppath)

    out_path = make_output_path(args.out) if ENABLE_TREE_DUMP else None
    list_path = make_output_path(args.list_out)

    # ASCII tree (по флагу)
    ascii_tree = None
    if ENABLE_TREE_DUMP:
        ascii_tree = draw_tree(root, dirs, files)

    # Создаём родительские каталоги для каждого целевого файла
    for out_path_item in (out_path, list_path):
        if out_path_item is None:
            continue
        parent = out_path_item.parent
        if parent and not parent.exists():
            parent.mkdir(parents=True, exist_ok=True)

    # Запись файлов
    if ENABLE_TREE_DUMP and ascii_tree is not None and out_path is not None:
        out_path.write_text(ascii_tree, encoding="utf-8")

    # список файлов всегда пишем
    list_path.write_text("\n".join(files), encoding="utf-8")

    # краткий вывод
    if ENABLE_TREE_DUMP and out_path is not None:
        print(f"[OK] tree -> {out_path}")
    print(f"[OK] list -> {list_path}  (files: {len(files)})")
    print(f"[OK] root = {root}")

if __name__ == "__main__":
    main()

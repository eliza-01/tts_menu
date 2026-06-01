#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# tools/dump/main.py

"""
Собирает код проекта в один файл, разделяя блоки путями исходных файлов.
Разделитель: строка вида `# server/src/index.ts`

Корень проекта:
1) --root
2) PROJECT_ROOT (env)
3) git rev-parse --show-toplevel
4) Подъём вверх от файла скрипта до каталога с .git / package.json / pyproject.toml
5) CWD

ВАЖНО: файл дампа создаётся рядом со скриптом (по умолчанию project_bundle.txt).
Если --out относительный — он считается относительно директории скрипта.
"""

from __future__ import annotations
import argparse
import os
import subprocess
from pathlib import Path
from typing import Iterable, Set, List, Optional

# =========================
# ====== Х Е Д Е Р ========
# =========================

# True — собрать все файлы из каталогов INCLUDE["dirs"] (плюс INCLUDE["files"])
# False — собрать только файлы из INCLUDE["files"]
ALL_FILES: bool = True

IGNORE_FILES: Set[str] = {
    "inline-assets.json",

    "icons.json",
    "items.json",
    "plan.json",
    # "index.html",
    # "package-lock.json",

    "pnpm-lock.yaml", "yarn.lock", }

# Пути ОТНОСИТЕЛЬНО КОРНЯ ПРОЕКТА
INCLUDE = {
    "dirs": [
        # "server/src",
        "static",
        "templates",
        # "web/admin",

        # "server/src/modules/admin",

        # "server/src/modules/duels",
        # "server/utils/bridge",

        # "tools/list/files.txt",
    ],
    "files": [
        "app.py",
        # "server/package-lock.json",
        # "server/tsconfig.json",
        # ".env.example",
        # "server/Dockerfile",
        # "docker-compose.yml",
    ],
}

# Игнор
IGNORE_DIRS: Set[str] = {
    "css",
    "admin",

    "node_modules", ".git", "dist", "build", ".next", ".turbo",
    ".idea", ".vscode", "__pycache__", ".cache", "coverage", "venv", "db"
}

# Разрешённые расширения (пустое множество => разрешены все)
ALLOWED_EXTS: Set[str] = {
    ".ts", ".tsx", ".js", ".mjs", ".cjs",
    ".json", ".html", ".css",
    ".sql", ".sh",
    ".yml", ".yaml",
    ".md", ".txt",
    ".env", "py",
}

# Ограничение на размер одного файла (байты), 0 = без ограничения
MAX_FILE_SIZE_BYTES: int = 0

# Имя выходного файла по умолчанию (создаётся РЯДОМ СО СКРИПТОМ)
DEFAULT_OUTPUT: str = "project_bundle.txt"

# =========================
# ====== Р Е А Л И З ======
# =========================

def detect_project_root(cli_root: Optional[str]) -> Path:
    if cli_root:
        return Path(cli_root).expanduser().resolve()

    env_root = os.getenv("PROJECT_ROOT")
    if env_root:
        return Path(env_root).expanduser().resolve()

    try:
        out = subprocess.check_output(
            ["git", "rev-parse", "--show-toplevel"],
            stderr=subprocess.DEVNULL,
            text=True,
        ).strip()
        if out:
            p = Path(out).resolve()
            if p.exists():
                return p
    except Exception:
        pass

    here = Path(__file__).resolve()
    for p in [*here.parents]:
        if (p / ".git").exists() or (p / "package.json").exists() or (p / "pyproject.toml").exists():
            return p

    cwd = Path.cwd().resolve()
    for p in [cwd, *cwd.parents]:
        if (p / ".git").exists() or (p / "package.json").exists() or (p / "pyproject.toml").exists():
            return p

    return cwd

def is_allowed_file(path: Path) -> bool:
    name = path.name
    if name in IGNORE_FILES:
        return False
    if path.is_symlink():
        return False
    if not ALLOWED_EXTS:
        return True
    if name.lower() == "dockerfile":
        return True
    return path.suffix.lower() in ALLOWED_EXTS

def walk_dir_collect_files(base: Path, root: Path) -> Iterable[Path]:
    if not base.exists():
        return []
    files: List[Path] = []
    for dirpath, dirnames, filenames in os.walk(base, topdown=True):
        dirnames[:] = [d for d in dirnames if d not in IGNORE_DIRS]
        for fname in filenames:
            p = Path(dirpath) / fname
            if not p.is_file():
                continue
            try:
                rel = p.resolve().relative_to(root)
            except Exception:
                continue
            if any(part in IGNORE_DIRS for part in rel.parts):
                continue
            if not is_allowed_file(p):
                continue
            if MAX_FILE_SIZE_BYTES and p.stat().st_size > MAX_FILE_SIZE_BYTES:
                continue
            files.append(p)
    return files

def unique_paths(paths: Iterable[Path]) -> List[Path]:
    seen: Set[str] = set()
    result: List[Path] = []
    for p in paths:
        key = str(p.resolve())
        if key not in seen:
            seen.add(key)
            result.append(p)
    return result

def read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8-sig", errors="strict")
    except UnicodeDecodeError:
        return path.read_text(encoding="utf-8", errors="replace")

def main() -> None:
    parser = argparse.ArgumentParser(description="Сборка проекта в один файл")
    parser.add_argument("--root", default=None, help="Корень проекта (если не задан — автоопределение)")
    parser.add_argument("--out", default=DEFAULT_OUTPUT, help=f"Имя выходного файла (создаётся рядом со скриптом, по умолчанию {DEFAULT_OUTPUT})")
    args = parser.parse_args()

    # project_root = detect_project_root(args.root)
    project_root = Path(__file__).resolve().parents[2]  # Жёстко от корня проекта

    # Дамп создаём РЯДОМ СО СКРИПТОМ
    script_dir = Path(__file__).resolve().parent
    out_path = Path(args.out)
    if not out_path.is_absolute():
        out_path = (script_dir / out_path).resolve()
    else:
        out_path = out_path.resolve()

    # Собираем файлы (пути относительно КОРНЯ ПРОЕКТА)
    to_collect: List[Path] = []
    if ALL_FILES:
        for d in INCLUDE.get("dirs", []):
            base = (project_root / d).resolve()
            to_collect.extend(walk_dir_collect_files(base, project_root))
        for f in INCLUDE.get("files", []):
            p = (project_root / f).resolve()
            if p.exists() and p.is_file() and is_allowed_file(p):
                to_collect.append(p)
    else:
        for f in INCLUDE.get("files", []):
            p = (project_root / f).resolve()
            if p.exists() and p.is_file() and is_allowed_file(p):
                to_collect.append(p)

    to_collect = unique_paths(to_collect)
    to_collect.sort(key=lambda p: p.resolve().relative_to(project_root).as_posix())

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8", newline="\n") as out:
        header = f"# Bundled from project root: {project_root.as_posix()}\n"
        out.write(header + "\n")
        for i, p in enumerate(to_collect):
            rel = p.resolve().relative_to(project_root).as_posix()
            out.write(f"# {rel}\n")
            try:
                content = read_text(p)
            except Exception as e:
                content = f"<<ERROR READING FILE: {e}>>"
            out.write(content.rstrip() + "\n")
            if i != len(to_collect) - 1:
                out.write("\n")

    print(f"OK: собрано файлов: {len(to_collect)} → {out_path}")
    print(f"ROOT = {project_root.as_posix()}")
    print(f"SCRIPT_DIR = {script_dir.as_posix()}")

if __name__ == "__main__":
    main()

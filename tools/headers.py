# tools/headers.py
from __future__ import annotations
import sys, re, os
from pathlib import Path, PurePosixPath

IGNORED_DIRS = {
    "venv",
    ".venv",
    "env",
    ".env",
    "virtualenv",
    ".virtualenv",
    "__pycache__",
    ".git",
    ".idea",
    "_tmp",
    "build",
    "dist",
    "node_modules",
    "nuitka-cache",
}
ENCODING_RE = re.compile(r"coding[:=]\s*([-\w.]+)")
# Поддержка: "# path", "// path", "/* path */", "<!-- path -->"
PATH_HEADER_RE = re.compile(
    r"^(?:#|//|/\*|<!--)\s+([A-Za-z0-9_\-./\\]+?\.[A-Za-z0-9]+)\s*(?:\*/|-->)?\s*$"
)

PROJECT_MARKERS = {
    ".git",
    "pyproject.toml",
    "package.json",
    "requirements.txt",
    "setup.py",
}

def detect_encoding(lines: list[str]) -> str | None:
    # PEP 263: cookie must be on line 1 или 2
    rng = lines[:2] if lines else []
    for ln in rng:
        m = ENCODING_RE.search(ln)
        if m:
            return m.group(1)
    return None


def read_text_any(p: Path) -> tuple[str, str]:
    # Try utf-8-sig, then cp1251, then latin-1
    for enc in ("utf-8-sig", "cp1251", "latin-1"):
        try:
            text = p.read_text(encoding=enc)
            return text, enc
        except Exception:
            continue
    # Fallback binary
    data = p.read_bytes()
    return data.decode("utf-8", errors="replace"), "utf-8"


def write_text(p: Path, text: str, enc_hint: str | None):
    enc = enc_hint or "utf-8"
    p.write_text(text, encoding=enc, newline="\n")


def is_ignored_dir(path: Path) -> bool:
    name = path.name

    if name in IGNORED_DIRS:
        return True

    # Пропускаем любые Python virtualenv-каталоги, даже если они названы нестандартно
    if (path / "pyvenv.cfg").exists():
        return True

    return False

def _commented_header_for(path: Path, rel_posix: str) -> str:
    suf = path.suffix.lower()
    if suf in (".js", ".jsx", ".ts", ".tsx"):
        return f"// {rel_posix}"
    if suf == ".css":
        return f"/* {rel_posix} */"
    if suf == ".html":
        return f"<!-- {rel_posix} -->"
    # по умолчанию — как для .py
    return f"# {rel_posix}"


def compute_header(root: Path, file_path: Path) -> str:
    rel_posix = PurePosixPath(file_path.relative_to(root)).as_posix()
    return _commented_header_for(file_path, rel_posix)


def place_header(lines: list[str], header: str, suffix: str | None = None) -> tuple[list[str], bool]:
    if not lines:
        return [header + "\n"], True

    # спец-случаи начала файла
    shebang = lines[0].startswith("#!")
    enc_on_line1 = ENCODING_RE.search(lines[0]) is not None
    enc_on_line2 = len(lines) > 1 and ENCODING_RE.search(lines[1]) is not None
    css_charset_on_line1 = lines[0].lstrip().startswith("@charset")
    html_doctype_on_line1 = lines[0].lstrip().lower().startswith("<!doctype")

    # Если path-хедер уже есть в первых 3 строках — заменим
    header_idx = None
    for idx in range(min(3, len(lines))):
        if PATH_HEADER_RE.match(lines[idx].rstrip("\r\n")):
            header_idx = idx
            break

    if header_idx is not None:
        if lines[header_idx].rstrip("\r\n") == header:
            return lines, False
        new_lines = lines[:]
        new_lines[header_idx] = header + "\n"
        return new_lines, True

    # Индекс вставки с учётом shebang/encoding cookie/@charset/DOCTYPE
    insert_at = 0
    if shebang:
        insert_at = 1
        if enc_on_line2:
            insert_at = 2
    else:
        if enc_on_line1:
            insert_at = 1
        # Для CSS: не ломаем @charset — он должен идти первым
        if (suffix or "").lower() == ".css" and css_charset_on_line1:
            insert_at = max(insert_at, 1)
        # Для HTML: не ломаем <!DOCTYPE ...> — обычно он должен идти первым
        if (suffix or "").lower() == ".html" and html_doctype_on_line1:
            insert_at = max(insert_at, 1)

    # Уже стоит ровно этот хедер на целевой позиции?
    if insert_at < len(lines) and lines[insert_at].rstrip("\r\n") == header:
        return lines, False

    new_lines = lines[:insert_at] + [header + "\n"] + lines[insert_at:]
    return new_lines, True


def process_file(root: Path, p: Path) -> tuple[bool, str]:
    text, enc_read = read_text_any(p)
    lines = text.splitlines(keepends=False)
    header = compute_header(root, p)
    new_lines, changed = place_header(lines, header, p.suffix.lower())
    if changed:
        enc_cookie = detect_encoding(lines) if p.suffix.lower() == ".py" else None
        body = "\n".join(ln.rstrip("\r\n") for ln in new_lines)
        if not body.endswith("\n"):
            body += "\n"
        write_text(p, body, enc_cookie or enc_read)
    return changed, header


def _find_default_root() -> Path:
    """
    Ищем корень проекта, поднимаясь от текущей рабочей директории вверх.
    Скрипт может лежать где угодно — важно, откуда его запустили.

    Если нашли .git / pyproject.toml / package.json и т.п. — используем этот каталог.
    Если не нашли — используем текущую директорию.
    """
    here = Path.cwd().resolve()

    for candidate in (here, *here.parents):
        if any((candidate / marker).exists() for marker in PROJECT_MARKERS):
            return candidate

    return here


def main():
    if len(sys.argv) > 1:
        root = Path(sys.argv[1]).resolve()
    else:
        root = _find_default_root()

    if not root.exists():
        print(f"[ERR] Root not found: {root}")
        sys.exit(2)

    if not root.is_dir():
        print(f"[ERR] Root is not a directory: {root}")
        sys.exit(2)

    changed_cnt = 0
    total = 0

    allowed_suffixes = {".py", ".js", ".jsx", ".ts", ".tsx", ".css", ".html"}

    for dirpath, dirnames, filenames in os.walk(root):
        current_dir = Path(dirpath)

        # Не заходим в venv, .venv, node_modules, .git и похожие каталоги
        dirnames[:] = [
            dirname
            for dirname in dirnames
            if not is_ignored_dir(current_dir / dirname)
            and not dirname.startswith(".")
        ]

        for filename in filenames:
            p = current_dir / filename

            if p.suffix.lower() not in allowed_suffixes:
                continue

            total += 1

            try:
                changed, header = process_file(root, p)
                if changed:
                    changed_cnt += 1
                    print(f"[UPDATED] {p}  ->  {header}")
                else:
                    print(f"[OK]      {p}")
            except Exception as e:
                print(f"[SKIP]    {p}  ({e})")

    print(f"\nDone. {changed_cnt} updated of {total} files.")


if __name__ == "__main__":
    main()

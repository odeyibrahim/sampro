#!/usr/bin/env python3
"""
Safe, conservative minifier for the V. Gallery build.

This intentionally does NOT rename identifiers or rewrite control flow — it
only strips comments and collapses insignificant whitespace, using a small
character-level state machine that is aware of JS strings, template
literals, and regex literals so it never mangles content that only looks
like a comment. This is what lets it run safely offline without a real JS
parser (terser/esbuild) available.

For full mangling + real obfuscation (recommended for production), run the
`build` script in package.json in an environment with npm registry access.
"""
import re
import sys


def minify_css(src: str) -> str:
    # Strip /* ... */ comments (CSS has no other comment syntax).
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.DOTALL)
    # Collapse whitespace runs to a single space.
    src = re.sub(r"[ \t\r\n]+", " ", src)
    # Tidy punctuation spacing.
    src = re.sub(r"\s*([{}:;,])\s*", r"\1", src)
    src = re.sub(r";}", "}", src)
    return src.strip()


def minify_js(src: str) -> str:
    out = []
    i, n = 0, len(src)
    prev_significant = ""  # last non-space char emitted, used for regex-vs-division heuristic
    while i < n:
        c = src[i]

        # Line comment
        if c == "/" and i + 1 < n and src[i + 1] == "/":
            j = src.find("\n", i)
            i = n if j == -1 else j
            continue

        # Block comment
        if c == "/" and i + 1 < n and src[i + 1] == "*":
            j = src.find("*/", i + 2)
            i = n if j == -1 else j + 2
            continue

        # String literals
        if c in ("'", '"'):
            start = i
            i += 1
            while i < n:
                if src[i] == "\\":
                    i += 2
                    continue
                if src[i] == c:
                    i += 1
                    break
                i += 1
            out.append(src[start:i])
            prev_significant = c
            continue

        # Template literals (do not attempt to parse ${...} internals separately;
        # left intact verbatim so nested expressions are never touched)
        if c == "`":
            start = i
            i += 1
            while i < n:
                if src[i] == "\\":
                    i += 2
                    continue
                if src[i] == "`":
                    i += 1
                    break
                i += 1
            out.append(src[start:i])
            prev_significant = "`"
            continue

        # Regex literal heuristic: '/' following an operator/keyword-ish context
        if c == "/" and prev_significant in ("", "(", ",", "=", ":", "[", "!", "&", "|", "?", "{", ";", "\n", "+", "-", "*", "%", "<", ">", "^", "~"):
            start = i
            i += 1
            in_class = False
            while i < n:
                if src[i] == "\\":
                    i += 2
                    continue
                if src[i] == "[":
                    in_class = True
                elif src[i] == "]":
                    in_class = False
                elif src[i] == "/" and not in_class:
                    i += 1
                    break
                i += 1
            out.append(src[start:i])
            prev_significant = "/"
            continue

        out.append(c)
        if not c.isspace():
            prev_significant = c
        i += 1

    text = "".join(out)
    # Collapse blank/whitespace-only lines and trailing spaces (safe: never
    # merges two lines into one, so ASI semantics are preserved).
    lines = [ln.rstrip() for ln in text.split("\n")]
    lines = [ln for ln in lines if ln.strip() != ""]
    return "\n".join(lines)


def main():
    if len(sys.argv) != 4 or sys.argv[1] not in ("css", "js"):
        print("usage: minify.py <css|js> <in> <out>", file=sys.stderr)
        sys.exit(1)
    kind, src_path, dst_path = sys.argv[1], sys.argv[2], sys.argv[3]
    with open(src_path, "r", encoding="utf-8") as f:
        src = f.read()
    result = minify_css(src) if kind == "css" else minify_js(src)
    with open(dst_path, "w", encoding="utf-8") as f:
        f.write(result)
    print(f"{src_path} -> {dst_path} ({len(src)} -> {len(result)} bytes)")


if __name__ == "__main__":
    main()

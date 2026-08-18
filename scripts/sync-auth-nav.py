from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NEW_LINK = """<a class="auth-account-link" href="/account">
              <span data-account-name>My Account</span>
              <small data-account-email></small>
            </a>"""
OLD_LINKS = [
    '<a href="/account.html">My Account</a>',
    '<a href="/account">My Account</a>',
]
VERSIONS = ("19", "23", "24", "25", "26")


def process(path: Path) -> bool:
    original = path.read_text(encoding="utf-8")
    text = original
    for old in OLD_LINKS:
        text = text.replace(old, NEW_LINK)
    for version in VERSIONS:
        text = text.replace(f"account.js?v={version}", "account.js?v=27")
    if text == original:
        return False
    path.write_text(text, encoding="utf-8")
    return True


def main():
    changed = []
    for path in ROOT.rglob("*.html"):
        if "node_modules" in path.parts:
            continue
        if process(path):
            changed.append(path.relative_to(ROOT).as_posix())
    print(f"Updated {len(changed)} files")
    for name in changed:
        print(f"  {name}")


if __name__ == "__main__":
    main()

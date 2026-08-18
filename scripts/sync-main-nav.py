import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NAV_RE = re.compile(
    r'(<nav\b[^>]*\bclass="[^"]*\bmain-nav\b[^"]*"[^>]*>)([\s\S]*?)(</nav>)',
    re.I,
)


def current_keys(path: Path) -> set[str]:
    relative = path.relative_to(ROOT).as_posix().lower()
    name = path.name.lower()
    keys = set()
    if name == "index.html" and relative == "index.html":
        keys.add("home")
    if name == "used-tires.html":
        keys.add("used")
    if name == "new-tires.html":
        keys.add("new")
    if name in {"appointment.html", "appointment-success.html", "appointment-cancelled.html"}:
        keys.add("appointment")
    if name in {"local-installers.html", "installer-application.html"}:
        keys.add("installers")
    if name == "tire-cart.html":
        keys.add("tire-cart")
    if name == "cart.html":
        keys.add("appointment-cart")
    if name == "login.html":
        keys.add("login")
    if name == "signup.html":
        keys.add("signup")
    if name == "account.html":
        keys.add("account")
    return keys


def mark(keys: set[str], key: str) -> str:
    return ' aria-current="page"' if key in keys else ""


def nav_inner(keys: set[str], indent: str) -> str:
    child = indent + "  "
    tires_class = "nav-dropdown is-current" if keys & {"used", "new"} else "nav-dropdown"
    account_current = mark(keys, "account")
    login_current = mark(keys, "login")
    signup_current = mark(keys, "signup")
    return f"""
{child}<a href="/"{mark(keys, "home")}>Home</a>
{child}<div class="{tires_class}">
{child}  <button class="nav-dropdown-toggle" type="button" aria-expanded="false" aria-haspopup="true">Tires</button>
{child}  <div class="nav-dropdown-menu">
{child}    <a href="/used-tires"{mark(keys, "used")}>Used Tires</a>
{child}    <a href="/new-tires"{mark(keys, "new")}>New Tires</a>
{child}  </div>
{child}</div>
{child}<a href="/appointment"{mark(keys, "appointment")}>Appointment</a>
{child}<a href="/local-installers"{mark(keys, "installers")}>Local Installers</a>
{child}<a href="/#contact">Contact</a>
{child}<span class="nav-carts" aria-label="Shopping carts">
{child}  <a href="/tire-cart"{mark(keys, "tire-cart")}>Tire Cart<span data-tire-cart-count></span></a>
{child}  <a href="/cart"{mark(keys, "appointment-cart")}>Appointment Cart<span data-appointment-cart-count></span></a>
{child}</span>
{child}<span class="auth-nav-group" data-auth-logged-out>
{child}  <a href="/signup"{signup_current}>Sign Up</a>
{child}  <a href="/login"{login_current}>Log In</a>
{child}</span>
{child}<span class="auth-nav-group" data-auth-logged-in hidden>
{child}  <a class="auth-account-link" href="/account"{account_current}>
{child}    <span data-account-name>My Account</span>
{child}    <small data-account-email></small>
{child}  </a>
{child}  <button class="auth-link-button" type="button" data-logout-button>Log Out</button>
{child}</span>
{indent}"""


def bump_versions(text: str) -> str:
    text = re.sub(r"styles\.css(?:\?v=\d+)?", "styles.css?v=6", text)
    text = text.replace("account.js?v=27", "account.js?v=28")
    text = text.replace("inventory.js?v=45", "inventory.js?v=46")
    text = text.replace("tire-cart.js?v=14", "tire-cart.js?v=15")
    text = text.replace("mobile-menu.js?v=1", "mobile-menu.js?v=2")
    return text


def process(path: Path) -> bool:
    original = path.read_text(encoding="utf-8")
    if "class=" not in original or "main-nav" not in original:
        text = bump_versions(original)
        if text == original:
            return False
        path.write_text(text, encoding="utf-8")
        return True

    keys = current_keys(path)

    def replace_nav(match: re.Match[str]) -> str:
        open_tag = match.group(1)
        line_start = original.rfind("\n", 0, match.start()) + 1
        indent = original[line_start : match.start()]
        indent = indent if indent.strip() == "" else "        "
        return f"{open_tag}{nav_inner(keys, indent)}{match.group(3)}"

    text = NAV_RE.sub(replace_nav, original, count=1)
    text = bump_versions(text)
    if text == original:
        return False
    path.write_text(text, encoding="utf-8")
    return True


def main():
    changed = []
    seen = set()
    for path in ROOT.rglob("*.html"):
        if "node_modules" in path.parts:
            continue
        resolved = path.resolve()
        if resolved in seen:
            continue
        seen.add(resolved)
        if process(path):
            changed.append(path.relative_to(ROOT).as_posix())
    print(f"Updated {len(changed)} files")
    for name in sorted(changed):
        print(f"  {name}")


if __name__ == "__main__":
    main()

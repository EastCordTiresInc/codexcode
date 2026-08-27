import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HEADER_LOGO = "/assets/eastcord-logo-red-black.svg"
FOOTER_LOGO = "/assets/eastcord-logo-footer.svg"

FOOTER_HTML = '''<footer class="site-footer">
      <div class="shell footer-grid">
        <div>
          <img src="/assets/eastcord-logo-footer.svg" alt="EastCord Tires" class="footer-logo" />
          <p>Used tires, new tires, and changeover services.</p>
        </div>
        <div class="footer-social">
          <h3>Follow Us</h3>
          <div class="footer-social-links" aria-label="EastCord Tires social media links">
            <a href="https://www.youtube.com/@EastCordTires" target="_blank" rel="noopener noreferrer">YouTube</a>
            <a href="https://www.instagram.com/eastcordtires" target="_blank" rel="noopener noreferrer">Instagram</a>
            <a href="https://www.facebook.com/share/14cUJxJDSWD/?mibextid=wwXIfr" target="_blank" rel="noopener noreferrer">Facebook</a>
            <a href="https://www.tiktok.com/@eastcordtires?_r=1&_t=ZS-985mxkvGCzE" target="_blank" rel="noopener noreferrer">TikTok</a>
          </div>
        </div>
        <div class="footer-info">
          <h3>Tire Information</h3>
          <div class="footer-info-links" aria-label="EastCord Tires tire information links">
            <a href="/used-tires">Used Tires</a>
            <a href="/new-tires">New Tires</a>
            <a href="/tire-size-guide">Tire Size Guide</a>
            <a href="/tire-season-guide">Tire Season Guide</a>
            <a href="/used-tire-buying-guide">Used Tire Buying Guide</a>
            <a href="/public/docs/eastcord-used-tire-warranty-policy.pdf" target="_blank" rel="noopener noreferrer">Used Tire Warranty</a>
            <a href="/how-we-inspect-used-tires">How We Inspect Used Tires</a>
            <a href="/proudly-canadian">Proudly Canadian</a>
            <a href="/appointment">Changeover / Swap Service</a>
            <a href="/local-installers">Local Installers</a>
            <a href="/#contact">Contact EastCord</a>
          </div>
        </div>
        <div>
          <h3>Quick Links</h3>
          <a href="/used-tires">Used Tires</a>
          <a href="/new-tires">New Tires</a>
          <a href="/appointment">Appointment</a>
          <a href="/local-installers">Local Installers</a>
          <a href="/#warranty">Warranty</a>
          <a href="/#contact">Contact</a>
        </div>
      </div>
      <div class="shell footer-bottom">
        <p class="footer-legal">
          <span>© 2026 EastCord Tires</span>
          <span class="footer-legal-separator">|</span>
          <a href="/terms-and-conditions">Terms &amp; Conditions</a>
          <span class="footer-legal-separator">|</span>
          <a href="/privacy-policy">Privacy Policy</a>
          <span class="footer-legal-separator">|</span>
          <a href="/cookie-policy">Cookie Policy</a>
          <span class="footer-legal-separator">|</span>
          <a href="/public/docs/eastcord-used-tire-warranty-policy.pdf" target="_blank" rel="noopener noreferrer">Warranty Policy</a>
        </p>
      </div>
    </footer>'''

FOOTER_RE = re.compile(r"<footer class=\"site-footer\">[\s\S]*?</footer>", re.I)
HEADER_LOGO_RE = re.compile(
    r'(<img(?![^>]*class="footer-logo")[^>]*?\bsrc=")[^"]*eastcord-logo[^"]+(")'
)
FOOTER_LOGO_RE = re.compile(
    r'(<img[^>]*class="footer-logo"[^>]*?\bsrc=")[^"]+(")|(<img[^>]*?\bsrc=")[^"]*eastcord-logo[^"]+("[^>]*class="footer-logo")'
)
CSS_RE = re.compile(r'footer-section\.css(?:\?v=\d+)?')


def ensure_footer_css(text):
    if "footer-section.css" in text:
        return CSS_RE.sub("footer-section.css?v=5", text)
    return text.replace("</head>", '    <link rel="stylesheet" href="/footer-section.css?v=5" />\n  </head>', 1)


def apply_footer(text):
    if FOOTER_RE.search(text):
        return FOOTER_RE.sub(FOOTER_HTML, text, count=1)
    if "</main>" in text:
        return text.replace("</main>", "</main>\n\n    " + FOOTER_HTML, 1)
    return text.replace("</body>", "    " + FOOTER_HTML + "\n  </body>", 1)


def process(path):
    original = path.read_text(encoding="utf-8")
    text = HEADER_LOGO_RE.sub(rf'\1{HEADER_LOGO}\2', original)
    text = FOOTER_LOGO_RE.sub(
        lambda m: (m.group(1) or m.group(3)) + FOOTER_LOGO + (m.group(2) or m.group(4)),
        text,
    )
    text = apply_footer(text)
    text = ensure_footer_css(text)
    if text != original:
        path.write_text(text, encoding="utf-8")
        return True
    return False


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

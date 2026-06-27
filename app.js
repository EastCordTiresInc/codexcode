const menuButton = document.querySelector(".menu-toggle");
const navigation = document.querySelector(".main-nav");
const navigationLinks = navigation.querySelectorAll("a");
const currentYear = document.querySelector("#current-year");

function closeMenu() {
  menuButton.setAttribute("aria-expanded", "false");
  menuButton.setAttribute("aria-label", "Open navigation menu");
  navigation.classList.remove("open");
  document.body.classList.remove("menu-open");
}

function forceFooterLogo() {
  const footerBrand = document.querySelector(".footer-brand");
  const footerText = footerBrand?.querySelector("p");
  if (!footerBrand || !footerText) return;

  let footerLogo = footerBrand.querySelector(".footer-logo");
  if (!footerLogo) {
    footerLogo = footerBrand.querySelector("img") || document.createElement("img");
    footerBrand.insertBefore(footerLogo, footerText);
  }

  footerLogo.src = "/assets/eastcord-logo-red-white.png?v=619148c";
  footerLogo.alt = "EastCord Tires";
  footerLogo.className = "footer-logo";
  footerLogo.removeAttribute("style");
  Object.assign(footerLogo.style, {
    display: "block",
    width: "220px",
    maxWidth: "100%",
    height: "auto",
    objectFit: "contain",
    opacity: "1",
    visibility: "visible",
    marginBottom: "20px",
  });

  if (!document.querySelector("#footer-logo-style")) {
    const style = document.createElement("style");
    style.id = "footer-logo-style";
    style.textContent = `
      .footer-logo {
        display: block;
        width: 220px;
        max-width: 100%;
        height: auto;
        object-fit: contain;
        opacity: 1;
        visibility: visible;
        margin-bottom: 20px;
      }
    `;
    document.head.append(style);
  }
}

menuButton.addEventListener("click", () => {
  const isOpen = menuButton.getAttribute("aria-expanded") === "true";
  menuButton.setAttribute("aria-expanded", String(!isOpen));
  menuButton.setAttribute("aria-label", isOpen ? "Open navigation menu" : "Close navigation menu");
  navigation.classList.toggle("open", !isOpen);
  document.body.classList.toggle("menu-open", !isOpen);
});

navigationLinks.forEach((link) => link.addEventListener("click", closeMenu));

window.addEventListener("resize", () => {
  if (window.innerWidth > 800) closeMenu();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeMenu();
});

forceFooterLogo();
currentYear.textContent = new Date().getFullYear();

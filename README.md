# EASTCORD TIRES Homepage

A responsive static homepage for EASTCORD TIRES in Milton, Ontario.

## Preview locally

Open `index.html` directly in a web browser.

For a local HTTP preview, run a static file server from this directory. For example:

```powershell
python -m http.server 8000
```

Then open `http://localhost:8000`.

## Deploy on Netlify

This is a static site with no package dependencies and no build step.

Recommended Netlify settings:

- Build command: leave blank
- Publish directory: `.`
- Environment variables: none required

The root `netlify.toml` file sets the publish directory and adds basic security and asset cache headers.

## Project files

- `index.html` - Homepage structure and content
- `styles.css` - Responsive layout and visual design
- `app.js` - Mobile navigation and footer year
- `assets/tire-shop-hero.png` - Homepage tire shop image
- `netlify.toml` - Netlify deployment settings and headers

This project has no package dependencies or build step.

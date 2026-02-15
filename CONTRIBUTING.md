# Contributing to Playlist of Babel

Thanks for your interest! This is a small static-site project, so contributing is straightforward.

## Getting Started

1. Fork the repo
2. Clone your fork
3. Serve locally with `python3 -m http.server 8000` or any static server
4. Make changes and test in your browser

## Guidelines

- **No build tools.** The project is intentionally vanilla HTML/CSS/JS. No bundlers, no transpilers, no frameworks.
- **Keep it three files.** All markup in `index.html`, all styles in `style.css`, all logic in `app.js`.
- **Test on multiple browsers.** Web Audio API and MediaRecorder support varies.
- **Respect the palette.** Crimson (`#d7263d`) and Nights (`#02182b`). No gradients.

## What to Work On

- Accessibility improvements (screen reader support, keyboard navigation)
- Mobile UX polish
- Performance optimizations for the region selector
- Additional audio visualization modes
- Internationalization

## Reporting Bugs

Open an issue with:
- What you expected
- What happened instead
- Browser and OS
- Steps to reproduce

## Pull Requests

- Keep PRs small and focused on a single change
- Describe what and why in the PR description
- Make sure the site still works end-to-end (browse, search, play, record, upload)

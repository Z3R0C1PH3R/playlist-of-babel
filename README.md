# ♫ Playlist of Babel

**Every possible one-second sound that could ever exist.**

Inspired by Borges' *"The Library of Babel"* (1941) and [libraryofbabel.info](https://libraryofbabel.info/), the Playlist of Babel is the auditory equivalent — a library containing every possible one-second sound. No server, no database. Audio is generated directly from the address in your browser.

**Live:** [playlistofbabel.z3r0c1ph3r.com](https://playlistofbabel.z3r0c1ph3r.com)

---

## How It Works

Each track is **1 second** of **8-bit mono audio at 8,000 Hz** — that's **8,000 bytes** (64,000 bits).

The address of a track is the **base64url encoding** of its raw audio data: a unique **10,667-character** string. Every combination of 64,000 bits is a valid track. Every track has exactly one address. Every address maps to exactly one track.

**2<sup>64,000</sup>** total tracks.

> For scale: the number of atoms in the observable universe is roughly 2<sup>266</sup>. This library has 2<sup>64,000</sup> tracks.

Every melody, every word in every language, every birdsong, thunderclap, and note of every instrument — the opening second of every song ever recorded, and every song that could be. They all exist here. Most are noise. But somewhere in the vastness is every beautiful sound that has ever been or could ever be.

## Features

- **Browse** — Navigate the library by choosing prefix characters. Each character narrows the space by 64×.
- **Search** — Record audio or upload a file, select any 1-second region, and find its exact address.
- **Random** — Pull a random address and hear what the void sounds like.
- **Play** — Real-time waveform and spectrum visualization with Web Audio API.
- **Download** — Export any track as a WAV file.
- **Share** — Copy a track's address or direct link.
- **Adjacent Tracks** — Explore sounds that differ by a single character.

## Technical Details

| Property | Value |
|---|---|
| Sample Rate | 8,000 Hz |
| Bit Depth | 8-bit unsigned |
| Channels | Mono |
| Duration | 1 second |
| Bytes per Track | 8,000 |
| Bits per Track | 64,000 |
| Address Length | 10,667 chars |
| Address Alphabet | `A–Z, a–z, 0–9, -, _` (64 chars) |
| Total Tracks | 2<sup>64,000</sup> |
| Frequency Range | 0 – 4,000 Hz |

## Stack

Pure frontend. No build step, no frameworks, no dependencies, no server.

- **HTML / CSS / vanilla JS** — three files, that's it
- **Web Audio API** — playback, resampling, visualization
- **MediaRecorder API** — microphone recording
- **Hash-based routing** — `#/browse`, `#/search`, `#/play/{address}`, etc.
- **Google Fonts** — [Space Grotesk](https://fonts.google.com/specimen/Space+Grotesk) + [JetBrains Mono](https://fonts.google.com/specimen/JetBrains+Mono)

## Run Locally

```
git clone https://github.com/YOUR_USERNAME/playlist-of-babel.git
cd playlist-of-babel
```

Serve with any static file server:

```bash
# Python
python3 -m http.server 8000

# Node
npx serve .

# Or just open index.html in a browser
```

Then visit [http://localhost:8000](http://localhost:8000).

## Project Structure

```
├── index.html   — markup and views
├── style.css    — styles (crimson + nights palette)
├── app.js       — all logic: encoding, audio, routing, UI
└── README.md
```

## Deploy

This is a static site — deploy anywhere:

- **GitHub Pages** — push and enable in repo settings
- **Netlify / Vercel / Cloudflare Pages** — connect the repo, no build command needed
- **Any web server** — just serve the files

## Credits

- Jorge Luis Borges — *"The Library of Babel"* (1941)
- Jonathan Basile — [libraryofbabel.info](https://libraryofbabel.info/)
- Built by [Z3R0C1PH3R](https://z3r0c1ph3r.com)

## License

[MIT](LICENSE)
# playlist-of-babel

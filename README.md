# SpeedSync

A fast photo preview app for FlashAir SD cards. Replaces the default FlashAir browser interface with a smoother, lower-friction experience for reviewing photos directly from your camera.

### The problem

The official FlashAir app (iOS/Android) has a thumbnail grid, but the experience is frustrating:

- **Manual refresh required** — and it takes a long time because it reloads everything
- **Out-of-order loading** — thumbnails don't load newest-first
- **No preloading** — tapping a photo means waiting for the full-size image to download from scratch
- **Clunky image viewer** — slow transitions, awkward gestures

### The solution

SpeedSync is a lightweight static webapp that lives on the FlashAir SD card itself. It replaces the official app entirely — connect your phone to the card's WiFi, open the page, and browse your photos in a responsive grid with smart thumbnail loading, newest-first ordering, and background preloading of full-size images.

---

## Development

### Prerequisites

- Node.js (for building)
- WSL2 (if developing on Windows — the SD card mounts via `drvfs`)

### Install

```bash
npm install
```

### Dev server

```bash
npm run dev
```

Opens a local Vite dev server for UI iteration. FlashAir API calls will fail without a live card connection — this is for layout and styling work.

### Build & deploy to SD card

```bash
bin/build
```

Builds the app and copies the output to `/mnt/f/speedsync/` on the SD card. If the card isn't mounted, it will mount `F:` automatically (prompts for sudo).

To use a different drive letter:

```bash
bin/build /mnt/g
```

### Unmount

```bash
bin/unmount
```

Safely unmounts the SD card and cleans up. Run this before physically removing the card.

### Testing workflow

The fastest way to iterate:

1. Plug the SD card into your PC via a USB adapter
2. Connect your phone/tablet to the FlashAir's WiFi
3. Run `bin/build` to deploy
4. On your phone, navigate to `http://flashair/speedsync/index.html`
5. Refresh the page after each build

**Note:** The FlashAir WiFi can be finicky when first inserted into a USB card reader — it may take a few attempts before the wireless subsystem activates. Once it starts working, it tends to stay on reliably.

---

## Architecture

- **Svelte 5** with runes for reactivity
- **Tailwind CSS 4** + **daisyUI 5** for styling (CMYK light / Black dark theme)
- **Vite** for bundling — outputs plain static files
- **No server-side code** — the app runs entirely in the browser and talks to the FlashAir's built-in CGI API

### FlashAir API endpoints used

| Endpoint | Purpose |
|---|---|
| `command.cgi?op=100&DIR=...` | List files in a directory |
| `command.cgi?op=101&DIR=...` | Get file count |
| `command.cgi?op=102` | Check if card has been updated |
| `thumbnail.cgi?/path/to/file.jpg` | Get JPEG thumbnail |
| `/path/to/file.jpg` | Direct file download |

### Deployed file structure on the SD card

```
/speedsync/
  index.html
  assets/
    *.js
    *.css
```

Accessible at `http://flashair/speedsync/index.html` when connected to the FlashAir WiFi.

---

## UI Guide

### Layout

The app uses a two-panel layout:

- **Left panel** — Full-size image preview with pinch-to-zoom and pan support. Background is always solid black.
- **Right panel** — Scrollable thumbnail list sorted newest-first. Shows a cache progress indicator (`cached/total`) and a status dot (pulsing when auto-caching is active).

### Floating Action Button (FAB)

A flower-style FAB in the bottom-right corner opens to reveal action buttons:

| Icon | Color | Action |
|---|---|---|
| ☰ (hamburger) | Secondary | Opens/closes the FAB menu |
| ↓ (download arrow) | Primary | Saves the currently selected photo to your device |
| 👁 (eye) / 👁‍🗨 (eye-slash) | Accent (on) / Neutral (off) | **Auto-show new images** — when enabled, automatically switches the preview to the newest photo as it arrives from the camera |
| ✕ (clear box) | Warning | Clears the local image cache and restarts background pre-caching |
| ℹ (info) | Info | Toggles the cache debug overlay |
| ☀/🌙 (sun/moon) | Secondary | Toggles between light (CMYK) and dark (Black) themes |

### Automatic polling

The app polls the FlashAir card every 1.5 seconds for new photos. When a new photo is detected:

1. It appears at the top of the thumbnail list with a reveal animation
2. Background pre-caching restarts to include the new image
3. If **Auto-show new images** is enabled, the preview switches to the new photo immediately

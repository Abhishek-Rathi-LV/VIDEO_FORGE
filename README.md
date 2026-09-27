# VIDEOFORGE

Production-ready Vite + React + TypeScript project generated from the VIDEOFORGE React source.

## Run locally

```bash
npm install
npm run dev
```

## Production build

```bash
npm run build
npm run preview
```

The production site is generated in `dist/`.

## Deploy

### Vercel
Import this project. Vercel detects Vite automatically.

### Netlify
Import the repository. Build command:
`npm run build`

Publish directory:
`dist`

### Cloudflare Pages
Framework preset: Vite
Build command:
`npm run build`
Build output directory:
`dist`

## Important technical note

The current application source uses browser `MediaRecorder` + Canvas/Web Audio for local processing. Codec/container support varies by browser. The UI should only advertise formats that the current browser can actually encode.

Videos are processed locally by the application; there is no VIDEOFORGE upload backend in this project.

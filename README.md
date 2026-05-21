# YouTube Transcript Fetcher

Fetches YouTube video transcripts using the `youtube-transcript` library — the JavaScript equivalent of Python's `youtube-transcript-api`. **No API key needed.**

## How it works

1. User pastes a YouTube URL in the browser
2. The browser calls the Next.js API route (`/api/transcript`)
3. The API route uses `youtube-transcript` to fetch captions from YouTube
4. Transcript is returned and displayed with timestamps

## Why not run it in the browser directly?

YouTube blocks cross-origin requests (CORS). This means **no code running in the browser** (JavaScript, Python via Pyodide, or anything else) can fetch YouTube pages directly. CORS is a browser security rule — it doesn't matter what language you use, the browser itself blocks it.

## How this solves the server ban

When deployed to **Vercel** (free), the API route runs on Vercel's infrastructure. YouTube requests come from **Vercel's IP addresses**, not your server. Your banned server IP is never involved.

```
User's Browser → Vercel (free, Vercel's IPs) → YouTube ✅
User's Browser → Your Server (banned IP) → YouTube ❌
```

## Setup

```bash
npm install
npm run dev
```

## Deploy to Vercel

1. Push this code to a GitHub repository
2. Go to [vercel.com](https://vercel.com) and sign up (free)
3. Click "Import Project" → select your GitHub repo
4. Click "Deploy"
5. Done! Your app is live on Vercel's servers

### Vercel Free Tier Limits
- 1,000,000 serverless function calls/month
- 4 CPU-hours/month
- Free plan is for personal/non-commercial use

## Project Structure

```
├── app/
│   ├── api/
│   │   └── transcript/
│   │       └── route.js      ← API route (fetches transcript server-side)
│   ├── globals.css            ← Styling
│   ├── layout.js              ← Root layout
│   └── page.js                ← Client UI component
├── package.json
├── next.config.mjs
└── .gitignore
```

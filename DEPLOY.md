# FitLog — PWA Deployment Guide

## What you have
A complete Progressive Web App that:
- Works fully offline after first load
- Can be installed to your iPhone/iPad home screen
- Persists all data in localStorage (survives app restarts)
- Includes your 4 Interval Timer routines pre-loaded

---

## Step 1 — Deploy to Vercel (free, 5 minutes)

### Option A: Vercel CLI (if you have a Mac/PC)
```bash
npm install -g vercel
cd fitlog
vercel
# Follow prompts — accept all defaults
# You'll get a URL like: https://fitlog-jay.vercel.app
```

### Option B: Vercel via GitHub (recommended, works from iPad)
1. Create a free account at github.com
2. Create a new repository called `fitlog`
3. Upload all these files to the repo (drag & drop in GitHub's web UI)
4. Go to vercel.com → "Add New Project" → connect GitHub → select `fitlog`
5. Vercel auto-detects Vite — just click Deploy
6. You get a permanent URL in ~60 seconds

---

## Step 2 — Add to iPhone/iPad Home Screen

1. Open your Vercel URL in **Safari** (must be Safari, not Chrome)
2. Tap the **Share** button (box with arrow pointing up)
3. Scroll down and tap **"Add to Home Screen"**
4. Name it "FitLog" → tap **Add**

It now appears on your home screen with the dumbbell icon, launches full-screen with no browser chrome, and works offline.

---

## Step 3 — Optional: Custom domain
If you want `fitlog.yourdomain.com` instead of the Vercel URL:
- In Vercel dashboard → Settings → Domains → add your domain
- Free with any domain registrar

---

## File structure
```
fitlog/
├── index.html          ← Entry point
├── vite.config.js      ← Build config + PWA plugin
├── package.json        ← Dependencies
├── src/
│   ├── main.jsx        ← React mount point
│   └── App.jsx         ← Full FitLog app (1800+ lines)
└── public/
    └── icons/
        ├── icon-192.png
        └── icon-512.png
```

---

## Local development (optional)
```bash
npm install
npm run dev
# Opens at http://localhost:5173
```

---

## Data & backup
All workout data, routines, and settings are stored in your browser's localStorage
under the `fitlog:` prefix. Use the 📦 Backup button in the app to export/import
your data as JSON — paste it here in Claude to have it backed up to Google Drive.

---

## Next steps
- HealthKit sync → requires React Native rewrite (future phase)
- Push notifications for rest timers → available in PWA on Android, limited on iOS
- Cloud sync → wire up Supabase or Firebase for cross-device data

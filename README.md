# HackJudge — GitHub Pages Edition

A fully static AI-powered hackathon judge. No server. No Python. Runs entirely in the browser.
Hosted free on GitHub Pages. Scores stored in a private GitHub repo.

---

## Setup (5 steps)

### Step 1 — Create the data repo

Go to [github.com/new](https://github.com/new):
- Name: `hackjudge-data`
- Set to **Private**
- **Do NOT** add a README
- Click **Create repository**

Then inside the empty repo, create a folder called `submissions` by adding a file at `submissions/.gitkeep`.

### Step 2 — Create a GitHub Personal Access Token

Go to [github.com/settings/tokens/new](https://github.com/settings/tokens/new):
- Name: `hackjudge-token`
- Expiration: set to your hackathon end date
- Scope: check **repo** (full control of private repositories)
- Click **Generate token** → copy it

### Step 3 — Fill in `config.js`

Open `config.js` and fill in your values:

```js
GITHUB_OWNER:     "your-github-username",
GITHUB_SITE_REPO: "hackjudge",         // this repo
GITHUB_DATA_REPO: "hackjudge-data",    // the private data repo
GITHUB_TOKEN:     "ghp_xxxx",          // your PAT from Step 2

EVENT_NAME:  "My Hackathon 2025",
EVENT_DATE:  "May 2025",

ADMIN_USERNAME: "hackadmin",           // choose your username
ADMIN_PASSWORD: "hack@2025",           // choose your password
```

### Step 4 — Push to GitHub

```bash
git init
git add .
git commit -m "HackJudge"
# Create a new PUBLIC repo named "hackjudge" on github.com, then:
git remote add origin https://github.com/YOUR_USERNAME/hackjudge.git
git push -u origin main
```

### Step 5 — Enable GitHub Pages

In your `hackjudge` repo → **Settings → Pages → Source → Deploy from branch → main → / (root)** → Save.

Your site goes live at: `https://YOUR_USERNAME.github.io/hackjudge/`

---

## File structure

```
hackjudge/
├── config.js          ← Edit this first
├── style.css          ← Shared styles
├── github-client.js   ← GitHub repo analysis + data storage
├── gemini-client.js   ← Gemini AI evaluation
├── index.html         ← Submission form
├── judging.html       ← Live evaluation page
├── leaderboard.html   ← Live rankings
├── report.html        ← Private downloadable PDF report
└── admin.html         ← Admin panel (delete entries, bulk test)
```

---

## How data is stored

Submissions are saved as individual JSON files in your private `hackjudge-data` repo:
```
hackjudge-data/
└── submissions/
    ├── ABC12345.json
    ├── DEF67890.json
    └── ...
```

Each file contains team info, scores, and feedback. The Gemini API key is **never** written to GitHub — it lives only in `sessionStorage` for the duration of one evaluation.

---

## Admin panel

Click **Admin** in the leaderboard nav → enter your credentials → manage submissions:
- Delete individual test entries
- Delete all submissions before the real event
- Run bulk tests (submits multiple projects at once)

---

## After the hackathon

Delete the GitHub PAT from [github.com/settings/tokens](https://github.com/settings/tokens) to revoke all data access.

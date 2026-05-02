# HireArc

> **South Africa's modern job platform** — connecting candidates with opportunities and recruiters with talent, built on a clean dark UI with real-time data.

---

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Database Schema](#database-schema)
- [Authentication](#authentication)
- [Pages & Routes](#pages--routes)
- [Key Modules](#key-modules)
- [Storage Buckets](#storage-buckets)
- [Known Issues & Fixes](#known-issues--fixes)
- [Contributing](#contributing)

---

## Overview

HireArc is a full-stack job board platform built for the South African market. It supports two distinct user roles — **Candidates** and **Recruiters** — each with a dedicated dashboard, real-time data from Supabase, and live job listings from the [Remotive API](https://remotive.com/api/remote-jobs).

The platform is built entirely in vanilla HTML, CSS, and JavaScript with no frontend framework dependency, making it lightweight, fast, and easy to deploy as static files.

---

## Features

### For Candidates
- Browse and search live remote job listings (via Remotive API)
- One-click apply with external link redirect
- Application tracking with real-time status updates
- Save and bookmark jobs for later
- Personalised profile with photo upload, CV upload, skills, and work experience
- Profile strength indicator with completion checklist
- Weekly activity chart for application history
- Recommended jobs (excludes already-applied listings)

### For Recruiters
- Post, edit, pause, draft, and close job listings
- Full applicant management with status pipeline:  
  `Applied → Reviewed → Shortlisted → Interview → Offered / Rejected`
- Kanban-style pipeline view per job listing
- Analytics dashboard with daily application bar chart and conversion rate
- Upcoming interviews panel
- Company profile and branding in the sidebar

### General
- Email/password sign-up and login with Supabase Auth
- Google OAuth sign-in
- Password reset via email
- Role-based redirect after login (candidate vs recruiter dashboard)
- Toast notifications for all actions
- Responsive design with mobile fallback

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla HTML5, CSS3, JavaScript (ES2020+) |
| Backend / Database | [Supabase](https://supabase.com) (PostgreSQL + Auth + Storage) |
| Job Data | [Remotive API](https://remotive.com/api/remote-jobs) (live remote jobs) |
| Fonts | Google Fonts — Bebas Neue, DM Sans, DM Mono |
| Auth | Supabase Auth (Email/Password + Google OAuth) |
| Storage | Supabase Storage (CV uploads, profile photos) |
| Hosting | Any static host — Netlify, Vercel, GitHub Pages, etc. |

---

## Project Structure

```
hirearc/
├── index.html                  # Landing page with live job preview
├── login.html                  # Login page (Email + Google OAuth)
├── signup.html                 # Sign-up page with role selection
├── candidate-dashboard.html    # Full candidate dashboard
├── recruiter-dashboard.html    # Full recruiter dashboard
│
├── supabase-client.js          # Supabase client init + shared auth helpers
├── profile-fix.js              # Candidate dashboard logic (v5, production)
└── recruiter.js                # Recruiter dashboard logic (v3, production)
```

---

## Getting Started

### Prerequisites

- A [Supabase](https://supabase.com) project (free tier is fine)
- A web server or static host (or just open files locally)

### 1. Clone the repository

```bash
git clone https://github.com/your-username/hirearc.git
cd hirearc
```

### 2. Configure Supabase credentials

Open `supabase-client.js` and replace the placeholder values:

```js
const SUPABASE_URL      = 'YOUR_SUPABASE_PROJECT_URL';
const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';
```

Your URL and anon key are found in your Supabase project under  
**Project Settings → API**.

### 3. Set up the database

Run the following SQL in your Supabase SQL editor:

```sql
-- Profiles table (one row per user)
CREATE TABLE profiles (
  id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email         TEXT,
  full_name     TEXT,
  phone         TEXT,
  location      TEXT,
  job_title     TEXT,
  bio           TEXT,
  experience_level TEXT,
  role          TEXT DEFAULT 'candidate',   -- 'candidate' | 'recruiter'
  skills        JSONB DEFAULT '[]',
  saved_jobs    JSONB DEFAULT '[]',
  experiences   JSONB DEFAULT '[]',
  avatar_url    TEXT,
  cv_url        TEXT,
  cv_filename   TEXT,
  company_name  TEXT,
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Job postings (recruiter-created)
CREATE TABLE job_postings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recruiter_id    UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  company_name    TEXT,
  location        TEXT,
  employment_type TEXT,
  category        TEXT,
  salary_min      INTEGER,
  salary_max      INTEGER,
  description     TEXT,
  requirements    TEXT,
  apply_link      TEXT,
  status          TEXT DEFAULT 'active',   -- 'active' | 'paused' | 'draft' | 'closed'
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Applications (candidate → job)
CREATE TABLE applications (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id  UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id        TEXT NOT NULL,
  status        TEXT DEFAULT 'applied',
  applied_at    TIMESTAMPTZ DEFAULT NOW(),
  match_score   NUMERIC,
  resume_url    TEXT,
  cover_letter  TEXT,
  years_experience INTEGER,
  interview_date TIMESTAMPTZ,
  job_snapshot  JSONB   -- snapshot of job details at time of apply
);
```

### 4. Enable Row Level Security (RLS)

Enable RLS on all tables and add policies so users can only read/write their own data. Example for `profiles`:

```sql
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile"
  ON profiles FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE USING (auth.uid() = id);
```

Repeat equivalent policies for `job_postings` and `applications`.

### 5. Configure Google OAuth (optional)

In your Supabase dashboard, go to **Authentication → Providers → Google** and add your Google OAuth client ID and secret. Set the redirect URL to:

```
https://your-domain.com/candidate-dashboard.html
```

### 6. Set up Storage buckets

Create two public buckets in Supabase Storage:

| Bucket name | Purpose |
|---|---|
| `resumes` | Candidate CV/resume uploads |
| `avatars` | Profile photo uploads |

### 7. Run the app

Open `index.html` in a browser, or deploy to any static host.

For local development with proper auth redirects, use a local server:

```bash
npx serve .
# or
python -m http.server 3000
```

---

## Database Schema

### `profiles`
Stores extended user data for both candidates and recruiters. Created or upserted automatically on sign-up.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | Matches `auth.users.id` |
| `role` | TEXT | `'candidate'` or `'recruiter'` |
| `skills` | JSONB | Array of skill strings |
| `saved_jobs` | JSONB | Array of job ID strings |
| `experiences` | JSONB | Array of experience objects |
| `job_snapshot` | JSONB | Captured job data at apply time |

### `job_postings`
Recruiter-created listings. The `status` field controls visibility:
- `active` — visible, accepting applications
- `paused` — hidden from candidates
- `draft` — not yet published
- `closed` — no longer accepting applications

### `applications`
Links candidates to jobs. The `job_snapshot` column stores a copy of the job's title, company, location, and type at the time of application so cards render correctly even if the original posting is later deleted or changed.

> **Note:** If `job_snapshot` doesn't exist in your database yet, the application code falls back gracefully and logs a warning with the required `ALTER TABLE` command.

---

## Authentication

Auth is handled entirely through Supabase Auth via `supabase-client.js`, which exposes these global helpers:

```js
signIn(email, password)       // Email/password login
signUp(email, password, meta) // Creates auth user + profile row
signOut()                     // Clears session
signInWithGoogle()            // OAuth redirect
resetPassword(email)          // Sends reset email
getCurrentUser()              // Returns current user or null
getProfile(userId)            // Fetches profile row from Supabase
```

After login, users are redirected based on their `role` field in `profiles`:
- `candidate` → `candidate-dashboard.html`
- `recruiter` → `recruiter-dashboard.html`

---

## Pages & Routes

| File | Description |
|---|---|
| `index.html` | Marketing landing page. Shows live jobs from Supabase (with fallback static jobs). Nav adapts to auth state. |
| `login.html` | Email/password login + Google OAuth. Shows forgot-password modal. |
| `signup.html` | Registration with role selector (Candidate / Recruiter). Password strength meter included. |
| `candidate-dashboard.html` | Full candidate app — overview, applications, saved jobs, browse, profile, settings. |
| `recruiter-dashboard.html` | Full recruiter app — overview, job listings, applicants, pipeline, analytics, company, settings. |

---

## Key Modules

### `supabase-client.js`
Initialises the Supabase client and exposes all auth helpers globally on `window`. Also boots the recruiter dashboard if the page has a recruiter role indicator (legacy boot path — superseded by `recruiter.js`).

### `profile-fix.js`
The candidate dashboard engine (v5). Runs as an IIFE to avoid global scope pollution. Key responsibilities:
- Fetches the user's profile, applications, and jobs (from Remotive API) in parallel on boot
- Normalises all job/saved IDs to strings to prevent `includes()` mismatches between number and string types
- Renders all dashboard sections: stats, activity chart, profile strength ring, recommended jobs, browse grid, saved grid, application list
- Handles apply, save, profile save, CV upload, photo upload
- Gracefully falls back if `job_snapshot` column is missing

### `recruiter.js`
The recruiter dashboard engine (v3). Also an IIFE. Key responsibilities:
- Loads the recruiter's job postings and all associated applications from Supabase
- Renders the overview, jobs table, applicants list, Kanban pipeline, and analytics
- Handles all job CRUD (create, update, status change, delete) via modal form
- Handles application status transitions with optimistic local state updates

---

## Storage Buckets

| Bucket | Path pattern | Max size |
|---|---|---|
| `resumes` | `cvs/{userId}/{timestamp}_{filename}` | 5 MB |
| `avatars` | `avatars/{userId}/{timestamp}_{filename}` | 3 MB |

Files are uploaded with `upsert: true`, so re-uploading replaces the previous file without accumulating storage. Public URLs are generated via `getPublicUrl()` and stored in the `profiles` table.

---

## Known Issues & Fixes

### `job_snapshot` column missing
If you see this warning in the console:

```
[HireArc] job_snapshot column missing — retrying without it.
```

Run this in your Supabase SQL editor:

```sql
ALTER TABLE applications ADD COLUMN job_snapshot JSONB;
```

### Script load order
The Supabase CDN script **must** load before any app scripts. Do not use `defer` or `async` on either. The correct order is:

```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<script src="supabase-client.js"></script>
<script src="profile-fix.js"></script>   <!-- candidate dashboard only -->
```

### Candidate dashboard boot guard
`profile-fix.js` uses `window.__HIREARC_BOOTED__` as a guard flag to prevent double-boot on auth state change events. This is intentional and safe to leave in place.

### ID type normalisation
Job IDs from the Remotive API are integers, but Supabase stores them as strings. All comparisons throughout the codebase are normalised via `String(id)` to prevent silent failures on `includes()` checks.

---

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature-name`
3. Make your changes and test locally
4. Commit with a clear message: `git commit -m "feat: add interview scheduling UI"`
5. Push and open a pull request

### Code style
- Vanilla JS only — no frameworks or build tools required
- Use `escHtml()` for all user-generated content rendered into innerHTML
- Keep auth logic in `supabase-client.js`, candidate logic in `profile-fix.js`, recruiter logic in `recruiter.js`
- All Supabase calls should handle errors explicitly and show a toast to the user

---

## Licence

MIT — free to use, modify, and distribute.

---

<div align="center">
  <strong>HireArc</strong> · Built for South Africa · 2025
</div>

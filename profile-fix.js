// ================================================================
//  HireArc — profile-fix.js  v5  (FIXED)
//
//  Fixes in this version:
//   1. Saved jobs: all IDs normalised to STRING everywhere so
//      includes() comparisons never silently fail on number vs string
//   2. Apply: insert error is now logged visibly; job_snapshot column
//      is gracefully handled if missing (falls back to no snapshot)
//   3. Applied state: browseGrid and recommendedList both re-render
//      correctly after apply using String-normalised job_id checks
//   4. saveProfile: avatar_url / cv_url / cv_filename preserved
//   5. loadApplications: reads job_snapshot → job_postings so
//      applied cards always render even without a job_postings row
// ================================================================

(function () {
  'use strict';

  if (!document.getElementById('section-overview')) return;
  if (window.__HIREARC_BOOTED__) return;

  // ── STATE ────────────────────────────────────────────────────────
  const APP = {
    user:         null,
    profile:      null,
    applications: [],
    jobs:         [],
    savedIds:     [],   // ← always strings
    skills:       [],
    experiences:  [],
    activeFilter: 'all',
  };

  // ── BOOT ─────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', async () => {
    setDateGreeting();
    renderActivityChart([]);

    const db = window.supabaseClient;
    if (!db) { console.error('[HireArc] supabaseClient not found'); return; }

    let booted = false;

    async function boot(session) {
      if (!session?.user || booted) return;
      booted = true;
      window.__HIREARC_BOOTED__ = true;
      APP.user = session.user;
      console.log('[HireArc] Booting user:', APP.user.id);
      await initApp();
    }

    try {
      const { data: { session } } = await db.auth.getSession();
      if (session?.user) await boot(session);
    } catch (err) {
      console.error('[HireArc] getSession error:', err);
    }

    db.auth.onAuthStateChange(async (event, session) => {
      console.log('[Auth Event]', event);
      if (session?.user) await boot(session);
      if (event === 'SIGNED_OUT') window.location.href = 'login.html';
    });
  });

  // ── INIT ─────────────────────────────────────────────────────────
  async function initApp() {
    await loadProfile();
    await Promise.all([loadJobs(), loadApplications()]);
    renderAll();
    wireSignOut();
    wireNotifBtn();
  }

  function renderAll() {
    updateSidebarUser();
    renderStats();
    renderOverviewApps();
    renderActivityChart(APP.applications);
    renderProfileStrength();
    renderAppList();
    renderSavedGrid();
    renderBrowse();
    populateProfileForm();
    renderSkills();
    renderExperiences();
    updateAppBadge();
    renderRecommended();
  }

  // ── PROFILE LOAD ─────────────────────────────────────────────────
  async function loadProfile() {
    const db = window.supabaseClient;
    const { data, error } = await db
      .from('profiles').select('*').eq('id', APP.user.id).single();

    if (error || !data) {
      console.warn('[HireArc] No profile row for', APP.user.id);
      APP.profile = null; APP.skills = []; APP.savedIds = []; APP.experiences = [];
      return;
    }

    APP.profile     = data;
    APP.skills      = Array.isArray(data.skills)      ? data.skills      : [];
    // ── FIX: normalise every saved ID to a STRING ──────────────────
    APP.savedIds    = Array.isArray(data.saved_jobs)
      ? data.saved_jobs.map(id => String(id))
      : [];
    APP.experiences = Array.isArray(data.experiences) ? data.experiences : [];
  }

  // ── JOBS LOAD ────────────────────────────────────────────────────
  async function loadJobs() {
    try {
      const res  = await fetch('https://remotive.com/api/remote-jobs');
      const data = await res.json();
      APP.jobs = data.jobs.map(job => ({
        id:              String(job.id),   // ← always string
        title:           job.title,
        company_name:    job.company_name,
        location:        job.candidate_required_location,
        employment_type: 'Remote',
        salary_min:      null,
        salary_max:      null,
        description:     job.description,
        category:        job.category,
        created_at:      job.publication_date,
        apply_link:      job.url,
      }));
      console.log('[HireArc] Jobs loaded:', APP.jobs.length);
    } catch (err) {
      console.error('[HireArc] Failed to load jobs:', err);
      APP.jobs = [];
    }
  }

  // ── APPLICATIONS LOAD ─────────────────────────────────────────────
  async function loadApplications() {
    const db = window.supabaseClient;
    const { data, error } = await db
      .from('applications')
      .select('*')
      .eq('candidate_id', APP.user.id)
      .order('applied_at', { ascending: false });

    if (!error && data) {
      APP.applications = data.map(a => ({
        ...a,
        job_id:       String(a.job_id),   // ← normalise to string
        job_postings: a.job_snapshot || {},
      }));
    }
  }

  // ── SIDEBAR / TOPBAR ──────────────────────────────────────────────
  function updateSidebarUser() {
    const p    = APP.profile;
    const name = (p?.full_name?.trim()) || APP.user?.email || 'You';
    const init = name.split(' ').map(w => w[0] || '').join('').slice(0, 2).toUpperCase() || '?';

    setText('sidebarName', name);

    ['sidebarAvatar', 'profilePhotoAvatar'].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      if (p?.avatar_url) {
        el.style.backgroundImage = `url(${p.avatar_url})`;
        el.style.backgroundSize  = 'cover';
        el.textContent = '';
      } else {
        el.style.backgroundImage = '';
        el.textContent = init;
      }
    });

    const greetEl = document.getElementById('topbarGreeting');
    if (greetEl) {
      const first = name.split(' ')[0];
      greetEl.innerHTML = `Welcome back, <span>${escHtml(first)}</span> 👋`;
    }
  }

  function setDateGreeting() {
    const el = document.getElementById('topbarDate');
    if (el) el.textContent = new Date().toLocaleDateString('en-ZA', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    }).toUpperCase();
  }

  function updateAppBadge() { setText('appBadge', APP.applications.length); }

  // ── STATS ──────────────────────────────────────────────────────────
  function renderStats() {
    const apps    = APP.applications;
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);

    setText('statTotal',       apps.length);
    setText('statShortlisted', apps.filter(a => a.status === 'shortlisted').length);
    setText('statInterviews',  apps.filter(a => ['interview','reviewed'].includes(a.status)).length);
    setText('statSaved',       APP.savedIds.length);

    setText('statTotalChange',       `${apps.filter(a => new Date(a.applied_at) >= weekAgo).length} this week`);
    setText('statShortlistedChange', `${apps.filter(a => a.status === 'shortlisted').length} new`);
    const ivCount = apps.filter(a => ['interview','reviewed'].includes(a.status)).length;
    setText('statInterviewsChange',  ivCount > 0 ? 'Scheduled' : 'None yet');

    const dot = document.getElementById('notifDot');
    if (dot) dot.style.display = ivCount > 0 ? '' : 'none';
  }

  // ── OVERVIEW APPS ──────────────────────────────────────────────────
  function renderOverviewApps() {
    const el = document.getElementById('overviewAppList');
    if (!el) return;
    const recent = APP.applications.slice(0, 5);
    el.innerHTML = recent.length
      ? recent.map(appItemHTML).join('')
      : emptyState('📭', 'No applications yet', 'Start applying to see them here.');
  }

  function appItemHTML(app) {
    const job  = app.job_postings || {};
    const date = app.applied_at
      ? new Date(app.applied_at).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })
      : '';
    return `
      <div class="app-item" onclick="openJobModal('${escHtml(String(job.id || ''))}')">
        <div class="app-logo">${abbrev(job.company_name || 'CO')}</div>
        <div class="app-details">
          <div class="app-title">${escHtml(job.title || 'Unknown Role')}</div>
          <div class="app-meta">
            <span>${escHtml(job.company_name || '')}</span>
            ${job.location        ? `<span class="app-dot"></span><span>${escHtml(job.location)}</span>` : ''}
            ${job.employment_type ? `<span class="app-dot"></span><span>${escHtml(job.employment_type)}</span>` : ''}
          </div>
        </div>
        <span class="status-badge ${statusClass(app.status)}">${formatStatus(app.status)}</span>
        <div class="app-date">${date}</div>
      </div>`;
  }

  // ── ACTIVITY CHART ─────────────────────────────────────────────────
  function renderActivityChart(apps) {
    const el = document.getElementById('activityChart');
    const lb = document.getElementById('activityLabel');
    if (!el) return;

    const DAYS   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const today  = new Date();
    const counts = Array(7).fill(0);
    const labels = [];

    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      labels.push(DAYS[d.getDay()]);
    }

    apps.forEach(a => {
      const todayStart   = new Date(today); todayStart.setHours(0,0,0,0);
      const appliedStart = new Date(a.applied_at); appliedStart.setHours(0,0,0,0);
      const diff = Math.floor((todayStart - appliedStart) / 86_400_000);
      if (diff >= 0 && diff < 7) counts[6 - diff]++;
    });

    const maxC = Math.max(...counts, 1);
    el.innerHTML = counts.map((c, i) => {
      const h = Math.max(8, Math.round((c / maxC) * 60));
      return `<div class="cb-wrap">
        <div class="${c > 0 ? 'cbar has-activity' : 'cbar'}" style="height:${h}px" title="${c} application${c !== 1 ? 's' : ''}"></div>
        <div class="cday">${labels[i]}</div>
      </div>`;
    }).join('');

    const total = counts.reduce((s, c) => s + c, 0);
    if (lb) lb.textContent = `${total} application${total !== 1 ? 's' : ''} this week`;
  }

  // ── PROFILE STRENGTH ───────────────────────────────────────────────
  function renderProfileStrength() {
    const p      = APP.profile || {};
    const checks = [
      { label: 'Full Name',   done: !!(p.full_name?.trim()) },
      { label: 'Email',       done: !!(p.email) },
      { label: 'Job Title',   done: !!(p.job_title) },
      { label: 'Location',    done: !!(p.location) },
      { label: 'Bio',         done: !!(p.bio && p.bio.length > 20) },
      { label: 'Skills',      done: APP.skills.length > 0 },
      { label: 'CV Uploaded', done: !!(p.cv_url) },
      { label: 'Experience',  done: APP.experiences.length > 0 },
    ];
    const done = checks.filter(c => c.done).length;
    const pct  = Math.round((done / checks.length) * 100);
    const circ = 2 * Math.PI * 42;
    const fill = document.getElementById('profileRingFill');
    if (fill) {
      fill.style.strokeDasharray  = circ;
      fill.style.strokeDashoffset = circ - (circ * pct / 100);
    }
    setText('profileRingPct', `${pct}%`);

    const nameEl = document.getElementById('profileCardName');
    const subEl  = document.getElementById('profileCardSub');
    if (nameEl) nameEl.textContent = p.full_name || APP.user?.email || 'Your Name';
    if (subEl)  subEl.textContent  = [p.job_title, p.location].filter(Boolean).join(' · ') || 'Complete your profile';

    const listEl = document.getElementById('profileCheckList');
    if (listEl) listEl.innerHTML = checks.slice(0, 6).map(c =>
      `<div class="ci">
        <span class="${c.done ? 'ci-done' : 'ci-todo'}">${c.done ? '✓' : '○'}</span>
        <span style="${c.done ? 'color:var(--text)' : ''}">${c.label}</span>
      </div>`
    ).join('');
  }

  // ── RECOMMENDED ────────────────────────────────────────────────────
  function renderRecommended() {
    const el = document.getElementById('recommendedList');
    if (!el) return;
    // ── FIX: use string comparison throughout ──────────────────────
    const appliedIds = new Set(APP.applications.map(a => String(a.job_id)));
    const recs       = APP.jobs.filter(j => !appliedIds.has(String(j.id))).slice(0, 4);

    if (!recs.length) {
      el.innerHTML = emptyState('🎯', 'No recommendations yet', 'Browse jobs to find matching roles.');
      return;
    }

    el.innerHTML = recs.map(j => {
      const saved = APP.savedIds.includes(String(j.id));
      return `
        <div class="job-rec-item" onclick="openJobModal('${escHtml(j.id)}')">
          <div class="jlogo">${abbrev(j.company_name || 'CO')}</div>
          <div class="jdetails">
            <div class="jtitle">${escHtml(j.title)}</div>
            <div class="jcompany">${escHtml(j.company_name)}${j.location ? ' · ' + escHtml(j.location) : ''}</div>
            <div class="jtags">
              ${j.employment_type ? `<span class="jtag jtag-t">${escHtml(j.employment_type)}</span>` : ''}
              ${salaryLabel(j.salary_min, j.salary_max) ? `<span class="jtag jtag-s">${salaryLabel(j.salary_min, j.salary_max)}</span>` : ''}
              ${j.category ? `<span class="jtag jtag-r">${escHtml(j.category)}</span>` : ''}
            </div>
          </div>
          <button class="jsave-btn ${saved ? 'saved' : ''}" onclick="event.stopPropagation();toggleSave('${escHtml(j.id)}',this)" title="${saved ? 'Unsave' : 'Save'}">🔖</button>
          <button class="japply" onclick="event.stopPropagation();quickApply('${escHtml(j.id)}',this)">Apply</button>
        </div>`;
    }).join('');
  }

  // ── APP LIST ───────────────────────────────────────────────────────
  function renderAppList() {
    const el = document.getElementById('appList');
    if (!el) return;
    const statusMap = {
      reviewed:    ['reviewed','interview'],
      shortlisted: ['shortlisted'],
      pending:     ['pending','applied'],
      rejected:    ['rejected'],
    };
    const filtered = APP.activeFilter === 'all'
      ? APP.applications
      : APP.applications.filter(a => (statusMap[APP.activeFilter] || []).includes(a.status));

    el.innerHTML = filtered.length
      ? filtered.map(appItemHTML).join('')
      : emptyState('📋', 'No applications here', 'Apply to jobs in Browse Jobs.');
  }

  window.filterApps = function (filter, btn) {
    APP.activeFilter = filter;
    document.querySelectorAll('#section-applications .ftab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    renderAppList();
  };

  // ── SAVED GRID ────────────────────────────────────────────────────
  function renderSavedGrid() {
    const el = document.getElementById('savedGrid');
    if (!el) return;
    // ── FIX: compare strings on both sides ────────────────────────
    const savedJobs = APP.jobs.filter(j => APP.savedIds.includes(String(j.id)));
    if (!savedJobs.length) {
      el.innerHTML = `<div style="grid-column:1/-1">${emptyState('🔖', 'No saved jobs yet', 'Bookmark jobs while browsing.')}</div>`;
      return;
    }
    el.innerHTML = savedJobs.map(j => {
      const salary = salaryLabel(j.salary_min, j.salary_max);
      return `
        <div class="saved-card" onclick="openJobModal('${escHtml(j.id)}')">
          <div class="saved-top">
            <div class="saved-logo">${abbrev(j.company_name || 'CO')}</div>
            <button class="save-btn" onclick="event.stopPropagation();toggleSave('${escHtml(j.id)}',this)" title="Remove">🔖</button>
          </div>
          <div class="saved-title">${escHtml(j.title)}</div>
          <div class="saved-company">${escHtml(j.company_name)}${j.location ? ' · ' + escHtml(j.location) : ''}</div>
          <div class="saved-footer">
            <span class="saved-salary">${salary || 'Salary TBC'}</span>
            <span class="saved-type">${escHtml(j.employment_type || 'Full-Time')}</span>
          </div>
        </div>`;
    }).join('');
  }

  // ── BROWSE ────────────────────────────────────────────────────────
  window.renderBrowse = function () {
    const el      = document.getElementById('browseGrid');
    const countEl = document.getElementById('browseCount');
    if (!el) return;

    const q    = (document.getElementById('browseSearchInput')?.value || '').toLowerCase();
    const type = (document.getElementById('browseTypeFilter')?.value  || '').toLowerCase();
    const cat  =  document.getElementById('browseCategoryFilter')?.value || '';

    let jobs = APP.jobs;
    if (q)    jobs = jobs.filter(j => (j.title||'').toLowerCase().includes(q) || (j.company_name||'').toLowerCase().includes(q) || (j.description||'').toLowerCase().includes(q));
    if (type) jobs = jobs.filter(j => (j.employment_type||'').toLowerCase().includes(type));
    if (cat)  jobs = jobs.filter(j => j.category === cat);

    if (countEl) countEl.textContent = `${jobs.length} listing${jobs.length !== 1 ? 's' : ''} found`;

    if (!jobs.length) {
      el.innerHTML = emptyState('🔍', 'No jobs found', APP.jobs.length === 0
        ? 'No jobs have been posted yet.'
        : 'Try different keywords or filters.');
      return;
    }

    // ── FIX: normalise both sides to string ───────────────────────
    const appliedIds = new Set(APP.applications.map(a => String(a.job_id)));
    el.innerHTML = jobs.map(j => {
      const saved   = APP.savedIds.includes(String(j.id));
      const applied = appliedIds.has(String(j.id));
      return `
        <div class="browse-job-card" onclick="openJobModal('${escHtml(j.id)}')">
          <div class="jlogo">${abbrev(j.company_name || 'CO')}</div>
          <div class="jdetails" style="flex:1;min-width:0;">
            <div class="jtitle">${escHtml(j.title)}</div>
            <div class="jcompany">${escHtml(j.company_name)}${j.location ? ' · ' + escHtml(j.location) : ''}</div>
            <div class="jtags" style="margin-top:8px;">
              ${j.employment_type ? `<span class="jtag jtag-t">${escHtml(j.employment_type)}</span>` : ''}
              ${salaryLabel(j.salary_min, j.salary_max) ? `<span class="jtag jtag-s">${salaryLabel(j.salary_min, j.salary_max)}</span>` : ''}
              ${j.category ? `<span class="jtag jtag-r">${escHtml(j.category)}</span>` : ''}
            </div>
          </div>
          <div class="browse-job-actions">
            <button class="japply" ${applied ? 'disabled' : ''} onclick="event.stopPropagation();quickApply('${escHtml(j.id)}',this)">
              ${applied ? 'Applied ✓' : 'Apply Now'}
            </button>
            <button class="jsave-btn ${saved ? 'saved' : ''}" onclick="event.stopPropagation();toggleSave('${escHtml(j.id)}',this)">
              ${saved ? '🔖 Saved' : '🔖 Save'}
            </button>
          </div>
        </div>`;
    }).join('');
  };

  window.handleGlobalSearch = function (val) {
    const bi = document.getElementById('browseSearchInput');
    if (bi) bi.value = val;
    if (val.length > 1) showSection('browse', document.getElementById('nav-browse'));
    renderBrowse();
  };

  // ── JOB MODAL ─────────────────────────────────────────────────────
  window.openJobModal = function (jobId) {
    const job = APP.jobs.find(j => String(j.id) === String(jobId));
    if (!job) return;
    const saved   = APP.savedIds.includes(String(job.id));
    const applied = APP.applications.some(a => String(a.job_id) === String(job.id));
    const salary  = salaryLabel(job.salary_min, job.salary_max);
    const reqHtml = job.requirements
      ? `<ul>${job.requirements.split('\n').filter(Boolean).map(r => `<li>${escHtml(r.trim())}</li>`).join('')}</ul>`
      : '';

    document.getElementById('modalContent').innerHTML = `
      <div class="modal-header">
        <div class="modal-logo">${abbrev(job.company_name || 'CO')}</div>
        <div class="modal-title-group">
          <div class="modal-title">${escHtml(job.title)}</div>
          <div class="modal-company">${escHtml(job.company_name)}${job.location ? ' · ' + escHtml(job.location) : ''}</div>
          <div class="modal-tags">
            ${job.employment_type ? `<span class="jtag jtag-t">${escHtml(job.employment_type)}</span>` : ''}
            ${salary ? `<span class="jtag jtag-s">${salary}</span>` : ''}
            ${job.category ? `<span class="jtag jtag-r">${escHtml(job.category)}</span>` : ''}
          </div>
        </div>
        <button class="modal-close" onclick="closeModal()">✕</button>
      </div>
      <div class="modal-info-grid">
        <div class="modal-info-item"><div class="modal-info-label">Location</div><div class="modal-info-value">${escHtml(job.location || 'Not specified')}</div></div>
        <div class="modal-info-item"><div class="modal-info-label">Type</div><div class="modal-info-value">${escHtml(job.employment_type || 'Full-Time')}</div></div>
        <div class="modal-info-item"><div class="modal-info-label">Salary</div><div class="modal-info-value">${salary || 'Not disclosed'}</div></div>
        <div class="modal-info-item"><div class="modal-info-label">Posted</div><div class="modal-info-value">${job.created_at ? new Date(job.created_at).toLocaleDateString('en-ZA', { day:'numeric', month:'short', year:'numeric' }) : '—'}</div></div>
      </div>
      ${job.description ? `<div class="modal-section"><div class="modal-section-title">About the Role</div><div class="modal-body-text">${job.description.replace(/\n/g,'<br>')}</div></div>` : ''}
      ${reqHtml ? `<div class="modal-section"><div class="modal-section-title">Requirements</div><div class="modal-body-text">${reqHtml}</div></div>` : ''}
      <div class="modal-actions">
        <button class="modal-apply-btn" id="modalApplyBtn" ${applied ? 'disabled' : ''} onclick="applyFromModal('${escHtml(String(job.id))}')">
          ${applied ? 'Already Applied ✓' : 'Apply Now'}
        </button>
        <button class="modal-save-btn ${saved ? 'saved' : ''}" id="modalSaveBtn" onclick="toggleSaveModal('${escHtml(String(job.id))}')">
          ${saved ? '🔖 Saved' : '🔖 Save'}
        </button>
      </div>`;

    document.getElementById('jobModal').classList.add('open');
  };

  window.closeModal = function () {
    document.getElementById('jobModal').classList.remove('open');
  };

  // ── APPLY ─────────────────────────────────────────────────────────
  window.quickApply = async function (jobId, btn) {
    if (!APP.user) { showToast('Please sign in to apply.', 'error'); return; }

    const jobIdStr = String(jobId);

    if (APP.applications.some(a => String(a.job_id) === jobIdStr)) {
      if (btn) { btn.disabled = true; btn.textContent = 'Applied ✓'; }
      showToast('You already applied to this job.', 'error');
      return;
    }

    const job = APP.jobs.find(j => String(j.id) === jobIdStr);
    if (!job) { showToast('Job not found.', 'error'); return; }

    if (btn) { btn.disabled = true; btn.textContent = '…'; }

    // Open external application link in new tab
    if (job.apply_link) window.open(job.apply_link, '_blank');

    const db = window.supabaseClient;

    // ── FIX: try with job_snapshot first, fall back without it ─────
    // This prevents a crash if the column hasn't been added yet.
    let data, error;

    const insertPayload = {
      candidate_id: APP.user.id,
      job_id:       jobIdStr,
      status:       'applied',
      applied_at:   new Date().toISOString(),
      job_snapshot: {
        id:              jobIdStr,
        title:           job.title,
        company_name:    job.company_name,
        location:        job.location,
        employment_type: job.employment_type,
        category:        job.category,
        salary_min:      job.salary_min,
        salary_max:      job.salary_max,
      },
    };

    ({ data, error } = await db.from('applications').insert(insertPayload).select().single());

    // If job_snapshot column doesn't exist yet, retry without it
    if (error && error.message && error.message.includes('job_snapshot')) {
      console.warn('[HireArc] job_snapshot column missing — retrying without it. Run: ALTER TABLE applications ADD COLUMN job_snapshot jsonb;');
      const { job_snapshot: _omit, ...payloadWithoutSnapshot } = insertPayload;
      ({ data, error } = await db.from('applications').insert(payloadWithoutSnapshot).select().single());
    }

    if (error) {
      console.error('[HireArc] Apply error:', error);
      showToast('Could not submit: ' + error.message, 'error');
      if (btn) { btn.disabled = false; btn.textContent = 'Apply Now'; }
      return;
    }

    // Normalise and push into local state
    data.job_id       = String(data.job_id);
    data.job_postings = data.job_snapshot || {
      id:              jobIdStr,
      title:           job.title,
      company_name:    job.company_name,
      location:        job.location,
      employment_type: job.employment_type,
      category:        job.category,
    };

    APP.applications.unshift(data);

    if (btn) btn.textContent = 'Applied ✓';
    updateAppBadge();
    renderStats();
    renderOverviewApps();
    renderActivityChart(APP.applications);
    renderAppList();
    renderBrowse();
    renderRecommended();
    showToast(`Applied to ${job.title} 🎉`, 'success');
  };

  window.applyFromModal = async function (jobId) {
    const btn = document.getElementById('modalApplyBtn');
    await quickApply(jobId, btn);
    if (btn) btn.textContent = 'Already Applied ✓';
  };

  // ── SAVE / UNSAVE ─────────────────────────────────────────────────
  window.toggleSave = async function (jobId, _btn) {
    if (!APP.user) { showToast('Please sign in to save jobs.', 'error'); return; }

    const jobIdStr    = String(jobId);
    const wasSaved    = APP.savedIds.includes(jobIdStr);
    const prevSavedIds = [...APP.savedIds];

    // ── FIX: always store and compare strings ─────────────────────
    APP.savedIds = wasSaved
      ? APP.savedIds.filter(id => id !== jobIdStr)
      : [...APP.savedIds, jobIdStr];

    const db = window.supabaseClient;
    const { error } = await db.from('profiles')
      .update({ saved_jobs: APP.savedIds })
      .eq('id', APP.user.id);

    if (error) {
      APP.savedIds = prevSavedIds;
      showToast('Could not update saved jobs.', 'error');
      return;
    }
    renderStats();
    renderSavedGrid();
    renderBrowse();
    renderRecommended();
    showToast(wasSaved ? 'Job removed from saved.' : 'Job saved! 🔖', 'success');
  };

  window.toggleSaveModal = async function (jobId) {
    await toggleSave(jobId, null);
    const nowSaved = APP.savedIds.includes(String(jobId));
    const btn = document.getElementById('modalSaveBtn');
    if (btn) {
      btn.textContent = nowSaved ? '🔖 Saved' : '🔖 Save';
      btn.classList.toggle('saved', nowSaved);
    }
  };

  // ── PROFILE FORM ──────────────────────────────────────────────────
  function populateProfileForm() {
    const p = APP.profile || {};
    setVal('pFullName', p.full_name);
    setVal('pEmail',    p.email || APP.user?.email);
    setVal('pPhone',    p.phone);
    setVal('pLocation', p.location);
    setVal('pJobTitle', p.job_title);
    setVal('pBio',      p.bio);
    const expSel = document.getElementById('pExperience');
    if (expSel && p.experience_level) expSel.value = p.experience_level;
    if (p.cv_url) {
      setText('cvText', '✓ CV Uploaded');
      setText('cvSub',  p.cv_filename || 'Click to replace');
      const ic = document.getElementById('cvIcon');
      if (ic) ic.textContent = '✅';
    }
  }

  window.saveProfile = async function () {
    if (!APP.user) return;
    const db = window.supabaseClient;

    const payload = {
      id:          APP.user.id,
      full_name:   (document.getElementById('pFullName')?.value || '').trim() || null,
      email:       (document.getElementById('pEmail')?.value    || '').trim() || APP.user.email,
      phone:       (document.getElementById('pPhone')?.value    || '').trim() || null,
      location:    (document.getElementById('pLocation')?.value || '').trim() || null,
      job_title:   (document.getElementById('pJobTitle')?.value || '').trim() || null,
      bio:         (document.getElementById('pBio')?.value      || '').trim() || null,
      skills:      APP.skills,
      experiences: APP.experiences,
      updated_at:  new Date().toISOString(),
      role:        APP.profile?.role || 'candidate',
      // ── FIX: never wipe these on a profile text save ───────────
      avatar_url:  APP.profile?.avatar_url  || null,
      cv_url:      APP.profile?.cv_url      || null,
      cv_filename: APP.profile?.cv_filename || null,
    };

    const { error } = await db.from('profiles').upsert(payload, { onConflict: 'id' });
    if (error) { showToast('Failed to save: ' + error.message, 'error'); return; }

    const { data: fresh } = await db.from('profiles').select('*').eq('id', APP.user.id).single();
    if (fresh) {
      APP.profile     = fresh;
      APP.skills      = Array.isArray(fresh.skills)      ? fresh.skills      : [];
      APP.experiences = Array.isArray(fresh.experiences) ? fresh.experiences : [];
      APP.savedIds    = Array.isArray(fresh.saved_jobs)
        ? fresh.saved_jobs.map(id => String(id))
        : [];
    }

    updateSidebarUser();
    renderProfileStrength();
    showToast('Profile saved! ✓', 'success');
  };

  // ── SKILLS ────────────────────────────────────────────────────────
  function renderSkills() {
    const el = document.getElementById('skillsWrap');
    if (!el) return;
    el.innerHTML = APP.skills.map((s, i) =>
      `<span class="skill-tag">${escHtml(s)}<button class="skill-remove" onclick="removeSkill(${i})" title="Remove">×</button></span>`
    ).join('');
  }

  window.addSkill = function () {
    const input = document.getElementById('skillInput');
    const val   = (input?.value || '').trim();
    if (!val || APP.skills.includes(val)) { if (input) input.value = ''; return; }
    APP.skills.push(val);
    if (input) input.value = '';
    renderSkills();
    renderProfileStrength();
  };

  window.removeSkill = function (i) {
    APP.skills.splice(i, 1);
    renderSkills();
    renderProfileStrength();
  };

  // ── EXPERIENCES ────────────────────────────────────────────────────
  function renderExperiences() {
    const el = document.getElementById('experienceList');
    if (!el) return;
    if (!APP.experiences.length) { el.innerHTML = ''; return; }
    el.innerHTML = APP.experiences.map((e, i) => `
      <div style="background:var(--bg3);border:1px solid var(--border);border-radius:8px;padding:14px;position:relative;">
        <div style="font-size:14px;font-weight:600;color:var(--text);margin-bottom:2px;">${escHtml(e.title||'')}</div>
        <div style="font-size:12px;color:var(--muted);margin-bottom:6px;">${escHtml(e.company||'')}${e.period ? ' · ' + escHtml(e.period) : ''}</div>
        ${e.description ? `<div style="font-size:12px;color:var(--faint);line-height:1.6;">${escHtml(e.description)}</div>` : ''}
        <button onclick="removeExperience(${i})" style="position:absolute;top:10px;right:10px;background:none;border:none;color:var(--faint);cursor:pointer;font-size:14px;" title="Remove">✕</button>
      </div>`).join('');
  }

  window.addExperience = function () {
    const el = document.getElementById('experienceList');
    if (!el || document.getElementById('expInlineForm')) return;
    const form = document.createElement('div');
    form.id = 'expInlineForm';
    form.style.cssText = 'background:var(--bg3);border:1px solid rgba(245,166,35,0.3);border-radius:8px;padding:14px;display:flex;flex-direction:column;gap:8px;margin-bottom:10px;';
    form.innerHTML = `
      <input id="expTitle"   type="text" placeholder="Job Title *" style="background:var(--bg2);border:1px solid var(--border);border-radius:6px;padding:8px 12px;color:var(--text);font-size:13px;outline:none;width:100%;"/>
      <input id="expCompany" type="text" placeholder="Company"     style="background:var(--bg2);border:1px solid var(--border);border-radius:6px;padding:8px 12px;color:var(--text);font-size:13px;outline:none;width:100%;"/>
      <input id="expPeriod"  type="text" placeholder="Period e.g. Jan 2022 – Dec 2023" style="background:var(--bg2);border:1px solid var(--border);border-radius:6px;padding:8px 12px;color:var(--text);font-size:13px;outline:none;width:100%;"/>
      <textarea id="expDesc" rows="2" placeholder="Description (optional)" style="background:var(--bg2);border:1px solid var(--border);border-radius:6px;padding:8px 12px;color:var(--text);font-size:13px;outline:none;resize:none;"></textarea>
      <div style="display:flex;gap:8px;">
        <button onclick="confirmAddExperience()" style="flex:1;padding:8px;background:var(--amber);border:none;border-radius:6px;color:#0e0e0f;font-size:13px;font-weight:600;cursor:pointer;">Add</button>
        <button onclick="cancelAddExperience()"  style="padding:8px 16px;background:transparent;border:1px solid var(--border);border-radius:6px;color:var(--muted);font-size:13px;cursor:pointer;">Cancel</button>
      </div>`;
    el.insertBefore(form, el.firstChild);
  };

  window.confirmAddExperience = function () {
    const title = (document.getElementById('expTitle')?.value || '').trim();
    if (!title) { document.getElementById('expTitle').style.borderColor = 'var(--red)'; return; }
    APP.experiences.push({
      title,
      company:     (document.getElementById('expCompany')?.value || '').trim(),
      period:      (document.getElementById('expPeriod')?.value  || '').trim(),
      description: (document.getElementById('expDesc')?.value    || '').trim(),
    });
    cancelAddExperience();
    renderExperiences();
    renderProfileStrength();
    showToast('Experience added. Save your profile to keep it.', 'success');
  };

  window.cancelAddExperience = function () {
    const f = document.getElementById('expInlineForm');
    if (f) f.remove();
  };

  window.removeExperience = function (i) {
    APP.experiences.splice(i, 1);
    renderExperiences();
    renderProfileStrength();
  };

  // ── CV UPLOAD ─────────────────────────────────────────────────────
  window.simulateCVUpload = function () {
    if (!APP.user) return;
    const input = document.createElement('input');
    input.type   = 'file';
    input.accept = '.pdf,.doc,.docx';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      if (file.size > 5 * 1024 * 1024) { showToast('File too large (max 5MB).', 'error'); return; }
      setText('cvText', 'Uploading…');
      const db   = window.supabaseClient;
      const path = `cvs/${APP.user.id}/${Date.now()}_${file.name.replace(/\s/g, '_')}`;
      const { error: upErr } = await db.storage.from('resumes').upload(path, file, { upsert: true });
      if (upErr) { showToast('Upload failed: ' + upErr.message, 'error'); setText('cvText', 'Click to upload your CV'); return; }
      const { data: ud } = db.storage.from('resumes').getPublicUrl(path);
      const cvUrl = ud?.publicUrl;
      if (!cvUrl) { showToast('Could not get file URL.', 'error'); return; }
      await db.from('profiles').update({ cv_url: cvUrl, cv_filename: file.name, updated_at: new Date().toISOString() }).eq('id', APP.user.id);
      if (APP.profile) { APP.profile.cv_url = cvUrl; APP.profile.cv_filename = file.name; }
      setText('cvText', `✓ ${file.name}`);
      setText('cvSub', 'Click to replace');
      const ic = document.getElementById('cvIcon');
      if (ic) ic.textContent = '✅';
      renderProfileStrength();
      showToast('CV uploaded! ✓', 'success');
    };
    input.click();
  };

  // ── PHOTO UPLOAD ──────────────────────────────────────────────────
  window.simulatePhotoUpload = function () {
    if (!APP.user) return;
    const input = document.createElement('input');
    input.type   = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      if (file.size > 3 * 1024 * 1024) { showToast('Image too large (max 3MB).', 'error'); return; }
      const db   = window.supabaseClient;
      const path = `avatars/${APP.user.id}/${Date.now()}_${file.name.replace(/\s/g, '_')}`;
      const { error: upErr } = await db.storage.from('avatars').upload(path, file, { upsert: true });
      if (upErr) { showToast('Photo upload failed: ' + upErr.message, 'error'); return; }
      const { data: ud } = db.storage.from('avatars').getPublicUrl(path);
      const url = ud?.publicUrl;
      if (!url) { showToast('Could not get photo URL.', 'error'); return; }
      await db.from('profiles').update({ avatar_url: url, updated_at: new Date().toISOString() }).eq('id', APP.user.id);
      if (APP.profile) APP.profile.avatar_url = url;
      ['sidebarAvatar','profilePhotoAvatar'].forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.style.backgroundImage = `url(${url})`; el.style.backgroundSize = 'cover'; el.textContent = ''; }
      });
      showToast('Photo updated! ✓', 'success');
    };
    input.click();
  };

  // ── NAVIGATION ────────────────────────────────────────────────────
  window.showSection = function (name, navEl) {
    document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    const sec = document.getElementById(`section-${name}`);
    if (sec) sec.classList.add('active');
    if (navEl) navEl.classList.add('active');
    const map = {
      overview:     () => { renderStats(); renderOverviewApps(); renderRecommended(); renderActivityChart(APP.applications); },
      applications: renderAppList,
      saved:        renderSavedGrid,
      browse:       renderBrowse,
      profile:      () => { populateProfileForm(); renderSkills(); renderExperiences(); renderProfileStrength(); },
    };
    if (map[name]) map[name]();
  };

  // ── SIGN OUT & NOTIFICATIONS ──────────────────────────────────────
  function wireSignOut() {
    document.getElementById('signOutBtn')?.addEventListener('click', async () => {
      if (!confirm('Sign out of HireArc?')) return;
      const db = window.supabaseClient;
      await db.auth.signOut();
      showToast('Signed out', 'success');
      setTimeout(() => window.location.href = 'login.html', 800);
    });
  }

  function wireNotifBtn() {
    document.getElementById('notifBtn')?.addEventListener('click', () => {
      const iv = APP.applications.filter(a => ['interview','reviewed'].includes(a.status)).length;
      const sl = APP.applications.filter(a => a.status === 'shortlisted').length;
      if (!iv && !sl) { showToast('No new notifications', 'success'); return; }
      showToast(`🎉 ${iv} interview${iv !== 1 ? 's' : ''} · ${sl} shortlisted`, 'success');
    });
  }

  // ── TOAST ─────────────────────────────────────────────────────────
  let toastTimer;
  window.showToast = function (msg, type = 'success') {
    const toast  = document.getElementById('toast');
    const msgEl  = document.getElementById('toastMsg');
    const iconEl = document.getElementById('toastIcon');
    if (!toast) return;
    if (msgEl)  msgEl.textContent  = msg;
    if (iconEl) iconEl.textContent = type === 'success' ? '✓' : '✕';
    toast.className = `toast ${type} show`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 3500);
  };

  // ── HELPERS ───────────────────────────────────────────────────────
  function salaryLabel(min, max) {
    if (!min && !max) return '';
    const fmt = n => 'R' + Number(n).toLocaleString('en-ZA');
    if (min && max) return `${fmt(min)} – ${fmt(max)}`;
    if (min) return `From ${fmt(min)}`;
    return `Up to ${fmt(max)}`;
  }

  function statusClass(s) {
    return ({ interview:'s-interview', reviewed:'s-reviewed', shortlisted:'s-shortlisted', pending:'s-pending', applied:'s-applied', rejected:'s-rejected' })[s] || 's-pending';
  }

  function formatStatus(s) {
    return ({ interview:'Interview', reviewed:'Reviewed', shortlisted:'Shortlisted', pending:'Pending', applied:'Applied', rejected:'Not Selected' })[s] || (s || 'Pending');
  }

  function abbrev(name)   { return String(name).slice(0, 3).toUpperCase(); }
  function escHtml(str)   { return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function setText(id, v) { const el = document.getElementById(id); if (el) el.textContent = v; }
  function setVal(id, v)  { const el = document.getElementById(id); if (el && v != null) el.value = v; }
  function emptyState(icon, title, sub) {
    return `<div class="empty-state"><div class="empty-icon">${icon}</div><div class="empty-text">${title}</div><div class="empty-sub">${sub}</div></div>`;
  }

})();
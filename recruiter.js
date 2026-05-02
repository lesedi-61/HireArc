// ================================================================
//  HireArc — recruiter.js  v3  (PRODUCTION — zero dummies)
//
//  Reads real data from Supabase:
//    profiles        → recruiter name / avatar / company
//    job_postings    → jobs (recruiter_id = current user)
//    applications    → joined with profiles + job_postings
//
//  Requires supabase-client.js loaded first (window.supabaseClient).
// ================================================================

(function () {
  'use strict';

  // Only boot on the recruiter dashboard page
  if (!document.getElementById('section-overview')) return;
  if (window.__HIREARC_RECRUITER_BOOTED__) return;
  window.__HIREARC_RECRUITER_BOOTED__ = true;

  // ── STATE ────────────────────────────────────────────────────────
  const APP = {
    user:          null,
    profile:       null,
    jobs:          [],
    applications:  [],
    jobsFilter:    'all',
    appsFilter:    'all',
    pipelineJobId: null,
    editingJobId:  null,
  };

  // Shorthand — always returns the live supabase client
  const supa = () => window.supabaseClient;

  // ── BOOT ─────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', async () => {
    if (!supa()) {
      console.error('[HireArc] supabaseClient missing — check load order');
      return;
    }

    let booted = false;

    async function tryBoot(session) {
      if (!session?.user || booted) return;
      booted = true;
      APP.user = session.user;
      await initApp();
    }

    // Existing session
    try {
      const { data: { session } } = await supa().auth.getSession();
      await tryBoot(session);
    } catch (e) {
      console.error('[HireArc] getSession:', e);
    }

    // Auth state changes (login / logout)
    supa().auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN')  await tryBoot(session);
      if (event === 'SIGNED_OUT') window.location.href = 'login.html';
    });
  });

  // ── INIT ─────────────────────────────────────────────────────────
  async function initApp() {
    updateDateGreeting();
    showLoadingState();

    await loadProfile();
    await loadJobs();
    await loadApplications();

    hideLoadingState();
    renderAll();

    wireSignOut();
    wirePostJobModal();
    wireJobFilterTabs();
    wireAppsFilterTabs();
  }

  // Show skeleton while loading
  function showLoadingState() {
    setText('statJobs', '…');
    setText('statApps', '…');
    setText('statShortlisted', '…');
    setText('statInterviews', '…');
  }
  function hideLoadingState() {}

  function renderAll() {
    renderSidebarUser();
    renderStats();
    renderOverviewJobsTable();
    renderFullJobsTable();
    renderApplicantsList();
    renderPipeline();
    renderAnalytics();
    renderUpcomingInterviews();
    updateAppsFilterCounts();
    updateJobFilterCounts();
  }

  // ── DATA: PROFILE ────────────────────────────────────────────────
  async function loadProfile() {
    const { data, error } = await supa()
      .from('profiles')
      .select('*')
      .eq('id', APP.user.id)
      .single();

    if (error) {
      console.warn('[HireArc] Profile fetch failed:', error.message);
      APP.profile = null;
      return;
    }
    APP.profile = data;
  }

  // ── DATA: JOBS ───────────────────────────────────────────────────
  async function loadJobs() {
    const { data, error } = await supa()
      .from('job_postings')
      .select('*')
      .eq('recruiter_id', APP.user.id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[HireArc] loadJobs:', error.message);
      APP.jobs = [];
      return;
    }
    APP.jobs = data || [];
    console.log('[HireArc] Jobs loaded:', APP.jobs.length);
  }

  // ── DATA: APPLICATIONS ───────────────────────────────────────────
  async function loadApplications() {
    if (!APP.jobs.length) {
      APP.applications = [];
      return;
    }

    const jobIds = APP.jobs.map(j => j.id);

    // Try with FK hint first; fall back to generic if it errors
    let { data, error } = await supa()
      .from('applications')
      .select(`
        id, job_id, status, applied_at, match_score, resume_url,
        cover_letter, years_experience, interview_date,
        job_postings ( id, title, company_name, location ),
        profiles ( id, full_name, email, avatar_url )
      `)
      .in('job_id', jobIds)
      .order('applied_at', { ascending: false });

    if (error) {
      // FK alias may differ — retry without alias
      console.warn('[HireArc] loadApplications (retry):', error.message);
      const retry = await supa()
        .from('applications')
        .select(`
          id, job_id, status, applied_at, match_score, resume_url,
          cover_letter, years_experience, interview_date,
          job_postings ( id, title, company_name, location ),
          profiles ( id, full_name, email, avatar_url )
        `)
        .in('job_id', jobIds)
        .order('applied_at', { ascending: false });

      if (retry.error) {
        console.error('[HireArc] loadApplications failed:', retry.error.message);
        APP.applications = [];
        return;
      }
      data = retry.data;
    }

    APP.applications = data || [];
    console.log('[HireArc] Applications loaded:', APP.applications.length);
  }

  // ── RENDER: SIDEBAR USER ──────────────────────────────────────────
  function renderSidebarUser() {
    const p    = APP.profile;
    const name = p?.full_name?.trim() || APP.user?.email || 'Recruiter';
    const ini  = initials(name);

    setText('sidebarName', name);
    setText('sidebarRole', 'Recruiter');

    // Topbar greeting
    const greetEl = document.getElementById('topbarGreeting');
    if (greetEl) greetEl.textContent = name.split(' ')[0];

    // Avatar
    const avatarEl = document.getElementById('sidebarAvatar');
    if (avatarEl) {
      if (p?.avatar_url) {
        avatarEl.style.backgroundImage  = `url(${p.avatar_url})`;
        avatarEl.style.backgroundSize   = 'cover';
        avatarEl.style.backgroundRepeat = 'no-repeat';
        avatarEl.textContent = '';
      } else {
        avatarEl.style.backgroundImage = '';
        avatarEl.textContent = ini;
      }
    }

    // Company block
    const companyNameEl = document.querySelector('.company-name');
    const companyLogoEl = document.querySelector('.company-logo-box');
    if (companyNameEl && p?.company_name) {
      companyNameEl.textContent = p.company_name;
    }
    if (companyLogoEl && p?.company_name) {
      companyLogoEl.textContent = p.company_name.slice(0, 2).toUpperCase();
    }
  }

  // ── RENDER: STATS ─────────────────────────────────────────────────
  function renderStats() {
    const activeJobs  = APP.jobs.filter(j => (j.status || 'active') === 'active').length;
    const shortlisted = APP.applications.filter(a => a.status === 'shortlisted').length;
    const interviews  = APP.applications.filter(a => a.status === 'interview').length;

    setText('statJobs',        activeJobs);
    setText('statApps',        APP.applications.length);
    setText('statShortlisted', shortlisted);
    setText('statInterviews',  interviews);

    // Sidebar badge
    const badge = document.querySelector('.nav-badge');
    if (badge) badge.textContent = APP.applications.length || '0';

    // "View all X" link in overview
    const viewAllBtn = document.querySelector('#section-overview .card-action');
    if (viewAllBtn && viewAllBtn.textContent.includes('View all')) {
      viewAllBtn.textContent = `View all ${APP.applications.length} →`;
    }

    // Subtitle in applicants section
    const appsSubEl = document.querySelector('#section-applicants .page-section > div > div:last-child');
    if (appsSubEl) {
      const roleCount = new Set(APP.applications.map(a => a.job_id)).size;
      appsSubEl.textContent = `${APP.applications.length} candidates across ${roleCount} open roles.`;
    }
  }

  // ── RENDER: OVERVIEW JOBS TABLE (top 4) ───────────────────────────
  function renderOverviewJobsTable() {
    const tbody = document.getElementById('jobsTableBody');
    if (!tbody) return;

    if (!APP.jobs.length) {
      tbody.innerHTML = `<tr><td colspan="4">
        <div class="empty-state">
          <div class="empty-icon">📋</div>
          <div class="empty-text">No job listings yet</div>
          <div class="empty-sub">Click "Post a Job" to create your first listing.</div>
        </div>
      </td></tr>`;
      return;
    }

    tbody.innerHTML = APP.jobs.slice(0, 4).map(job => jobTableRow(job, false)).join('');
  }

  // ── RENDER: FULL JOBS TABLE ───────────────────────────────────────
  function renderFullJobsTable() {
    const section = document.getElementById('section-jobs');
    if (!section) return;
    const tbody = section.querySelector('tbody');
    if (!tbody) return;

    let jobs = [...APP.jobs];
    if (APP.jobsFilter !== 'all') {
      jobs = jobs.filter(j => (j.status || 'active') === APP.jobsFilter);
    }

    updateJobFilterCounts();

    if (!jobs.length) {
      tbody.innerHTML = `<tr><td colspan="5">
        <div class="empty-state">
          <div class="empty-icon">📋</div>
          <div class="empty-text">No listings match this filter</div>
          <div class="empty-sub">Try a different filter or post a new job.</div>
        </div>
      </td></tr>`;
      return;
    }

    tbody.innerHTML = jobs.map(job => jobTableRow(job, true)).join('');
  }

  function jobTableRow(job, showPostedCol) {
    const status   = job.status || 'active';
    const appCount = APP.applications.filter(a => a.job_id === job.id).length;
    const pct      = Math.min(100, Math.round((appCount / 25) * 100));
    const posted   = job.created_at
      ? new Date(job.created_at).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short' })
      : '—';

    let actions = `
      <button class="jt-btn primary" onclick="filterToJob('${job.id}')">View</button>
      <button class="jt-btn" onclick="openModal('${job.id}')">Edit</button>`;

    if (status === 'active')  actions += `<button class="jt-btn" onclick="changeJobStatus('${job.id}','paused')">Pause</button>`;
    if (status === 'paused')  actions += `<button class="jt-btn" onclick="changeJobStatus('${job.id}','active')">Resume</button>`;
    if (status === 'draft') {
      actions += `<button class="jt-btn" onclick="changeJobStatus('${job.id}','active')">Publish</button>`;
      actions += `<button class="jt-btn" style="color:var(--red);border-color:rgba(224,85,85,0.3);" onclick="deleteJob('${job.id}')">Delete</button>`;
    }
    if (status === 'closed')  actions += `<button class="jt-btn" onclick="changeJobStatus('${job.id}','active')">Reopen</button>`;

    const postedTd = showPostedCol
      ? `<td><span style="font-size:12px;color:var(--muted);font-family:'DM Mono',monospace;">${esc(posted)}</span></td>`
      : '';

    return `
      <tr>
        <td>
          <div class="jt-title">${esc(job.title)}</div>
          <div class="jt-meta">${esc(job.location || 'Remote')} · ${esc(job.employment_type || 'Full-time')}${salaryLabel(job)}</div>
        </td>
        <td><span class="jt-status ${statusBadgeClass(status)}">${statusLabel(status)}</span></td>
        <td>
          <div class="jt-bar-wrap">
            <div class="jt-bar"><div class="jt-bar-fill" style="width:${pct}%"></div></div>
            <span class="jt-bar-num">${appCount || '—'}</span>
          </div>
        </td>
        ${postedTd}
        <td><div class="jt-actions">${actions}</div></td>
      </tr>`;
  }

  // ── RENDER: APPLICANTS LIST ───────────────────────────────────────
  function renderApplicantsList() {
    const list = document.getElementById('applicantsList');
    if (!list) return;

    let apps = [...APP.applications];

    if (APP.appsFilter.startsWith('job-')) {
      const jobId = APP.appsFilter.replace('job-', '');
      apps = apps.filter(a => a.job_id === jobId);
    } else if (APP.appsFilter !== 'all') {
      apps = apps.filter(a => a.status === APP.appsFilter);
    }

    updateAppsFilterCounts();

    if (!apps.length) {
      list.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">👥</div>
          <div class="empty-text">No applicants found</div>
          <div class="empty-sub">
            ${APP.appsFilter !== 'all' ? 'Try a different filter or check back later.' : 'Applicants will appear here once candidates apply.'}
          </div>
        </div>`;
      return;
    }

    list.innerHTML = apps.map(app => {
      const profile = app.profiles || {};
      const job     = app.job_postings || {};
      const name    = profile.full_name?.trim() || profile.email || 'Applicant';
      const ini     = initials(name);
      const match   = app.match_score != null ? Math.round(app.match_score) + '%' : '—';
      const sc      = appStatusClass(app.status);

      return `
        <div class="applicant-row">
          <div class="ap-avatar">${ini}</div>
          <div class="ap-info">
            <div class="ap-name">${esc(name)}</div>
            <div class="ap-meta">${esc(profile.email || '')}${app.years_experience ? ' · ' + app.years_experience + ' yrs exp' : ''}</div>
          </div>
          <div class="ap-job">Applied for <span>${esc(job.title || 'Unknown Role')}</span></div>
          <div style="text-align:center;">
            <div class="ap-match">${match}</div>
            <div class="ap-match-label">Match</div>
          </div>
          <span class="ap-status ${sc}">${fmtStatus(app.status)}</span>
          <div class="ap-actions">${buildAppActions(app)}</div>
        </div>`;
    }).join('');
  }

  function buildAppActions(app) {
    const id   = app.id;
    const btns = [];

    if (app.status === 'applied') {
      btns.push(`<button class="ap-btn" onclick="setAppStatus('${id}','reviewed')">Review</button>`);
      btns.push(`<button class="ap-btn green-btn" onclick="setAppStatus('${id}','shortlisted')">Shortlist</button>`);
    } else if (app.status === 'reviewed') {
      btns.push(`<button class="ap-btn green-btn" onclick="setAppStatus('${id}','shortlisted')">Shortlist</button>`);
      btns.push(`<button class="ap-btn" style="color:var(--red);border-color:rgba(224,85,85,0.3);" onclick="setAppStatus('${id}','rejected')">Reject</button>`);
    } else if (app.status === 'shortlisted') {
      btns.push(`<button class="ap-btn green-btn" onclick="setAppStatus('${id}','interview')">Schedule</button>`);
      btns.push(`<button class="ap-btn" style="color:var(--red);border-color:rgba(224,85,85,0.3);" onclick="setAppStatus('${id}','rejected')">Reject</button>`);
    } else if (app.status === 'interview') {
      btns.push(`<button class="ap-btn green-btn" onclick="setAppStatus('${id}','offered')">Offer</button>`);
      btns.push(`<button class="ap-btn" style="color:var(--red);border-color:rgba(224,85,85,0.3);" onclick="setAppStatus('${id}','rejected')">Reject</button>`);
    } else if (app.status === 'rejected') {
      btns.push(`<button class="ap-btn" onclick="setAppStatus('${id}','reviewed')">Reconsider</button>`);
    }

    if (app.resume_url) {
      btns.push(`<button class="ap-btn" onclick="window.open('${app.resume_url}','_blank')">View CV</button>`);
    } else {
      btns.push(`<button class="ap-btn" style="opacity:0.4;cursor:default;" disabled>No CV</button>`);
    }

    return btns.join('');
  }

  // ── RENDER: PIPELINE ─────────────────────────────────────────────
  function renderPipeline() {
    const section = document.getElementById('section-pipeline');
    if (!section) return;

    // ── Job selector tabs
    const tabsWrap = section.querySelector('[style*="display:flex"][style*="gap:8px"]');
    if (tabsWrap) {
      if (!APP.jobs.length) {
        tabsWrap.innerHTML = `<span style="font-size:13px;color:var(--muted);">No jobs yet — post one first.</span>`;
      } else {
        if (!APP.pipelineJobId) APP.pipelineJobId = APP.jobs[0].id;
        tabsWrap.innerHTML = APP.jobs.slice(0, 6).map(job => {
          const c       = APP.applications.filter(a => a.job_id === job.id).length;
          const active  = job.id === APP.pipelineJobId;
          return `<button class="ftab${active ? ' active' : ''}"
            onclick="selectPipelineJob('${job.id}',this)">${esc(job.title)} (${c})</button>`;
        }).join('');
      }
    }

    // ── Kanban columns
    const stages = [
      { key: 'applied',     label: 'Applied'      },
      { key: 'reviewed',    label: 'Reviewing'    },
      { key: 'shortlisted', label: 'Shortlisted'  },
      { key: 'interview',   label: 'Interview'    },
    ];

    stages.forEach(({ key, label }) => {
      const col = document.getElementById(`pipeline-${key}`);
      if (!col) return;

      const apps = APP.pipelineJobId
        ? APP.applications.filter(a => a.job_id === APP.pipelineJobId && a.status === key)
        : [];

      const nextMap = { applied: 'reviewed', reviewed: 'shortlisted', shortlisted: 'interview', interview: null };
      const next    = nextMap[key];

      const cards = apps.map(app => {
        const profile = app.profiles || {};
        const name    = profile.full_name?.trim() || profile.email || 'Applicant';
        const ini     = initials(name);
        const match   = app.match_score != null ? Math.round(app.match_score) + '%' : '—';
        const when    = app.applied_at ? timeAgo(app.applied_at) : '';

        const moveBtn = next
          ? `<button style="margin-top:8px;width:100%;padding:5px;border-radius:5px;
               font-size:10px;font-family:'DM Mono',monospace;cursor:pointer;
               background:rgba(245,166,35,0.08);border:1px solid rgba(245,166,35,0.2);
               color:var(--amber);" onclick="setAppStatus('${app.id}','${next}')">
               Move → ${next.charAt(0).toUpperCase() + next.slice(1)}
             </button>`
          : '';

        return `
          <div class="pipeline-card">
            <div class="pc-name">${esc(name)}</div>
            <div class="pc-role">${app.years_experience ? app.years_experience + ' yrs exp' : 'N/A'}</div>
            <div class="pc-tags"><span class="pc-tag pct-match">${match}</span></div>
            ${moveBtn}
            <div class="pc-footer">
              <span class="pc-date">${when}</span>
              <div class="pc-avatar-wrap"><div class="pc-avatar">${ini}</div></div>
            </div>
          </div>`;
      }).join('');

      col.innerHTML = `
        <div class="pipeline-col-header">
          <span class="pipeline-col-title">${label}</span>
          <span class="pipeline-col-count">${apps.length}</span>
        </div>
        ${cards || `<div style="text-align:center;padding:20px 0;font-size:12px;color:var(--faint);">No candidates</div>`}`;
    });
  }

  // ── RENDER: UPCOMING INTERVIEWS ───────────────────────────────────
  function renderUpcomingInterviews() {
    // Find the "Upcoming Interviews" card body
    let interviewBody = null;
    document.querySelectorAll('.card-title').forEach(h => {
      if (h.textContent.trim() === 'Upcoming Interviews') {
        interviewBody = h.closest('.card')?.querySelector('.card-body');
      }
    });
    if (!interviewBody) return;

    const interviews = APP.applications
      .filter(a => a.status === 'interview')
      .slice(0, 3);

    if (!interviews.length) {
      interviewBody.innerHTML = `
        <div class="empty-state" style="padding:24px 0;">
          <div class="empty-icon" style="font-size:28px;margin-bottom:10px;">📅</div>
          <div class="empty-text" style="font-size:13px;">No interviews scheduled</div>
          <div class="empty-sub">Shortlist candidates to schedule interviews.</div>
        </div>`;
      return;
    }

    interviewBody.innerHTML = `<div style="display:flex;flex-direction:column;gap:12px;">` +
      interviews.map(app => {
        const profile = app.profiles || {};
        const job     = app.job_postings || {};
        const name    = profile.full_name?.trim() || profile.email || 'Candidate';
        const dateObj = app.interview_date ? new Date(app.interview_date) : null;
        const dayStr  = dateObj ? dateObj.toLocaleDateString('en-ZA', { weekday: 'short' }).toUpperCase() : '—';
        const dayNum  = dateObj ? dateObj.getDate() : '?';
        const timeStr = dateObj ? dateObj.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' }) : 'TBD';
        const isNext  = interviews[0] === app;

        return `
          <div style="background:var(--bg3);border:1px solid ${isNext ? 'rgba(245,166,35,0.2)' : 'var(--border)'};
               border-radius:9px;padding:14px;display:flex;gap:12px;align-items:center;">
            <div style="background:${isNext ? 'rgba(245,166,35,0.1)' : 'var(--bg4)'};
                 border:1px solid ${isNext ? 'rgba(245,166,35,0.2)' : 'var(--border)'};
                 border-radius:8px;padding:8px 12px;text-align:center;flex-shrink:0;">
              <div style="font-family:'DM Mono',monospace;font-size:9px;
                   color:${isNext ? 'var(--amber)' : 'var(--muted)'};
                   letter-spacing:1px;text-transform:uppercase;">${dayStr}</div>
              <div style="font-family:'Bebas Neue',sans-serif;font-size:24px;
                   color:${isNext ? 'var(--amber)' : 'var(--text)'};line-height:1;">${dayNum}</div>
            </div>
            <div>
              <div style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:2px;">${esc(name)}</div>
              <div style="font-size:11px;color:var(--muted);">${esc(job.title || 'Role')} · ${timeStr}</div>
            </div>
          </div>`;
      }).join('') + `</div>`;
  }

  // ── RENDER: LATEST APPLICANTS (overview) ─────────────────────────
  function renderOverviewApplicants() {
    const list = document.querySelector('#section-overview .card:last-of-type .applicants-list');
    if (!list) return;

    const recent = APP.applications.slice(0, 3);
    if (!recent.length) {
      list.innerHTML = `<div class="empty-state" style="padding:30px 0;">
        <div class="empty-icon" style="font-size:28px;">👥</div>
        <div class="empty-text">No applicants yet</div>
        <div class="empty-sub">They'll appear here once candidates apply.</div>
      </div>`;
      return;
    }

    list.innerHTML = recent.map(app => {
      const profile = app.profiles || {};
      const job     = app.job_postings || {};
      const name    = profile.full_name?.trim() || profile.email || 'Applicant';
      const ini     = initials(name);
      const match   = app.match_score != null ? Math.round(app.match_score) + '%' : '—';
      const sc      = appStatusClass(app.status);

      return `
        <div class="applicant-row">
          <div class="ap-avatar">${ini}</div>
          <div class="ap-info">
            <div class="ap-name">${esc(name)}</div>
            <div class="ap-meta">${app.years_experience ? app.years_experience + ' yrs exp' : esc(profile.email || '')}</div>
          </div>
          <div class="ap-job">Applied for <span>${esc(job.title || '—')}</span></div>
          <div style="text-align:center;">
            <div class="ap-match">${match}</div>
            <div class="ap-match-label">Match</div>
          </div>
          <span class="ap-status ${sc}">${fmtStatus(app.status)}</span>
          <div class="ap-actions">${buildAppActions(app)}</div>
        </div>`;
    }).join('');
  }

  // ── RENDER: ANALYTICS ────────────────────────────────────────────
  function renderAnalytics() {
    // Bar chart — applications per day, last 7 days
    const now  = new Date();
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(now);
      d.setDate(now.getDate() - (6 - i));
      return d;
    });

    const labels = days.map(d => d.toLocaleDateString('en-ZA', { weekday: 'short' }));
    const counts = days.map(d => {
      const ds = d.toDateString();
      return APP.applications.filter(a =>
        a.applied_at && new Date(a.applied_at).toDateString() === ds
      ).length;
    });

    const maxC  = Math.max(...counts, 1);
    const bars  = document.getElementById('analyticsBars');
    if (bars) {
      bars.innerHTML = counts.map((c, i) => `
        <div class="ab-wrap">
          <div class="abar" style="height:${Math.max(6, Math.round((c / maxC) * 96))}px;
               background:${c > 0 ? 'var(--amber)' : 'var(--bg4)'};"></div>
          <div class="abar-label">${labels[i]}</div>
        </div>`).join('');
    }

    // Conversion rate
    const total = APP.applications.length;
    const adv   = APP.applications.filter(a =>
      ['shortlisted', 'interview', 'offered'].includes(a.status)
    ).length;
    const rate  = total ? Math.round((adv / total) * 100) : 0;

    // Update the big green number
    document.querySelectorAll('.card-title').forEach(h => {
      if (h.textContent.trim() === 'Conversion Rate') {
        const bigNum = h.closest('.card')?.querySelector('[style*="56px"]');
        if (bigNum) bigNum.textContent = rate + '%';

        // Legend counts
        const lItems = h.closest('.card')?.querySelectorAll('.aleg');
        if (lItems?.length >= 3) {
          const reviewed = APP.applications.filter(a => a.status === 'reviewed').length;
          lItems[0].lastChild.textContent = ` Applied: ${total}`;
          lItems[1].lastChild.textContent = ` Reviewed: ${reviewed}`;
          lItems[2].lastChild.textContent = ` Shortlisted: ${adv}`;
        }
      }
    });
  }

  // ── SECTION NAVIGATION ───────────────────────────────────────────
  window.showSection = function (name, btn) {
    document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));
    const sec = document.getElementById(`section-${name}`);
    if (sec) sec.classList.add('active');

    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    if (btn) btn.classList.add('active');

    // Re-render on visit
    if (name === 'overview')   { renderOverviewJobsTable(); renderOverviewApplicants(); renderUpcomingInterviews(); renderStats(); }
    if (name === 'jobs')       renderFullJobsTable();
    if (name === 'applicants') { updateAppsFilterCounts(); renderApplicantsList(); }
    if (name === 'pipeline')   renderPipeline();
    if (name === 'analytics')  renderAnalytics();
  };

  // ── MODAL: POST / EDIT JOB ────────────────────────────────────────
  window.openModal = function (jobId) {
    APP.editingJobId = jobId || null;
    const overlay   = document.getElementById('modalOverlay');
    if (!overlay) return;

    const titleEl  = overlay.querySelector('.modal-title');
    const subEl    = overlay.querySelector('.modal-sub');
    const submitEl = overlay.querySelector('.btn-modal-post');

    if (jobId) {
      const job = APP.jobs.find(j => j.id === jobId);
      if (job) {
        setVal('jobTitle',       job.title);
        setVal('jobCompany',     job.company_name || (APP.profile?.company_name || ''));
        setVal('jobLocation',    job.location    || '');
        setVal('jobType',        job.employment_type || 'Full-time');
        setVal('jobCategory',    job.category    || 'Engineering');
        setVal('jobSalaryMin',   job.salary_min  || '');
        setVal('jobSalaryMax',   job.salary_max  || '');
        setVal('jobDescription', job.description || '');
        setVal('jobRequirements',job.requirements|| '');
        setVal('jobApplyLink',   job.apply_link  || '');
      }
      if (titleEl)  titleEl.textContent  = 'Edit Job Listing';
      if (subEl)    subEl.textContent    = 'Update the details below and save.';
      if (submitEl) submitEl.textContent = 'Save Changes →';
    } else {
      document.getElementById('postJobForm')?.reset();
      // Pre-fill company from profile
      if (APP.profile?.company_name) setVal('jobCompany', APP.profile.company_name);
      if (titleEl)  titleEl.textContent  = 'Post a New Job';
      if (subEl)    subEl.textContent    = 'Fill in the details and publish immediately or save as draft.';
      if (submitEl) submitEl.textContent = 'Publish Job →';
    }

    overlay.classList.add('open');
  };

  window.closeModal = function () {
    document.getElementById('modalOverlay')?.classList.remove('open');
    APP.editingJobId = null;
  };

  window.closeModalOutside = function (e) {
    if (e.target === document.getElementById('modalOverlay')) closeModal();
  };

  function wirePostJobModal() {
    const form = document.getElementById('postJobForm');
    if (!form) return;

    form.onsubmit = async (e) => {
      e.preventDefault();

      const submitBtn = form.querySelector('.btn-modal-post');
      if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Saving…'; }

      const payload = {
        title:           getVal('jobTitle'),
        company_name:    getVal('jobCompany') || APP.profile?.company_name || '',
        location:        getVal('jobLocation'),
        employment_type: getVal('jobType'),
        category:        getVal('jobCategory'),
        salary_min:      parseFloat(getVal('jobSalaryMin'))  || null,
        salary_max:      parseFloat(getVal('jobSalaryMax'))  || null,
        description:     getVal('jobDescription'),
        requirements:    getVal('jobRequirements'),
        apply_link:      getVal('jobApplyLink') || null,
      };

      let dbError;

      if (APP.editingJobId) {
        const { error } = await supa()
          .from('job_postings')
          .update(payload)
          .eq('id', APP.editingJobId);
        dbError = error;
      } else {
        const { error } = await supa()
          .from('job_postings')
          .insert({
            ...payload,
            recruiter_id: APP.user.id,
            status:       'active',
            created_at:   new Date().toISOString(),
          });
        dbError = error;
      }

      if (submitBtn) {
        submitBtn.disabled    = false;
        submitBtn.textContent = APP.editingJobId ? 'Save Changes →' : 'Publish Job →';
      }

      if (dbError) {
        toast('Failed: ' + dbError.message, 'error');
        return;
      }

      toast(APP.editingJobId ? 'Job updated!' : 'Job posted!', 'success');
      closeModal();

      // Reload fresh data
      await loadJobs();
      await loadApplications();
      renderAll();
    };
  }

  // ── JOB ACTIONS ──────────────────────────────────────────────────
  window.changeJobStatus = async function (jobId, newStatus) {
    const { error } = await supa()
      .from('job_postings')
      .update({ status: newStatus })
      .eq('id', jobId);

    if (error) { toast('Failed: ' + error.message, 'error'); return; }
    toast(`Job ${newStatus}.`, 'success');
    await loadJobs();
    renderAll();
  };

  window.deleteJob = async function (jobId) {
    if (!confirm('Delete this listing? This cannot be undone.')) return;
    const { error } = await supa()
      .from('job_postings')
      .delete()
      .eq('id', jobId);
    if (error) { toast('Failed: ' + error.message, 'error'); return; }
    toast('Job deleted.', 'success');
    await loadJobs();
    await loadApplications();
    renderAll();
  };

  window.filterToJob = function (jobId) {
    APP.appsFilter = 'job-' + jobId;
    const navItems = document.querySelectorAll('.nav-item');
    showSection('applicants', navItems[2]);
  };

  // ── APPLICATION ACTIONS ───────────────────────────────────────────
  window.setAppStatus = async function (appId, status) {
    const { error } = await supa()
      .from('applications')
      .update({ status })
      .eq('id', appId);

    if (error) { toast('Failed: ' + error.message, 'error'); return; }

    // Optimistic update in local state
    const idx = APP.applications.findIndex(a => a.id === appId);
    if (idx !== -1) APP.applications[idx].status = status;

    toast(`Status → ${fmtStatus(status)}`, 'success');
    renderApplicantsList();
    renderPipeline();
    renderStats();
    renderUpcomingInterviews();
    renderOverviewApplicants();
  };

  // ── PIPELINE JOB SELECT ───────────────────────────────────────────
  window.selectPipelineJob = function (jobId, btn) {
    APP.pipelineJobId = jobId;
    const section = document.getElementById('section-pipeline');
    if (section) section.querySelectorAll('.ftab').forEach(t => t.classList.remove('active'));
    if (btn) btn.classList.add('active');
    renderPipeline();
  };

  // ── FILTER TABS ───────────────────────────────────────────────────
  function wireJobFilterTabs() {
    const section = document.getElementById('section-jobs');
    if (!section) return;
    const statusMap = ['all', 'active', 'paused', 'draft', 'closed'];
    section.querySelectorAll('.ftab').forEach((tab, i) => {
      tab.onclick = () => {
        section.querySelectorAll('.ftab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        APP.jobsFilter = statusMap[i] || 'all';
        renderFullJobsTable();
      };
    });
  }

  function wireAppsFilterTabs() {
    const section = document.getElementById('section-applicants');
    if (!section) return;
    const statusMap = ['all', 'applied', 'reviewed', 'shortlisted', 'interview'];
    section.querySelectorAll('.ftab').forEach((tab, i) => {
      tab.onclick = () => {
        section.querySelectorAll('.ftab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        APP.appsFilter = statusMap[i] || 'all';
        renderApplicantsList();
      };
    });
  }

  function updateJobFilterCounts() {
    const section = document.getElementById('section-jobs');
    if (!section) return;
    const counts = {
      all:    APP.jobs.length,
      active: APP.jobs.filter(j => (j.status || 'active') === 'active').length,
      paused: APP.jobs.filter(j => j.status === 'paused').length,
      draft:  APP.jobs.filter(j => j.status === 'draft').length,
      closed: APP.jobs.filter(j => j.status === 'closed').length,
    };
    const keys = ['all', 'active', 'paused', 'draft', 'closed'];
    section.querySelectorAll('.ftab').forEach((tab, i) => {
      const k = keys[i];
      if (k) tab.textContent = `${k.charAt(0).toUpperCase() + k.slice(1)} (${counts[k] ?? 0})`;
    });
  }

  function updateAppsFilterCounts() {
    const section = document.getElementById('section-applicants');
    if (!section) return;
    const counts = [
      APP.applications.length,
      APP.applications.filter(a => a.status === 'applied').length,
      APP.applications.filter(a => a.status === 'reviewed').length,
      APP.applications.filter(a => a.status === 'shortlisted').length,
      APP.applications.filter(a => a.status === 'interview').length,
    ];
    const labels = ['All', 'New', 'Under Review', 'Shortlisted', 'Interview'];
    section.querySelectorAll('.ftab').forEach((tab, i) => {
      if (labels[i]) tab.textContent = `${labels[i]} (${counts[i] ?? 0})`;
    });
  }

  // ── SIGN OUT ─────────────────────────────────────────────────────
  function wireSignOut() {
    const btn = document.getElementById('signOutBtn');
    if (btn) btn.onclick = async () => {
      await supa().auth.signOut();
      window.location.href = 'login.html';
    };
  }

  // ── DATE / GREETING ───────────────────────────────────────────────
  function updateDateGreeting() {
    const dateEl = document.getElementById('topbarDate');
    if (dateEl) {
      dateEl.textContent = new Date().toLocaleDateString('en-ZA', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      });
    }

    // Dynamic time-based greeting
    const greetWrap = document.querySelector('.topbar-left div:first-child');
    if (greetWrap) {
      const h     = new Date().getHours();
      const greet = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
      greetWrap.innerHTML = `${greet}, <span id="topbarGreeting">there</span> 👋`;
    }
  }

  // ── TOAST ─────────────────────────────────────────────────────────
  function toast(message, type = 'info') {
    document.querySelectorAll('.ha-toast').forEach(t => t.remove());
    const colors = { success: '#6dc872', error: '#e05555', info: '#5b8dee', warning: '#f5a623' };
    const el = document.createElement('div');
    el.className = 'ha-toast';
    el.textContent = message;
    el.style.cssText = `
      position:fixed;bottom:28px;right:28px;z-index:9999;
      background:var(--bg2,#141415);
      border:1px solid ${colors[type] || colors.info};
      color:var(--text,#f0ede8);padding:14px 22px;border-radius:10px;
      font-family:'DM Sans',sans-serif;font-size:14px;font-weight:500;
      box-shadow:0 8px 32px rgba(0,0,0,0.5);max-width:360px;
      animation:fadeIn 0.25s ease;`;
    document.body.appendChild(el);
    setTimeout(() => {
      el.style.transition = 'opacity 0.3s';
      el.style.opacity    = '0';
      setTimeout(() => el.remove(), 300);
    }, 3500);
  }
  // Expose so inline onclick can call it
  window.showToast = toast;

  // ── UTILITIES ─────────────────────────────────────────────────────
  function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }
  function getVal(id) {
    const el = document.getElementById(id);
    return el ? el.value.trim() : '';
  }
  function setVal(id, val) {
    const el = document.getElementById(id);
    if (el) el.value = val ?? '';
  }
  function esc(str) {
    if (!str) return '';
    const d = document.createElement('div');
    d.textContent = String(str);
    return d.innerHTML;
  }
  function initials(name) {
    return (name || '?').split(' ').map(w => w[0] || '').join('').slice(0, 2).toUpperCase() || '?';
  }
  function statusBadgeClass(s) {
    return { active: 'js-active', paused: 'js-paused', draft: 'js-draft', closed: 'js-closed' }[s] || 'js-draft';
  }
  function statusLabel(s) {
    return { active: '● Active', paused: '⏸ Paused', draft: '○ Draft', closed: '✕ Closed' }[s] || s;
  }
  function appStatusClass(s) {
    return { applied: 'as-new', reviewed: 'as-review', shortlisted: 'as-short',
             interview: 'as-short', offered: 'as-short', rejected: 'as-reject' }[s] || 'as-new';
  }
  function fmtStatus(s) {
    return { applied: 'New', reviewed: 'Under Review', shortlisted: 'Shortlisted',
             interview: 'Interview', offered: 'Offered', rejected: 'Rejected' }[s]
      || (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');
  }
  function salaryLabel(job) {
    if (!job.salary_min && !job.salary_max) return '';
    const lo = job.salary_min ? 'R' + Math.round(job.salary_min / 1000) + 'k' : '';
    const hi = job.salary_max ? 'R' + Math.round(job.salary_max / 1000) + 'k' : '';
    return ` · ${lo}${lo && hi ? '–' : ''}${hi}/mo`;
  }
  function timeAgo(dateStr) {
    const ms   = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(ms / 60000);
    if (mins < 60)  return mins + 'm ago';
    const hrs = Math.floor(mins / 60);
    if (hrs  < 24)  return hrs  + 'h ago';
    const days = Math.floor(hrs / 24);
    if (days < 7)   return days + 'd ago';
    return Math.floor(days / 7) + 'w ago';
  }

})();
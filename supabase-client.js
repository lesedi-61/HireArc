// ================================================================
//  HireArc — supabase-client.js  (FIXED — auth helpers only)
//
//  Load order in your HTML (no defer/async on either):
//    <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
//    <script src="supabase-client.js"></script>
//    <script src="profile-fix.js"></script>   ← candidate dashboard only
// ================================================================

const SUPABASE_URL      = 'https://xjmgtsfonmukbltfplud.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhqbWd0c2Zvbm11a2JsdGZwbHVkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc2NDMwMDEsImV4cCI6MjA5MzIxOTAwMX0.aYwwWYMLixRlQAVI-w0kG0CSg47tAUc9NPCbKoIIdmw';

if (!window.supabase) {
  console.error('[HireArc] Supabase CDN not loaded. Make sure the CDN <script> tag appears BEFORE supabase-client.js and neither uses defer/async.');
}

const { createClient } = window.supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Expose globally
window.supabaseClient = db;

// ── AUTH HELPERS ─────────────────────────────────────────────────

async function signIn(email, password) {
  return db.auth.signInWithPassword({ email, password });
}

async function signUp(email, password, extraMeta = {}) {
  const { data, error } = await db.auth.signUp({
    email,
    password,
    options: { data: extraMeta },
  });
  if (error) throw error;

  if (data?.user) {
    await db.from('profiles').upsert({
      id:          data.user.id,
      email,
      full_name:   extraMeta.full_name || '',
      role:        extraMeta.role      || 'candidate',
      skills:      [],
      saved_jobs:  [],
      experiences: [],
    }, { onConflict: 'id' });
  }
  return data;
}

async function signOut() {
  return db.auth.signOut();
}

async function signInWithGoogle() {
  const { error } = await db.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${window.location.origin}/candidate-dashboard.html`,
    },
  });
  if (error) throw error;
}

async function resetPassword(email) {
  return db.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/login.html`,
  });
}

async function getCurrentUser() {
  const { data: { user } } = await db.auth.getUser();
  return user || null;
}

async function getProfile(userId) {
  return db.from('profiles').select('*').eq('id', userId).single();
}

// Expose on window
window.signIn            = signIn;
window.signUp            = signUp;
window.signOut           = signOut;
window.signInWithGoogle  = signInWithGoogle;
window.resetPassword     = resetPassword;
window.getCurrentUser    = getCurrentUser;
window.getProfile        = getProfile;


// ================================================================
//  RECRUITER DASHBOARD BOOT
//  Only runs when the page has a recruiter role indicator.
// ================================================================
document.addEventListener('DOMContentLoaded', () => {
  const roleEl      = document.querySelector('.sidebar-user .user-role');
  const isRecruiter = roleEl?.textContent?.trim() === 'Recruiter';
  const hasOverview = !!document.getElementById('section-overview');

  if (hasOverview && isRecruiter) {
    bootRecruiterDashboard();
  }
});

async function bootRecruiterDashboard() {
  const user = await getCurrentUser();
  if (!user) { window.location.href = 'login.html'; return; }

  const { data: profile } = await getProfile(user.id);
  if (!profile || profile.role !== 'recruiter') {
    window.location.href = 'candidate-dashboard.html';
    return;
  }

  const name     = profile.full_name || user.email;
  const initials = name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

  const nameEl   = document.querySelector('.sidebar-user .user-name');
  const avatarEl = document.querySelector('.sidebar-user .user-avatar');
  if (nameEl)   nameEl.textContent   = name;
  if (avatarEl) avatarEl.textContent = initials;

  const compEl = document.querySelector('.company-name');
  if (compEl && profile.company_name) compEl.textContent = profile.company_name;

  const topLeft = document.querySelector('.topbar-left div:first-child');
  if (topLeft) {
    const hour  = new Date().getHours();
    const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
    topLeft.innerHTML = `${greet}, <span>${name.split(' ')[0]}</span> 👋`;
  }

  const dateEl = document.querySelector('.topbar-date');
  if (dateEl) {
    dateEl.textContent = new Date().toLocaleDateString('en-ZA', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    }).toUpperCase();
  }

  const menuBtn = document.querySelector('.user-menu-btn');
  if (menuBtn) {
    menuBtn.addEventListener('click', async () => {
      if (confirm('Sign out?')) {
        await signOut();
        window.location.href = 'login.html';
      }
    });
  }

  wirePostJobModal(user.id);
}

function wirePostJobModal(recruiterId) {
  const postBtn = document.querySelector('.btn-modal-post');
  if (!postBtn) return;

  postBtn.addEventListener('click', async () => {
    const modal  = document.getElementById('modalOverlay');
    const inputs = modal.querySelectorAll('input, select, textarea');

    const title    = inputs[0]?.value?.trim();
    const dept     = inputs[1]?.value;
    const location = inputs[2]?.value?.trim();
    const jobType  = inputs[3]?.value;
    const salMin   = inputs[4]?.value?.trim();
    const salMax   = inputs[5]?.value?.trim();
    const desc     = inputs[6]?.value?.trim();

    if (!title) { alert('Please enter a job title.'); return; }

    postBtn.textContent = 'Publishing…';
    postBtn.disabled    = true;

    const { error } = await db.from('job_postings').insert({
      recruiter_id:    recruiterId,
      title,
      category:        dept     || null,
      location:        location || null,
      employment_type: jobType  || null,
      salary_min:      salMin   ? parseInt(salMin) : null,
      salary_max:      salMax   ? parseInt(salMax) : null,
      description:     desc     || null,
      is_active:       true,
      created_at:      new Date().toISOString(),
    });

    postBtn.disabled    = false;
    postBtn.textContent = 'Publish Job →';

    if (error) { alert('Failed to post job: ' + error.message); return; }

    document.getElementById('modalOverlay').classList.remove('open');
    inputs.forEach(i => { i.value = ''; });
    showRecruiterToast('Job posted successfully! ✓');
  });
}

function showRecruiterToast(msg) {
  const t = document.createElement('div');
  t.textContent = msg;
  Object.assign(t.style, {
    position: 'fixed', bottom: '32px', right: '32px',
    background: '#1c1c1e', border: '1px solid rgba(109,200,114,0.3)',
    color: '#6dc872', padding: '14px 20px', borderRadius: '10px',
    fontSize: '13px', zIndex: '9999', transition: 'opacity 0.3s',
  });
  document.body.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 400); }, 3000);
}
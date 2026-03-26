'use strict';

/* ===== Team configuration ===== */
const TEAMS = [
  { number: 1, coach: 'Leo', members: [
    'Marouane Massoudi', 'Taoufik Amghar', 'Souhail Abbou', 'Kaan Akgürbüz', 'Mats Krook',
  ]},
  { number: 2, coach: 'Alex', members: [
    'Imran El Mahdadi', 'Christian Hulleman', 'Mohammed Chebab', 'Adnane Fakirou', 'Marwan Boukattan',
  ]},
  { number: 3, coach: 'Alex', members: [
    'Fadi El Kasah', 'Imran El Madkouri', 'Jos van der Kroon', 'Ilias Mahdad', 'Anass Arazouk',
  ]},
  { number: 4, coach: 'Jeroen', members: [
    'Vita Meynen', 'Jason Tomeij', 'Abdualah Salha', 'Huy Vuong', 'Joanna Peters', 'Ahmetcan Akın',
  ]},
];

/* Map each student name to their local photo path in public/photos/
   Only students with an actual photo file on disk are listed here. */
const STUDENT_PHOTOS = {
  'Taoufik Amghar':     '/photos/taoufik-amghar.jpg',
  'Kaan Akgürbüz':      '/photos/kaan-akgurbuz.jpg',
  'Mats Krook':         '/photos/mats-krook.jpg',
  'Imran El Mahdadi':   '/photos/imran-el-mahdadi.jpg',
  'Christian Hulleman': '/photos/christian-hulleman.jpg',
  'Mohammed Chebab':    '/photos/mohammed-chebab.jpg',
  'Adnane Fakirou':     '/photos/adnane-fakirou.jpg',
  'Marwan Boukattan':   '/photos/marwan-boukattan.jpg',
  'Fadi El Kasah':      '/photos/fadi-el-kasah.jpg',
  'Imran El Madkouri':  '/photos/imran-el-madkouri.jpg',
  'Jos van der Kroon':  '/photos/jos-van-der-kroon.jpg',
  'Ilias Mahdad':       '/photos/ilias-mahdad.jpg',
  'Vita Meynen':        '/photos/vita-meynen.jpg',
  'Abdualah Salha':     '/photos/abdualah-salha.jpg',
  'Huy Vuong':          '/photos/huy-vuong.jpg',
  'Joanna Peters':      '/photos/joanna-peters.jpg',
  'Ahmetcan Akın':      '/photos/ahmetcan-akin.jpg',
};

/* Build a case-insensitive lookup for STUDENT_PHOTOS */
const STUDENT_PHOTOS_LC = Object.fromEntries(
  Object.entries(STUDENT_PHOTOS).map(([k, v]) => [k.toLowerCase(), v])
);

/* Strip student number suffix (e.g. " (1886007)") from Canvas display names */
function normalizeName(name) {
  return name.replace(/\s*\(\d+\)\s*$/, '').trim();
}

/* Return the photo path for a student, handling Canvas names with student IDs
   and case differences */
function getStudentPhoto(name) {
  const norm = normalizeName(name);
  return STUDENT_PHOTOS[name]
    || STUDENT_PHOTOS[norm]
    || STUDENT_PHOTOS_LC[name.toLowerCase()]
    || STUDENT_PHOTOS_LC[norm.toLowerCase()]
    || null;
}

/* Return a proxied avatar URL for Canvas images, or null if unavailable/default */
function getProxiedAvatarUrl(avatarUrl) {
  if (!avatarUrl || avatarUrl.includes('unknown')) return null;
  return `/api/avatar?url=${encodeURIComponent(avatarUrl)}`;
}

/* Return the team number (1-4) for a given student name, or null */
function getTeamNumber(name) {
  const base = normalizeName(name).toLowerCase();
  for (const team of TEAMS) {
    if (team.members.some((m) => m.toLowerCase() === base)) {
      return team.number;
    }
  }
  return null;
}

/* ===== State ===== */
let allStudents = [];
let hasAttendance = false;
let sortDir = 'asc';
let lastUpdatedTime = null;

/* Client-side cache for /api/students/:id responses — avoids repeat network
   calls when re-opening the same student modal. Cleared on manual refresh. */
const studentDetailCache = new Map();

/* ===== Helpers ===== */
function initials(name) {
  return normalizeName(name)
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('nl-NL', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatDateShort(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('nl-NL', { day: '2-digit', month: 'short' });
}

function formatRelativeTime(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now - d;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'Vandaag';
  if (diffDays === 1) return 'Gisteren';
  if (diffDays < 7) return `${diffDays} dagen geleden`;
  const weeks = Math.floor(diffDays / 7);
  if (weeks === 1) return '1 week geleden';
  return `${weeks} weken geleden`;
}

function trendArrow(trend) {
  switch (trend) {
    case 'up': return '<span class="trend-arrow trend-up" title="Stijgend: meer inleveringen recent">↑</span>';
    case 'down': return '<span class="trend-arrow trend-down" title="Dalend: minder inleveringen recent">↓</span>';
    default: return '<span class="trend-arrow trend-steady" title="Stabiel">→</span>';
  }
}

function statusConfig(status) {
  switch (status) {
    case 'voorloopt':
      return { label: '🚀 Loopt voor', cls: 'badge-blue' };
    case 'op_schema':
      return { label: '✅ Op schema', cls: 'badge-green' };
    case 'let_op':
      return { label: '⚠️ Let op', cls: 'badge-orange' };
    case 'achterloopt':
      return { label: '🔴 Achterloopt', cls: 'badge-red' };
    default:
      return { label: status, cls: 'badge-green' };
  }
}

function statusOrder(status) {
  const order = { voorloopt: 0, op_schema: 1, let_op: 2, achterloopt: 3 };
  return order[status] ?? 99;
}

function pm1StatusOrder(status) {
  return { green: 0, yellow: 1, red: 2 }[status] ?? 99;
}

function gradeClass(grade) {
  if (grade === null || grade === undefined) return 'grade-none';
  if (grade >= 75) return 'grade-good';
  if (grade >= 55) return 'grade-ok';
  return 'grade-bad';
}

function progressColor(pct) {
  if (pct >= 90) return '#16a34a';
  if (pct >= 70) return '#d97706';
  return '#dc2626';
}

/* ===== Data loading ===== */
async function loadData() {
  showState('loading');
  document.getElementById('refreshBtn').disabled = true;

  try {
    // Clear server-side cache so we get fresh Canvas data
    await fetch('/api/cache/clear', { method: 'POST' }).catch(() => {});
    studentDetailCache.clear();

    // Load course name and overview in parallel
    const [courseRes, overviewRes] = await Promise.all([
      fetch('/api/course'),
      fetch('/api/overview'),
    ]);

    if (!courseRes.ok || !overviewRes.ok) {
      const err = await (overviewRes.ok ? courseRes : overviewRes).json().catch(() => ({}));
      throw new Error(err.error || 'Onbekende fout bij ophalen data');
    }

    const courseData = await courseRes.json();
    const overviewData = await overviewRes.json();

    document.getElementById('courseName').textContent = courseData.name || 'Canvas Cursus';

    allStudents = overviewData.students;
    hasAttendance = overviewData.hasAttendance === true;

    // Show/hide attendance column header based on whether course has attendance data
    const thAttendance = document.getElementById('thAttendance');
    if (thAttendance) {
      thAttendance.classList.toggle('hidden-col', !hasAttendance);
    }

    // Update "last updated" timestamp
    lastUpdatedTime = new Date();
    updateLastUpdated();

    // Enable CSV export
    document.getElementById('exportBtn').disabled = false;

    updateSortIndicators();
    renderTable();
    showState('dashboard');
  } catch (err) {
    document.getElementById('errorMessage').textContent = err.message;
    showState('error');
  } finally {
    document.getElementById('refreshBtn').disabled = false;
  }
}

/* ===== Last updated timestamp ===== */
function updateLastUpdated() {
  const el = document.getElementById('lastUpdated');
  if (!el || !lastUpdatedTime) return;
  const time = lastUpdatedTime.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
  el.textContent = `Bijgewerkt om ${time}`;
}

/* ===== Sort by column header click ===== */
function sortByColumn(col) {
  const sortBy = document.getElementById('sortBy');
  if (sortBy.value === col) {
    // Same column → toggle direction
    sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    document.getElementById('sortDirBtn').textContent = sortDir === 'asc' ? '↑' : '↓';
  } else {
    sortBy.value = col;
    sortDir = 'asc';
    document.getElementById('sortDirBtn').textContent = '↑';
  }
  updateSortIndicators();
  renderTable();
}

function updateSortIndicators() {
  const currentCol = document.getElementById('sortBy').value;
  const arrow = sortDir === 'asc' ? '↑' : '↓';

  // Clear all indicators
  document.querySelectorAll('.sort-icon').forEach((el) => { el.textContent = ''; });

  // Set indicator on active column; for "Ingeleverd" column we track by submissionRate
  // but its th sort-icon id matches the first th with that value
  const colToIconMap = {
    name: ['sort-name'],
    pm1Status: ['sort-pm1Status'],
    submissionRate: ['sort-submissionRate', 'sort-inleverpercentage'],
    late: ['sort-late'],
    attendancePct: ['sort-attendancePct'],
  };
  const iconIds = colToIconMap[currentCol] || [];
  iconIds.forEach((iconId) => {
    const el = document.getElementById(iconId);
    if (el) el.textContent = arrow;
  });
}

/* Show team header groups when: no team/status filter active and no search query */
function shouldShowTeamGroups(filterTeam, filterStatus, searchQuery) {
  return filterTeam === 'all' && filterStatus === 'all' && !searchQuery;
}

/* ===== Table render ===== */

/* Shared filter + sort logic used by both renderTable() and exportCsv() */
function getFilteredStudents() {
  const filterStatus = document.getElementById('filterStatus').value;
  const filterTeam = document.getElementById('filterTeam').value;
  const searchQuery = document.getElementById('searchInput').value.toLowerCase().trim();
  const sortBy = document.getElementById('sortBy').value;

  let filtered = allStudents.filter((s) => {
    if (filterStatus !== 'all' && s.status !== filterStatus) return false;
    if (filterTeam !== 'all') {
      if (String(getTeamNumber(s.name)) !== filterTeam) return false;
    }
    if (searchQuery && !s.name.toLowerCase().includes(searchQuery)) return false;
    return true;
  });

  filtered.sort((a, b) => {
    let cmp = 0;
    switch (sortBy) {
      case 'name':
        cmp = a.sortableName.localeCompare(b.sortableName);
        break;
      case 'pm1Status':
        cmp = pm1StatusOrder(a.peilmoment1Status) - pm1StatusOrder(b.peilmoment1Status);
        break;
      case 'grade':
        cmp = (a.grade ?? -1) - (b.grade ?? -1);
        break;
      case 'submissionRate':
        cmp = a.submissionRate - b.submissionRate;
        break;
      case 'attendancePct':
        cmp = (a.attendancePct ?? -1) - (b.attendancePct ?? -1);
        break;
      case 'missing':
        cmp = b.missing - a.missing;
        break;
      case 'late':
        cmp = b.late - a.late;
        break;
      case 'status':
        cmp = statusOrder(a.status) - statusOrder(b.status);
        break;
    }
    return sortDir === 'asc' ? cmp : -cmp;
  });

  return { filtered, filterStatus, filterTeam, searchQuery };
}

function renderTable() {
  const { filtered, filterStatus, filterTeam, searchQuery } = getFilteredStudents();

  const tbody = document.getElementById('studentTableBody');
  const noResults = document.getElementById('noResults');

  if (filtered.length === 0) {
    tbody.innerHTML = '';
    noResults.classList.remove('hidden');
    return;
  }
  noResults.classList.add('hidden');

  // When grouping by team (no specific team selected and no search), group by team
  if (shouldShowTeamGroups(filterTeam, filterStatus, searchQuery)) {
    let html = '';
    for (const team of TEAMS) {
      const teamStudents = filtered.filter((s) => getTeamNumber(s.name) === team.number);
      if (teamStudents.length === 0) continue;
      html += buildTeamHeaderRow(team, teamStudents);
      html += teamStudents.map((s) => buildStudentRow(s)).join('');
    }
    // Students not assigned to any team
    const unassigned = filtered.filter((s) => getTeamNumber(s.name) === null);
    if (unassigned.length > 0) {
      html += `<tr class="team-header-row"><td colspan="6" class="team-header-cell">Niet ingedeeld</td></tr>`;
      html += unassigned.map((s) => buildStudentRow(s)).join('');
    }
    tbody.innerHTML = html;
  } else {
    tbody.innerHTML = filtered.map((s) => buildStudentRow(s)).join('');
  }
}

function buildTeamHeaderRow(team, students) {
  const onTrack = students.filter((s) => ['op_schema', 'voorloopt'].includes(s.status)).length;
  const total = students.length;
  return `
    <tr class="team-header-row">
      <td colspan="6" class="team-header-cell">
        <span class="team-label">Team ${team.number}</span>
        <span class="team-coach">Coach: ${escHtml(team.coach)}</span>
        <span class="team-progress">${onTrack}/${total} op schema</span>
      </td>
    </tr>
  `;
}

function buildStudentRow(s) {
  const inits = escHtml(initials(s.name));
  // Priority: local repo photo → Canvas avatarUrl → initials text
  const localPhoto = getStudentPhoto(s.name);
  const remotePhoto = getProxiedAvatarUrl(s.avatarUrl);
  const photoSrc = localPhoto || remotePhoto;
  const fallbackAttr = localPhoto && remotePhoto
    ? ` data-fallback-src="${escHtml(remotePhoto)}"`
    : '';
  const avatarInner = photoSrc
    ? `<img src="${escHtml(photoSrc)}" alt="${inits}" loading="lazy"${fallbackAttr} onerror="avatarFallback(this)">`
    : inits;

  const pct = s.submissionRate;
  const color = progressColor(pct);

  // Inactive warning: show ⚠️ if last activity > 5 days ago
  let inactiveWarning = '';
  if (s.lastActivityAt) {
    const diffDays = Math.floor((Date.now() - new Date(s.lastActivityAt).getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays >= 5) {
      inactiveWarning = `<span class="inactive-warning" title="Inactief: ${formatRelativeTime(s.lastActivityAt)}">⚠️</span>`;
    }
  }

  // PM1 button: color variant + progress bar
  const pm1Status = s.peilmoment1Status || 'red';
  const pm1Green = s.peilmoment1GreenCount ?? 0;
  const pm1Total = s.peilmoment1Total ?? 0;
  const pm1Pct = pm1Total > 0 ? Math.round((pm1Green / pm1Total) * 100) : 0;
  const pm1BtnCls = `pm1-btn pm1-btn-${pm1Status}`;

  // Attendance cell
  let attendanceCell;
  if (!hasAttendance) {
    attendanceCell = `<td class="center hidden-col"><span class="grade-none">—</span></td>`;
  } else if (s.attendancePct !== null && s.attendancePct !== undefined) {
    const aCls = gradeClass(s.attendancePct);
    attendanceCell = `<td class="center"><span class="grade-pill ${aCls}">${s.attendancePct.toFixed(1)}%</span></td>`;
  } else {
    attendanceCell = `<td class="center"><span class="grade-none">—</span></td>`;
  }

  return `
    <tr>
      <td>
        <div class="student-name-cell">
          <div class="student-avatar" data-init="${inits}">${avatarInner}</div>
          <span class="student-full-name">${escHtml(s.name)}${inactiveWarning}</span>
        </div>
      </td>
      <td class="center">
        <div class="action-btns">
          <button class="detail-btn" data-student-id="${s.id}" onclick="openStudentModal(+this.dataset.studentId)">
            Details
          </button>
          <div class="pm1-wrap">
            <button class="${pm1BtnCls}" data-student-id="${s.id}" onclick="openPeilmomentModal(+this.dataset.studentId)" title="${pm1Green}/${pm1Total} items klaar">
              Peilmoment 1
            </button>
            <div class="pm1-bar-bg">
              <div class="pm1-bar-fill pm1-fill-${pm1Status}" style="width:${pm1Pct}%"></div>
            </div>
          </div>
        </div>
      </td>
      <td class="center">${s.submitted} / ${s.totalDue}</td>
      <td class="center">
        ${s.late > 0
          ? `<span style="color: var(--orange); font-weight: 500;">${s.late}</span>`
          : `<span style="color: var(--gray-500);">0</span>`
        }
      </td>
      <td class="center">
        <div class="progress-wrapper">
          <div class="progress-bar-bg">
            <div class="progress-bar-fill" style="width: ${pct}%; background: ${color};"></div>
          </div>
          <span class="progress-label">${pct}%</span>
          ${trendArrow(s.trend)}
        </div>
      </td>
      ${attendanceCell}
    </tr>
  `;
}

function escHtml(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* Safe fallback for avatar: tries Canvas avatar URL, then falls back to initials */
function avatarFallback(el) {
  const fallback = el.dataset.fallbackSrc;
  if (fallback) {
    // Try Canvas avatar before giving up
    el.removeAttribute('data-fallback-src');
    el.src = fallback;
    return;
  }
  const init = el.parentNode.dataset.init || '';
  el.parentNode.textContent = init;
}

/* Set up a modal avatar <img> element with photo fallback chain */
function setupAvatarEl(imgEl, student) {
  const localPhoto = getStudentPhoto(student.name);
  const remotePhoto = getProxiedAvatarUrl(student.avatarUrl);
  const photoSrc = localPhoto || remotePhoto;
  if (photoSrc) {
    imgEl.src = photoSrc;
    imgEl.style.display = '';
    if (localPhoto && remotePhoto) {
      imgEl.dataset.fallbackSrc = remotePhoto;
      imgEl.onerror = function () { avatarFallback(this); };
    }
  } else {
    imgEl.src = '';
    imgEl.style.display = 'none';
  }
}

/* ===== Sort direction toggle ===== */
function toggleSortDir() {
  sortDir = sortDir === 'asc' ? 'desc' : 'asc';
  document.getElementById('sortDirBtn').textContent = sortDir === 'asc' ? '↑' : '↓';
  updateSortIndicators();
  renderTable();
}

/* ===== State management ===== */
function showState(state) {
  document.getElementById('loading').classList.toggle('hidden', state !== 'loading');
  document.getElementById('errorState').classList.toggle('hidden', state !== 'error');
  document.getElementById('dashboard').classList.toggle('hidden', state !== 'dashboard');
}

/* ===== Student detail modal ===== */
async function openStudentModal(studentId) {
  const modal = document.getElementById('studentModal');
  const modalLoading = document.getElementById('modalLoading');
  const modalContent = document.getElementById('modalContent');
  const modalStats = document.getElementById('modalStats');

  // Show modal with loading state
  modal.classList.remove('hidden');
  modalLoading.classList.remove('hidden');
  modalContent.classList.add('hidden');
  trapFocus(modal);

  // Set basic info from already-loaded data
  const student = allStudents.find((s) => s.id === studentId);
  document.getElementById('modalStudentName').textContent = student ? student.name : '';

  if (student) {
    const { label, cls } = statusConfig(student.status);
    document.getElementById('modalStudentStatus').innerHTML = `<span class="badge ${cls}">${label}</span>`;
    setupAvatarEl(document.getElementById('modalAvatar'), student);
    // Show stats immediately from overview data (Option 5: optimistic rendering)
    modalStats.innerHTML = buildModalStatsPreview(student);
  } else {
    modalStats.innerHTML = '';
  }

  try {
    // Check client-side cache first (Option 4)
    let data = studentDetailCache.get(studentId);
    if (!data) {
      const res = await fetch(`/api/students/${studentId}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Fout bij ophalen studentdetails');
      }
      data = await res.json();
      studentDetailCache.set(studentId, data);
    }

    // Render modal stats (full version from API data)
    const st = student || {};
    modalStats.innerHTML = buildModalStats(st, data.assignments, data.attendancePct);

    // Render assignment list grouped by assignment group
    document.getElementById('assignmentList').innerHTML =
      buildGroupedAssignmentList(data.assignments, data.assignmentGroups || []);

    modalLoading.classList.add('hidden');
    modalContent.classList.remove('hidden');
  } catch (err) {
    modalLoading.innerHTML = `<p style="color: var(--red);">Fout: ${escHtml(err.message)}</p>`;
  }
}

/* Build modal stats preview using data already available from the overview
   endpoint — shown immediately so the user sees meaningful info while the
   assignment list loads in the background. */
function buildModalStatsPreview(student) {
  const attendanceStat = (hasAttendance)
    ? `<div class="modal-stat">
        <span class="modal-stat-value ${gradeClass(student.attendancePct)}">${student.attendancePct !== null && student.attendancePct !== undefined ? student.attendancePct.toFixed(1) + '%' : '—'}</span>
        <span class="modal-stat-label">Aanwezigheid</span>
      </div>`
    : '';

  const lastActivityText = formatRelativeTime(student.lastActivityAt);
  const lastActivityDays = student.lastActivityAt
    ? Math.floor((Date.now() - new Date(student.lastActivityAt).getTime()) / (1000 * 60 * 60 * 24))
    : null;
  const lastActivityCls = lastActivityDays !== null && lastActivityDays >= 5 ? 'style="color: var(--red);"' : '';
  const lastActivityStat = `<div class="modal-stat">
      <span class="modal-stat-value" ${lastActivityCls}>${lastActivityText || '—'}</span>
      <span class="modal-stat-label">Laatst actief</span>
    </div>`;

  const lastSubmittedText = student.lastSubmittedAt ? formatDateShort(student.lastSubmittedAt) : '—';
  const lastSubmittedStat = `<div class="modal-stat">
      <span class="modal-stat-value">${lastSubmittedText}</span>
      <span class="modal-stat-label">Laatste inlevering</span>
    </div>`;

  const trendLabel = student.trend === 'up' ? '↑ Stijgend' : student.trend === 'down' ? '↓ Dalend' : '→ Stabiel';
  const trendColor = student.trend === 'up' ? 'color: var(--green);' : student.trend === 'down' ? 'color: var(--red);' : 'color: var(--gray-500);';
  const trendStat = `<div class="modal-stat">
      <span class="modal-stat-value" style="${trendColor}">${trendLabel}</span>
      <span class="modal-stat-label">Momentum</span>
    </div>`;

  let analyticsStat = '';
  if (student.pageViews !== null && student.pageViews !== undefined) {
    analyticsStat = `<div class="modal-stat">
        <span class="modal-stat-value">${student.pageViews}</span>
        <span class="modal-stat-label">Paginaweergaven</span>
      </div>
      <div class="modal-stat">
        <span class="modal-stat-value">${student.participations ?? '—'}</span>
        <span class="modal-stat-label">Participatie</span>
      </div>`;
  }

  return `
    <div class="modal-stat">
      <span class="modal-stat-value">${student.submitted}/${student.totalDue}</span>
      <span class="modal-stat-label">Voltooid</span>
    </div>
    <div class="modal-stat">
      <span class="modal-stat-value" style="color: var(--orange);">${student.late}</span>
      <span class="modal-stat-label">Te laat</span>
    </div>
    <div class="modal-stat">
      <span class="modal-stat-value" style="color: var(--blue);">${student.upcomingCount}</span>
      <span class="modal-stat-label">Aankomend</span>
    </div>
    ${attendanceStat}
    ${lastSubmittedStat}
    ${trendStat}
    ${analyticsStat}
  `;
}

function buildModalStats(student, assignments, attendancePct) {
  const due = assignments.filter((a) => a.isDue);
  const submitted = due.filter((a) =>
    ['graded', 'graded_late', 'submitted', 'submitted_late', 'submitted_early', 'excused'].includes(a.submissionStatus)
  ).length;
  const missing = due.filter((a) => a.submissionStatus === 'missing').length;
  const late = due.filter((a) => ['graded_late', 'submitted_late'].includes(a.submissionStatus)).length;
  const upcoming = assignments.filter((a) => !a.isDue).length;
  const grade = student.grade;

  const attendanceStat = (hasAttendance)
    ? `<div class="modal-stat">
        <span class="modal-stat-value ${gradeClass(attendancePct)}">${attendancePct !== null && attendancePct !== undefined ? attendancePct.toFixed(1) + '%' : '—'}</span>
        <span class="modal-stat-label">Aanwezigheid</span>
      </div>`
    : '';

  // Last activity
  const lastActivityText = formatRelativeTime(student.lastActivityAt);
  const lastActivityDays = student.lastActivityAt
    ? Math.floor((Date.now() - new Date(student.lastActivityAt).getTime()) / (1000 * 60 * 60 * 24))
    : null;
  const lastActivityCls = lastActivityDays !== null && lastActivityDays >= 5 ? 'style="color: var(--red);"' : '';
  const lastActivityStat = `<div class="modal-stat">
      <span class="modal-stat-value" ${lastActivityCls}>${lastActivityText || '—'}</span>
      <span class="modal-stat-label">Laatst actief</span>
    </div>`;

  // Last submission
  const lastSubmittedText = student.lastSubmittedAt ? formatDateShort(student.lastSubmittedAt) : '—';
  const lastSubmittedStat = `<div class="modal-stat">
      <span class="modal-stat-value">${lastSubmittedText}</span>
      <span class="modal-stat-label">Laatste inlevering</span>
    </div>`;

  // Trend
  const trendLabel = student.trend === 'up' ? '↑ Stijgend' : student.trend === 'down' ? '↓ Dalend' : '→ Stabiel';
  const trendColor = student.trend === 'up' ? 'color: var(--green);' : student.trend === 'down' ? 'color: var(--red);' : 'color: var(--gray-500);';
  const trendStat = `<div class="modal-stat">
      <span class="modal-stat-value" style="${trendColor}">${trendLabel}</span>
      <span class="modal-stat-label">Momentum</span>
    </div>`;

  // Analytics
  let analyticsStat = '';
  if (student.pageViews !== null && student.pageViews !== undefined) {
    analyticsStat = `<div class="modal-stat">
        <span class="modal-stat-value">${student.pageViews}</span>
        <span class="modal-stat-label">Paginaweergaven</span>
      </div>
      <div class="modal-stat">
        <span class="modal-stat-value">${student.participations ?? '—'}</span>
        <span class="modal-stat-label">Participatie</span>
      </div>`;
  }

  return `
    <div class="modal-stat">
      <span class="modal-stat-value">${submitted}/${due.length}</span>
      <span class="modal-stat-label">Voltooid</span>
    </div>
    <div class="modal-stat">
      <span class="modal-stat-value" style="color: var(--orange);">${late}</span>
      <span class="modal-stat-label">Te laat</span>
    </div>
    <div class="modal-stat">
      <span class="modal-stat-value" style="color: var(--blue);">${upcoming}</span>
      <span class="modal-stat-label">Aankomend</span>
    </div>
    ${attendanceStat}
    ${lastSubmittedStat}
    ${trendStat}
    ${analyticsStat}
  `;
}

/* Resolve the status display for an assignment, with pass/fail grade override.
 * For 'complete'/'incomplete' grades the workflow-state label is replaced by a
 * clear Dutch "Voltooid" / "Niet voltooid" label so teachers don't see the
 * meaningless "Beoordeeld" text alongside a hidden 0 pt score. */
function resolveAssignmentStatus(grade, submissionStatus) {
  if (grade === 'complete') {
    return { label: 'Voltooid', dotCls: 'dot-green', badgeCls: 'badge-green' };
  }
  if (grade === 'incomplete') {
    return { label: 'Niet voltooid', dotCls: 'dot-red', badgeCls: 'badge-red' };
  }
  return assignmentStatusInfo(submissionStatus);
}

function buildAssignmentItem(a) {
  const statusInfo = resolveAssignmentStatus(a.grade, a.submissionStatus);

  const dueText = a.isDue
    ? `Inleverdatum: ${formatDateShort(a.dueAt)}`
    : `Deadline: ${formatDateShort(a.dueAt)}`;

  // Don't show raw numeric score for pass/fail assignments; the badge already conveys the result
  const isPassFail = a.grade === 'complete' || a.grade === 'incomplete';
  const scoreText = !isPassFail && a.score !== null && a.score !== undefined && a.pointsPossible
    ? `${a.score} / ${a.pointsPossible} pt`
    : !isPassFail && a.score !== null && a.score !== undefined
    ? `${a.score} pt`
    : '';

  // Prefer SpeedGrader link (direct to student's submission) over generic assignment page
  const linkUrl = a.speedGraderUrl || a.htmlUrl;
  const nameHtml = linkUrl
    ? `<a href="${escHtml(linkUrl)}" target="_blank" rel="noopener noreferrer">${escHtml(a.name)}</a>`
    : escHtml(a.name);

  return `
    <div class="assignment-item">
      <div class="assignment-status-dot ${statusInfo.dotCls}" title="${statusInfo.label}"></div>
      <div class="assignment-info">
        <div class="assignment-name">${nameHtml}</div>
        <div class="assignment-due">${dueText}</div>
      </div>
      ${scoreText ? `<div class="assignment-score">${scoreText}</div>` : ''}
      <span class="assignment-badge badge ${statusInfo.badgeCls}">${statusInfo.label}</span>
    </div>
  `;
}

function buildGroupedAssignmentList(assignments, assignmentGroups) {
  // If no groups available, fall back to flat list
  if (!assignmentGroups || assignmentGroups.length === 0) {
    return assignments.map((a) => buildAssignmentItem(a)).join('');
  }

  // Group assignments by assignmentGroupId
  const grouped = {};
  const groupOrder = {};
  assignmentGroups.forEach((g) => {
    grouped[g.id] = [];
    groupOrder[g.id] = g.position ?? 999;
  });

  assignments.forEach((a) => {
    const gid = a.assignmentGroupId;
    if (!grouped[gid]) grouped[gid] = [];
    grouped[gid].push(a);
  });

  // Sort groups by position
  const sortedGroupIds = Object.keys(grouped)
    .filter((gid) => grouped[gid].length > 0)
    .sort((a, b) => (groupOrder[a] ?? 999) - (groupOrder[b] ?? 999));

  return sortedGroupIds.map((gid) => {
    const group = assignmentGroups.find((g) => g.id === parseInt(gid, 10));
    const groupName = group ? group.name : 'Overig';
    const items = grouped[gid];

    // Calculate group progress
    const dueItems = items.filter((a) => a.isDue);
    const completedItems = dueItems.filter((a) =>
      ['graded', 'graded_late', 'submitted', 'submitted_late', 'submitted_early', 'excused'].includes(a.submissionStatus)
    ).length;
    const groupPct = dueItems.length > 0 ? Math.round((completedItems / dueItems.length) * 100) : 100;
    const groupColor = progressColor(groupPct);

    return `
      <div class="assignment-group">
        <div class="assignment-group-header">
          <span class="assignment-group-name">${escHtml(groupName)}</span>
          <span class="assignment-group-progress">
            <span class="assignment-group-bar-bg">
              <span class="assignment-group-bar-fill" style="width:${groupPct}%; background:${groupColor};"></span>
            </span>
            ${completedItems}/${dueItems.length}
          </span>
        </div>
        ${items.map((a) => buildAssignmentItem(a)).join('')}
      </div>
    `;
  }).join('');
}

function assignmentStatusInfo(status) {
  switch (status) {
    case 'graded':
      return { label: 'Beoordeeld', dotCls: 'dot-green', badgeCls: 'badge-green' };
    case 'graded_late':
      return { label: 'Beoordeeld (te laat)', dotCls: 'dot-orange', badgeCls: 'badge-orange' };
    case 'submitted':
      return { label: 'Ingeleverd', dotCls: 'dot-blue', badgeCls: 'badge-blue' };
    case 'submitted_late':
      return { label: 'Ingeleverd (te laat)', dotCls: 'dot-orange', badgeCls: 'badge-orange' };
    case 'submitted_early':
      return { label: 'Vroeg ingeleverd', dotCls: 'dot-blue', badgeCls: 'badge-blue' };
    case 'missing':
      return { label: 'Ontbrekend', dotCls: 'dot-red', badgeCls: 'badge-red' };
    case 'excused':
      return { label: 'Vrijgesteld', dotCls: 'dot-gray', badgeCls: '' };
    case 'not_due':
      return { label: 'Nog niet verwacht', dotCls: 'dot-gray', badgeCls: '' };
    default:
      return { label: status, dotCls: 'dot-gray', badgeCls: '' };
  }
}

/* ===== Modal close ===== */
function closeModal() {
  const modal = document.getElementById('studentModal');
  modal.classList.add('hidden');
  releaseFocus(modal);
}

function closeModalOnBackdrop(event) {
  if (event.target === document.getElementById('studentModal')) {
    closeModal();
  }
}

/* ===== Peilmoment 1 modal ===== */
async function openPeilmomentModal(studentId) {
  const modal = document.getElementById('peilmomentModal');
  const pmLoading = document.getElementById('pmLoading');
  const pmContent = document.getElementById('pmContent');

  modal.classList.remove('hidden');
  pmLoading.classList.remove('hidden');
  pmContent.classList.add('hidden');
  document.getElementById('pmList').innerHTML = '';
  trapFocus(modal);

  // Set student info from already-loaded data
  const student = allStudents.find((s) => s.id === studentId);
  document.getElementById('pmStudentName').textContent = student ? student.name : '';
  if (student) {
    setupAvatarEl(document.getElementById('pmAvatar'), student);
  }

  try {
    // Check client-side cache first (Option 4)
    let data = studentDetailCache.get(studentId);
    if (!data) {
      const res = await fetch(`/api/students/${studentId}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Fout bij ophalen peilmoment gegevens');
      }
      data = await res.json();
      studentDetailCache.set(studentId, data);
    }

    document.getElementById('pmList').innerHTML = buildPeilmomentContent(data.peilmoment1, data.attendancePct);

    pmLoading.classList.add('hidden');
    pmContent.classList.remove('hidden');
  } catch (err) {
    pmLoading.innerHTML = `<p style="color: var(--red);">Fout: ${escHtml(err.message)}</p>`;
  }
}

function buildPeilmomentContent(peilmoment1, attendancePct) {
  const items = (peilmoment1 || []).map((item) => {
    if (!item.found) {
      return `
        <div class="pm-item pm-item-notfound">
          <div class="assignment-status-dot dot-gray" title="Niet gevonden"></div>
          <div class="pm-item-info">
            <div class="pm-item-name">${escHtml(item.label)}</div>
            <div class="pm-item-meta">Niet gevonden in Canvas</div>
          </div>
          <span class="assignment-badge badge">Niet beschikbaar</span>
        </div>
      `;
    }

    // Resolve status with pass/fail grade override (shared helper)
    const si = resolveAssignmentStatus(item.grade, item.submissionStatus);

    // Hide raw numeric score for pass/fail assignments
    const isPassFail = item.grade === 'complete' || item.grade === 'incomplete';
    const scoreText = !isPassFail && item.score !== null && item.score !== undefined && item.pointsPossible
      ? `${item.score} / ${item.pointsPossible} pt`
      : !isPassFail && item.score !== null && item.score !== undefined
      ? `${item.score} pt`
      : '';
    const dueText = item.dueAt ? `Deadline: ${formatDateShort(item.dueAt)}` : '';

    // Prefer SpeedGrader link (direct to student's submission)
    const linkUrl = item.speedGraderUrl || item.htmlUrl;
    const nameHtml = linkUrl
      ? `<a href="${escHtml(linkUrl)}" target="_blank" rel="noopener noreferrer">${escHtml(item.assignmentName || item.label)}</a>`
      : escHtml(item.assignmentName || item.label);

    return `
      <div class="pm-item">
        <div class="assignment-status-dot ${si.dotCls}" title="${si.label}"></div>
        <div class="pm-item-info">
          <div class="pm-item-name">${nameHtml}</div>
          <div class="pm-item-label">${escHtml(item.label)}</div>
          ${dueText ? `<div class="pm-item-meta">${dueText}</div>` : ''}
        </div>
        ${scoreText ? `<div class="assignment-score">${scoreText}</div>` : ''}
        <span class="assignment-badge badge ${si.badgeCls}">${si.label}</span>
      </div>
    `;
  });

  // Attendance row
  let attendanceHtml;
  if (attendancePct !== null && attendancePct !== undefined) {
    const aCls = gradeClass(attendancePct);
    attendanceHtml = `
      <div class="pm-item pm-item-attendance">
        <div class="assignment-status-dot ${attendancePct >= 70 ? 'dot-green' : 'dot-red'}" title="Aanwezigheid"></div>
        <div class="pm-item-info">
          <div class="pm-item-name">Aanwezigheidspercentage</div>
          <div class="pm-item-meta">Tot nu toe</div>
        </div>
        <span class="grade-pill ${aCls}" style="font-size: 1rem; padding: 0.3rem 0.8rem;">${attendancePct.toFixed(1)}%</span>
      </div>
    `;
  } else {
    attendanceHtml = `
      <div class="pm-item pm-item-attendance">
        <div class="assignment-status-dot dot-gray" title="Aanwezigheid"></div>
        <div class="pm-item-info">
          <div class="pm-item-name">Aanwezigheidspercentage</div>
          <div class="pm-item-meta">Geen aanwezigheidsregistratie gevonden in Canvas</div>
        </div>
        <span class="grade-none" style="font-style: italic;">N/B</span>
      </div>
    `;
  }

  return items.join('') + attendanceHtml;
}

function closePeilmomentModal() {
  const modal = document.getElementById('peilmomentModal');
  modal.classList.add('hidden');
  releaseFocus(modal);
}

function closePeilmomentOnBackdrop(event) {
  if (event.target === document.getElementById('peilmomentModal')) {
    closePeilmomentModal();
  }
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeModal();
    closePeilmomentModal();
  }
});

/* ===== Focus trapping for modals ===== */
let previouslyFocusedElement = null;

function trapFocus(modalEl) {
  previouslyFocusedElement = document.activeElement;
  const focusable = modalEl.querySelectorAll(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  );
  if (focusable.length === 0) return;

  const firstFocusable = focusable[0];
  const lastFocusable = focusable[focusable.length - 1];
  firstFocusable.focus();

  function handleTab(e) {
    if (e.key !== 'Tab') return;
    if (e.shiftKey) {
      if (document.activeElement === firstFocusable) {
        e.preventDefault();
        lastFocusable.focus();
      }
    } else {
      if (document.activeElement === lastFocusable) {
        e.preventDefault();
        firstFocusable.focus();
      }
    }
  }

  modalEl._trapHandler = handleTab;
  modalEl.addEventListener('keydown', handleTab);
}

function releaseFocus(modalEl) {
  if (modalEl._trapHandler) {
    modalEl.removeEventListener('keydown', modalEl._trapHandler);
    delete modalEl._trapHandler;
  }
  if (previouslyFocusedElement && previouslyFocusedElement.focus) {
    previouslyFocusedElement.focus();
    previouslyFocusedElement = null;
  }
}

/* ===== Export to CSV ===== */
function exportCsv() {
  const { filtered } = getFilteredStudents();

  // CSV header
  const headers = ['Student', 'Team', 'Voltooid', 'Te laat', 'Voortgang %', 'Momentum', 'Status', 'Laatst actief', 'Laatste inlevering'];
  if (hasAttendance) headers.push('Aanwezigheid %');

  const csvEscape = (val) => {
    const str = String(val ?? '');
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  };

  const statusLabels = {
    voorloopt: 'Loopt voor',
    op_schema: 'Op schema',
    let_op: 'Let op',
    achterloopt: 'Achterloopt',
  };

  const trendLabels = { up: 'Stijgend', down: 'Dalend', steady: 'Stabiel' };

  const rows = filtered.map((s) => {
    const team = getTeamNumber(s.name);
    const row = [
      csvEscape(s.name),
      csvEscape(team ? `Team ${team}` : ''),
      csvEscape(`${s.submitted}/${s.totalDue}`),
      csvEscape(s.late),
      csvEscape(s.submissionRate + '%'),
      csvEscape(trendLabels[s.trend] || ''),
      csvEscape(statusLabels[s.status] || s.status),
      csvEscape(formatRelativeTime(s.lastActivityAt) || ''),
      csvEscape(s.lastSubmittedAt ? formatDateShort(s.lastSubmittedAt) : ''),
    ];
    if (hasAttendance) {
      row.push(csvEscape(s.attendancePct !== null && s.attendancePct !== undefined ? s.attendancePct.toFixed(1) + '%' : ''));
    }
    return row.join(',');
  });

  // BOM for Excel UTF-8 compatibility
  const bom = '\uFEFF';
  const csv = bom + headers.join(',') + '\n' + rows.join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'studenten-overzicht.csv';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/* ===== Kick off ===== */
loadData();

'use strict';

/* ===== State ===== */
let allStudents = [];
let hasAttendance = false;
let sortDir = 'asc';

/* ===== Helpers ===== */
function initials(name) {
  return name
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

    updateStats(overviewData);
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

/* ===== Stats bar ===== */
function updateStats(data) {
  const students = data.students;
  document.getElementById('statTotal').textContent = students.length;
  document.getElementById('statOnTrack').textContent = students.filter((s) => s.status === 'op_schema').length;
  document.getElementById('statWarning').textContent = students.filter((s) => s.status === 'let_op').length;
  document.getElementById('statBehind').textContent = students.filter((s) => s.status === 'achterloopt').length;
  document.getElementById('statAhead').textContent = students.filter((s) => s.status === 'voorloopt').length;
  document.getElementById('statAssignments').textContent = data.assignmentCount;
}

/* ===== Filter by status (stat card click) ===== */
function filterByStatus(status) {
  const select = document.getElementById('filterStatus');
  select.value = status;

  // Update active card highlight
  ['statCardTotal', 'statCardOnTrack', 'statCardWarning', 'statCardBehind', 'statCardAhead'].forEach((id) => {
    document.getElementById(id)?.classList.remove('stat-card-active');
  });
  const cardMap = {
    all: 'statCardTotal',
    op_schema: 'statCardOnTrack',
    let_op: 'statCardWarning',
    achterloopt: 'statCardBehind',
    voorloopt: 'statCardAhead',
  };
  const activeId = cardMap[status];
  if (activeId) document.getElementById(activeId)?.classList.add('stat-card-active');

  renderTable();
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

/* ===== Table render ===== */
function renderTable() {
  const filterStatus = document.getElementById('filterStatus').value;
  const searchQuery = document.getElementById('searchInput').value.toLowerCase().trim();
  const sortBy = document.getElementById('sortBy').value;

  let filtered = allStudents.filter((s) => {
    if (filterStatus !== 'all' && s.status !== filterStatus) return false;
    if (searchQuery && !s.name.toLowerCase().includes(searchQuery)) return false;
    return true;
  });

  filtered.sort((a, b) => {
    let cmp = 0;
    switch (sortBy) {
      case 'name':
        cmp = a.sortableName.localeCompare(b.sortableName);
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
        // Higher missing count = more at-risk; reversed so 'asc' puts worst students first
        cmp = b.missing - a.missing;
        break;
      case 'late':
        // Higher late count = more at-risk; same reasoning as missing
        cmp = b.late - a.late;
        break;
      case 'status':
        cmp = statusOrder(a.status) - statusOrder(b.status);
        break;
    }
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const tbody = document.getElementById('studentTableBody');
  const noResults = document.getElementById('noResults');

  if (filtered.length === 0) {
    tbody.innerHTML = '';
    noResults.classList.remove('hidden');
    return;
  }
  noResults.classList.add('hidden');

  tbody.innerHTML = filtered.map((s) => buildStudentRow(s)).join('');
}

function buildStudentRow(s) {
  const avatarContent = s.avatarUrl && !s.avatarUrl.includes('unknown')
    ? `<img src="${escHtml(s.avatarUrl)}" alt="" onerror="this.parentNode.innerHTML='${escHtml(initials(s.name))}'">`
    : escHtml(initials(s.name));

  const pct = s.submissionRate;
  const color = progressColor(pct);

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
          <div class="student-avatar">${avatarContent}</div>
          <span class="student-full-name">${escHtml(s.name)}</span>
        </div>
      </td>
      <td class="center">
        <div class="action-btns">
          <button class="detail-btn" data-student-id="${s.id}" onclick="openStudentModal(+this.dataset.studentId)">
            Details
          </button>
          <button class="pm1-btn" data-student-id="${s.id}" onclick="openPeilmomentModal(+this.dataset.studentId)">
            Peilmoment 1
          </button>
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
  modalStats.innerHTML = '';

  // Set basic info from already-loaded data
  const student = allStudents.find((s) => s.id === studentId);
  document.getElementById('modalStudentName').textContent = student ? student.name : '';

  if (student) {
    const { label, cls } = statusConfig(student.status);
    document.getElementById('modalStudentStatus').innerHTML = `<span class="badge ${cls}">${label}</span>`;
    const avatarEl = document.getElementById('modalAvatar');
    if (student.avatarUrl && !student.avatarUrl.includes('unknown')) {
      avatarEl.src = student.avatarUrl;
      avatarEl.style.display = '';
    } else {
      avatarEl.src = '';
      avatarEl.style.display = 'none';
    }
  }

  try {
    const res = await fetch(`/api/students/${studentId}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Fout bij ophalen studentdetails');
    }
    const data = await res.json();

    // Render modal stats
    const st = student || {};
    modalStats.innerHTML = buildModalStats(st, data.assignments, data.attendancePct);

    // Render assignment list
    document.getElementById('assignmentList').innerHTML =
      data.assignments.map((a) => buildAssignmentItem(a)).join('');

    modalLoading.classList.add('hidden');
    modalContent.classList.remove('hidden');
  } catch (err) {
    modalLoading.innerHTML = `<p style="color: var(--red);">Fout: ${escHtml(err.message)}</p>`;
  }
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

  return `
    <div class="modal-stat">
      <span class="modal-stat-value">${submitted}/${due.length}</span>
      <span class="modal-stat-label">Ingeleverd</span>
    </div>
    <div class="modal-stat">
      <span class="modal-stat-value" style="color: var(--red);">${missing}</span>
      <span class="modal-stat-label">Ontbrekend</span>
    </div>
    <div class="modal-stat">
      <span class="modal-stat-value" style="color: var(--orange);">${late}</span>
      <span class="modal-stat-label">Te laat</span>
    </div>
    <div class="modal-stat">
      <span class="modal-stat-value" style="color: var(--blue);">${upcoming}</span>
      <span class="modal-stat-label">Aankomend</span>
    </div>
    <div class="modal-stat">
      <span class="modal-stat-value ${gradeClass(grade)}">${grade !== null && grade !== undefined ? grade.toFixed(1) + '%' : '—'}</span>
      <span class="modal-stat-label">Huidig cijfer</span>
    </div>
    ${attendanceStat}
  `;
}

function buildAssignmentItem(a) {
  const statusInfo = assignmentStatusInfo(a.submissionStatus);
  const dueText = a.isDue
    ? `Inleverdatum: ${formatDateShort(a.dueAt)}`
    : `Deadline: ${formatDateShort(a.dueAt)}`;

  const scoreText = a.score !== null && a.score !== undefined && a.pointsPossible
    ? `${a.score} / ${a.pointsPossible} pt`
    : a.score !== null && a.score !== undefined
    ? `${a.score} pt`
    : '';

  const nameHtml = a.htmlUrl
    ? `<a href="${escHtml(a.htmlUrl)}" target="_blank" rel="noopener noreferrer">${escHtml(a.name)}</a>`
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
  document.getElementById('studentModal').classList.add('hidden');
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

  // Set student info from already-loaded data
  const student = allStudents.find((s) => s.id === studentId);
  document.getElementById('pmStudentName').textContent = student ? student.name : '';
  const pmAvatar = document.getElementById('pmAvatar');
  if (student && student.avatarUrl && !student.avatarUrl.includes('unknown')) {
    pmAvatar.src = student.avatarUrl;
    pmAvatar.style.display = '';
  } else {
    pmAvatar.src = '';
    pmAvatar.style.display = 'none';
  }

  try {
    const res = await fetch(`/api/students/${studentId}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Fout bij ophalen peilmoment gegevens');
    }
    const data = await res.json();

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

    const si = assignmentStatusInfo(item.submissionStatus);
    const scoreText = item.score !== null && item.score !== undefined && item.pointsPossible
      ? `${item.score} / ${item.pointsPossible} pt`
      : item.score !== null && item.score !== undefined
      ? `${item.score} pt`
      : '';
    const dueText = item.dueAt ? `Deadline: ${formatDateShort(item.dueAt)}` : '';
    const nameHtml = item.htmlUrl
      ? `<a href="${escHtml(item.htmlUrl)}" target="_blank" rel="noopener noreferrer">${escHtml(item.assignmentName || item.label)}</a>`
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
  document.getElementById('peilmomentModal').classList.add('hidden');
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

/* ===== Kick off ===== */
loadData();

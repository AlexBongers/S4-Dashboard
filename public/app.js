'use strict';

/* ===== State ===== */
let allStudents = [];
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
    updateStats(overviewData);
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
      case 'missing':
        cmp = b.missing - a.missing;
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
  const { label: statusLabel, cls: statusCls } = statusConfig(s.status);
  const gCls = gradeClass(s.grade);
  const gradeText = s.grade !== null && s.grade !== undefined
    ? `${s.grade.toFixed(1)}%`
    : '<span class="grade-none">geen cijfer</span>';

  const avatarContent = s.avatarUrl && !s.avatarUrl.includes('unknown')
    ? `<img src="${escHtml(s.avatarUrl)}" alt="" onerror="this.parentNode.innerHTML='${escHtml(initials(s.name))}'">`
    : escHtml(initials(s.name));

  const pct = s.submissionRate;
  const color = progressColor(pct);

  return `
    <tr>
      <td>
        <div class="student-name-cell">
          <div class="student-avatar">${avatarContent}</div>
          <span class="student-full-name">${escHtml(s.name)}</span>
        </div>
      </td>
      <td class="center">
        <span class="badge ${statusCls}">${statusLabel}</span>
      </td>
      <td class="center">${s.submitted} / ${s.totalDue}</td>
      <td class="center">
        ${s.missing > 0
          ? `<span style="color: var(--red); font-weight: 600;">${s.missing}</span>`
          : `<span style="color: var(--green);">0</span>`
        }
      </td>
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
      <td class="center">
        ${s.grade !== null && s.grade !== undefined
          ? `<span class="grade-pill ${gCls}">${s.grade.toFixed(1)}%</span>`
          : `<span class="grade-none">—</span>`
        }
      </td>
      <td class="center">
        <button class="detail-btn" data-student-id="${s.id}" onclick="openStudentModal(+this.dataset.studentId)">
          Details
        </button>
      </td>
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
  renderTable();
}

/* ===== State management ===== */
function showState(state) {
  document.getElementById('loading').classList.toggle('hidden', state !== 'loading');
  document.getElementById('errorState').classList.toggle('hidden', state !== 'error');
  document.getElementById('dashboard').classList.toggle('hidden', state !== 'dashboard');
}

/* ===== Student modal ===== */
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
    const s = data.student;
    const st = student || {};
    modalStats.innerHTML = buildModalStats(st, data.assignments);

    // Render assignment list
    document.getElementById('assignmentList').innerHTML =
      data.assignments.map((a) => buildAssignmentItem(a)).join('');

    modalLoading.classList.add('hidden');
    modalContent.classList.remove('hidden');
  } catch (err) {
    modalLoading.innerHTML = `<p style="color: var(--red);">Fout: ${escHtml(err.message)}</p>`;
  }
}

function buildModalStats(student, assignments) {
  const due = assignments.filter((a) => a.isDue);
  const submitted = due.filter((a) =>
    ['graded', 'graded_late', 'submitted', 'submitted_late', 'submitted_early', 'excused'].includes(a.submissionStatus)
  ).length;
  const missing = due.filter((a) => a.submissionStatus === 'missing').length;
  const late = due.filter((a) => ['graded_late', 'submitted_late'].includes(a.submissionStatus)).length;
  const upcoming = assignments.filter((a) => !a.isDue).length;
  const grade = student.grade;

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

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
});

/* ===== Kick off ===== */
loadData();

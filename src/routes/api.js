'use strict';

const express = require('express');
const fetch = require('node-fetch');

const router = express.Router();

function getClient(req) {
  return req.app.locals.canvas;
}

// Peilmoment 1: the assignments to track.
// Each item is matched by Canvas assignment ID first, then by regex pattern as fallback.
const PEILMOMENT1_ITEMS = [
  { key: 'logboek',           label: 'Logboek Professionele Vermogens', pattern: /logboek\s+professionele/i },
  { key: 'kennisassessment',  label: 'Kennisassessment 1',              pattern: /kennis\s*assess?ment\s*1/i },
  { key: 'plan',              label: 'Plan van aanpak',                 pattern: /plan\s+van\s+aanpak/i },
  { key: 'sprintplanning',    label: 'Sprintplanning',                  assignmentId: 392606, pattern: /sprint\s*planning/i },
  { key: 'peilmoment1',       label: 'Peilmoment 1',                    assignmentId: 392598, pattern: /^peilmoment\s*1$/i },
  { key: 'sprint2release',    label: 'Sprint 2 release',                assignmentId: 392607, pattern: /sprint\s*2\s*release/i },
  { key: 'teamcontract',      label: 'Teamcontract',                    assignmentId: 398216, pattern: /teamcontract/i },
  { key: 'teambranding',      label: 'Teambranding presentatie',        assignmentId: 398881, pattern: /teambranding/i },
];

// Margin (in percentage points) used for dynamic "op schema" status thresholds.
// Students within this margin below the class median submission rate are "op schema".
const OP_SCHEMA_MARGIN = 2;

// Find the first Canvas assignment that looks like attendance tracking.
// Canvas Roll Call stores attendance as an assignment with submission_type 'attendance',
// or as an assignment whose name matches common attendance terms.
function findAttendanceAssignment(assignments) {
  return (
    assignments.find((a) => Array.isArray(a.submissionTypes) && a.submissionTypes.includes('attendance')) ||
    assignments.find((a) => /aanwezigheid|attendance/i.test(a.name)) ||
    null
  );
}

// Calculate attendance percentage for one student from their submissions map.
function calcAttendancePct(studentSubs, attendanceAssignment) {
  if (!attendanceAssignment) return null;
  const sub = studentSubs[attendanceAssignment.id];
  if (!sub || sub.score === null || sub.score === undefined) return null;
  if (!attendanceAssignment.pointsPossible) return null;
  return Math.round((sub.score / attendanceAssignment.pointsPossible) * 1000) / 10;
}

// Regex that matches a Canvas assignment page URL and captures the course+host prefix
// and the assignment ID, e.g. https://canvas.hu.nl/courses/50289/assignments/12345
const ASSIGNMENT_URL_RE = /^(https?:\/\/[^/]+\/courses\/\d+)\/assignments\/(\d+)/;

// Build a Canvas SpeedGrader URL from an assignment htmlUrl and a student user ID.
// htmlUrl format: https://canvas.example.nl/courses/50289/assignments/12345
// SpeedGrader URL: https://canvas.example.nl/courses/50289/gradebook/speed_grader?assignment_id=12345&student_id=67890
function buildSpeedGraderUrl(htmlUrl, studentId) {
  if (!htmlUrl) return null;
  const m = htmlUrl.match(ASSIGNMENT_URL_RE);
  if (!m) return null;
  return `${m[1]}/gradebook/speed_grader?assignment_id=${m[2]}&student_id=${studentId}`;
}

// Determine whether a graded submission counts as "completed".
// For pass/fail (complete_incomplete) assignments, grade === 'complete'.
// For numeric assignments, any score > 0 is considered completed.
// Ungraded submitted/pending_review submissions are also counted (benefit of the doubt).
function isCompleted(sub) {
  if (!sub) return false;
  if (sub.excused) return true;
  const state = sub.workflowState;
  if (state === 'submitted' || state === 'pending_review') return true;
  if (state === 'graded') {
    if (sub.grade === 'complete') return true;
    if (sub.score !== null && sub.score !== undefined && sub.score > 0) return true;
    return false;
  }
  return false;
}

// Find a PM1 assignment: try by Canvas assignment ID first, then by regex pattern.
function findPm1Assignment(item, assignments) {
  if (item.assignmentId) {
    const byId = assignments.find((a) => a.id === item.assignmentId);
    if (byId) return byId;
  }
  return assignments.find((a) => item.pattern.test(a.name)) || null;
}

// Compute the median of a numeric array (must be non-empty).
function median(arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

// GET /api/course - Course info
router.get('/course', async (req, res) => {
  try {
    const client = getClient(req);
    const course = await client.getCourseInfo();
    res.json({ name: course.name, id: course.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/overview - All students with progress summary
router.get('/overview', async (req, res) => {
  try {
    const client = getClient(req);

    const [students, assignments, submissions, analyticsSummaries] = await Promise.all([
      client.getStudents(),
      client.getAssignments(),
      client.getAllSubmissions(),
      client.getStudentSummaries(),
    ]);

    const now = new Date();

    // Only consider published assignments
    const publishedAssignments = assignments.filter((a) => a.published);

    // Attendance assignment (if the course uses Canvas Roll Call or similar)
    const attendanceAssignment = findAttendanceAssignment(publishedAssignments);

    // Assignments that are already past their due date (or have no due date = count as due)
    const dueAssignments = publishedAssignments.filter(
      (a) => !a.dueAt || new Date(a.dueAt) <= now
    );

    // Future assignments (not yet due)
    const upcomingAssignments = publishedAssignments.filter(
      (a) => a.dueAt && new Date(a.dueAt) > now
    );

    // Build a lookup: submissionsByStudent[userId][assignmentId] = submission
    const submissionsByStudent = {};
    submissions.forEach((s) => {
      if (!submissionsByStudent[s.userId]) {
        submissionsByStudent[s.userId] = {};
      }
      submissionsByStudent[s.userId][s.assignmentId] = s;
    });

    // Precompute which assignments map to each Peilmoment 1 item
    const pm1AssignmentRefs = PEILMOMENT1_ITEMS.map((item) => ({
      assignment: findPm1Assignment(item, publishedAssignments),
    }));
    // Only count PM1 items that actually exist in Canvas towards the total
    const PM1_TOTAL = pm1AssignmentRefs.filter((r) => r.assignment !== null).length;

    // First pass: compute per-student stats (status assigned in second pass)
    const rawOverview = students.map((student) => {
      const studentSubs = submissionsByStudent[student.id] || {};

      let submitted = 0;
      let missing = 0;
      let late = 0;
      let graded = 0;
      let totalScore = 0;
      let totalPossible = 0;
      let lastSubmittedAt = null;

      dueAssignments.forEach((assignment) => {
        const sub = studentSubs[assignment.id];
        if (!sub) {
          missing += 1;
          return;
        }

        if (sub.excused) {
          // Count excused as submitted for tracking purposes
          submitted += 1;
          return;
        }

        const state = sub.workflowState;
        if (state === 'submitted' || state === 'pending_review') {
          // Submitted but not yet graded — give benefit of the doubt
          submitted += 1;
          if (sub.late) late += 1;
        } else if (state === 'graded') {
          // Only count as completed if actually passed/completed
          if (isCompleted(sub)) {
            submitted += 1;
          } else {
            missing += 1;
          }
          if (sub.late) late += 1;
        } else {
          missing += 1;
        }

        if (state === 'graded' && sub.score !== null && sub.score !== undefined) {
          graded += 1;
          totalScore += sub.score;
          if (assignment.pointsPossible) {
            totalPossible += assignment.pointsPossible;
          }
        }

        // Track most recent submission timestamp
        if (sub.submittedAt) {
          if (!lastSubmittedAt || new Date(sub.submittedAt) > new Date(lastSubmittedAt)) {
            lastSubmittedAt = sub.submittedAt;
          }
        }
      });

      // Also check upcoming assignments for early submissions
      upcomingAssignments.forEach((assignment) => {
        const sub = studentSubs[assignment.id];
        if (sub && sub.submittedAt) {
          if (!lastSubmittedAt || new Date(sub.submittedAt) > new Date(lastSubmittedAt)) {
            lastSubmittedAt = sub.submittedAt;
          }
        }
      });

      const totalDue = dueAssignments.length;
      const submissionRate = totalDue > 0 ? (submitted / totalDue) * 100 : 100;
      const gradePercentage =
        totalPossible > 0 ? (totalScore / totalPossible) * 100 : null;

      // Peilmoment 1: count how many items are complete for this student
      let pm1GreenCount = 0;
      pm1AssignmentRefs.forEach(({ assignment }) => {
        if (!assignment) return;
        const isDuePm1 = !assignment.dueAt || new Date(assignment.dueAt) <= now;
        const sub = studentSubs[assignment.id];
        let pm1Sub;
        if (isDuePm1) {
          if (!sub || sub.workflowState === 'unsubmitted') pm1Sub = 'missing';
          else if (sub.excused) pm1Sub = 'excused';
          else pm1Sub = sub.workflowState;
        } else {
          pm1Sub = (sub && sub.workflowState !== 'unsubmitted') ? 'submitted_early' : 'not_due';
        }
        if (['submitted', 'pending_review', 'excused', 'submitted_early'].includes(pm1Sub)) {
          pm1GreenCount++;
        } else if (pm1Sub === 'graded') {
          // For graded peilmoment items, only count if actually passed
          if (isCompleted(sub)) pm1GreenCount++;
        }
      });

      const peilmoment1Status = pm1GreenCount >= PM1_TOTAL ? 'green'
        : pm1GreenCount > 0 ? 'yellow'
        : 'red';

      // Submission trend: compare submissions in recent 2 weeks vs prior 2 weeks
      const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
      const fourWeeksAgo = new Date(now.getTime() - 28 * 24 * 60 * 60 * 1000);
      let recentCount = 0;
      let priorCount = 0;
      Object.values(studentSubs).forEach((sub) => {
        if (!sub.submittedAt) return;
        const t = new Date(sub.submittedAt);
        if (t >= twoWeeksAgo && t <= now) recentCount++;
        else if (t >= fourWeeksAgo && t < twoWeeksAgo) priorCount++;
      });
      // trend: 'up' if recent > prior, 'down' if recent < prior, 'steady' otherwise
      let trend = 'steady';
      if (recentCount > priorCount + 1) trend = 'up';
      else if (recentCount < priorCount - 1) trend = 'down';

      // Canvas analytics data
      const analytics = analyticsSummaries[student.id] || {};

      return {
        id: student.id,
        name: student.name,
        sortableName: student.sortableName,
        avatarUrl: student.avatarUrl,
        grade: student.grade,
        letterGrade: student.letterGrade,
        lastActivityAt: student.lastActivityAt,
        lastSubmittedAt,
        trend,
        pageViews: analytics.pageViews ?? null,
        participations: analytics.participations ?? null,
        submitted,
        missing,
        late,
        graded,
        totalDue,
        totalAssignments: publishedAssignments.length,
        upcomingCount: upcomingAssignments.length,
        submissionRate: Math.round(submissionRate * 10) / 10,
        gradePercentage:
          gradePercentage !== null ? Math.round(gradePercentage * 10) / 10 : null,
        attendancePct: calcAttendancePct(studentSubs, attendanceAssignment),
        peilmoment1Status,
        peilmoment1GreenCount: pm1GreenCount,
        peilmoment1Total: PM1_TOTAL,
      };
    });

    // Second pass: assign status using dynamic thresholds based on class median
    const rates = rawOverview.map((s) => s.submissionRate);
    const medianRate = rates.length > 0 ? median(rates) : 0;

    const overview = rawOverview.map((s) => {
      let status;
      if (s.totalDue === 0) {
        status = 'op_schema'; // Nothing due yet
      } else if (s.submissionRate >= medianRate - OP_SCHEMA_MARGIN) {
        status = 'op_schema';
      } else if (s.submissionRate >= medianRate - 2 * OP_SCHEMA_MARGIN) {
        status = 'let_op';
      } else {
        status = 'achterloopt';
      }

      // Override: if grade is good and well above median, allow "voorloopt"
      if (
        s.grade !== null &&
        s.grade !== undefined &&
        s.grade >= 85 &&
        s.submissionRate >= medianRate + OP_SCHEMA_MARGIN
      ) {
        status = 'voorloopt';
      }

      return { ...s, status };
    });

    // Sort by sortable name
    overview.sort((a, b) => a.sortableName.localeCompare(b.sortableName));

    res.json({
      students: overview,
      assignmentCount: publishedAssignments.length,
      dueCount: dueAssignments.length,
      upcomingCount: upcomingAssignments.length,
      hasAttendance: attendanceAssignment !== null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/students/:id - Detailed student view with per-assignment breakdown
router.get('/students/:id', async (req, res) => {
  try {
    const client = getClient(req);
    const studentId = parseInt(req.params.id, 10);

    const [students, assignments, submissions, assignmentGroups] = await Promise.all([
      client.getStudents(),
      client.getAssignments(),
      client.getAllSubmissions(),
      client.getAssignmentGroups(),
    ]);

    const student = students.find((s) => s.id === studentId);
    if (!student) {
      return res.status(404).json({ error: 'Student niet gevonden' });
    }

    const publishedAssignments = assignments.filter((a) => a.published);
    const now = new Date();

    const attendanceAssignment = findAttendanceAssignment(publishedAssignments);

    const studentSubs = {};
    submissions
      .filter((s) => s.userId === studentId)
      .forEach((s) => {
        studentSubs[s.assignmentId] = s;
      });

    // Build assignment group lookup
    const groupLookup = {};
    assignmentGroups.forEach((g) => { groupLookup[g.id] = g.name; });

    const assignmentDetails = publishedAssignments.map((assignment) => {
      const sub = studentSubs[assignment.id];
      const isDue = !assignment.dueAt || new Date(assignment.dueAt) <= now;

      let submissionStatus = 'not_due';
      if (isDue) {
        if (!sub || sub.workflowState === 'unsubmitted') {
          submissionStatus = 'missing';
        } else if (sub.excused) {
          submissionStatus = 'excused';
        } else if (sub.workflowState === 'graded') {
          submissionStatus = sub.late ? 'graded_late' : 'graded';
        } else if (sub.workflowState === 'submitted' || sub.workflowState === 'pending_review') {
          submissionStatus = sub.late ? 'submitted_late' : 'submitted';
        }
      } else if (sub && sub.workflowState !== 'unsubmitted') {
        submissionStatus = 'submitted_early';
      }

      return {
        id: assignment.id,
        name: assignment.name,
        dueAt: assignment.dueAt,
        pointsPossible: assignment.pointsPossible,
        htmlUrl: assignment.htmlUrl,
        speedGraderUrl: buildSpeedGraderUrl(assignment.htmlUrl, studentId),
        assignmentGroupId: assignment.assignmentGroupId,
        assignmentGroupName: groupLookup[assignment.assignmentGroupId] || null,
        isDue,
        submissionStatus,
        score: sub ? sub.score : null,
        grade: sub ? sub.grade : null,
        submittedAt: sub ? sub.submittedAt : null,
        late: sub ? sub.late : false,
        missing: sub ? sub.missing : isDue,
      };
    });

    // --- Peilmoment 1 data ---
    const attendancePct = calcAttendancePct(studentSubs, attendanceAssignment);

    const peilmoment1 = PEILMOMENT1_ITEMS.map((item) => {
      const assignment = findPm1Assignment(item, publishedAssignments);
      if (!assignment) {
        return { key: item.key, label: item.label, found: false };
      }
      const detail = assignmentDetails.find((d) => d.id === assignment.id);
      return {
        key: item.key,
        label: item.label,
        found: true,
        assignmentId: assignment.id,
        assignmentName: assignment.name,
        dueAt: assignment.dueAt,
        pointsPossible: assignment.pointsPossible,
        htmlUrl: assignment.htmlUrl,
        speedGraderUrl: buildSpeedGraderUrl(assignment.htmlUrl, studentId),
        submissionStatus: detail ? detail.submissionStatus : 'not_due',
        score: detail ? detail.score : null,
        grade: detail ? detail.grade : null,
        submittedAt: detail ? detail.submittedAt : null,
      };
    });

    res.json({
      student,
      assignments: assignmentDetails,
      assignmentGroups,
      attendancePct,
      peilmoment1,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/cache/clear — Clear server-side Canvas API cache so the next
// request fetches fresh data from Canvas.
router.post('/cache/clear', (req, res) => {
  const client = getClient(req);
  client.clearCache();
  res.json({ cleared: true });
});

// GET /api/avatar?url=... — Proxy Canvas avatar images so the browser never needs
// to load them directly (handles auth-protected or short-token URLs on canvas.hu.nl).
router.get('/avatar', async (req, res) => {
  const avatarUrl = req.query.url;
  if (!avatarUrl) return res.status(400).end();

  // Validate: must be an https URL
  let parsed;
  try {
    parsed = new URL(avatarUrl);
    if (parsed.protocol !== 'https:') return res.status(400).end();
  } catch {
    return res.status(400).end();
  }

  // Allow only the configured Canvas domain and known Canvas CDN hostnames
  const canvasBase = process.env.CANVAS_BASE_URL || '';
  let canvasHostname = null;
  try { canvasHostname = new URL(canvasBase).hostname; } catch { /* ignore */ }
  const allowedHosts = new Set(
    [
      canvasHostname,
      'du11hjcvx0uqb.cloudfront.net',
      'instructure-uploads.s3.amazonaws.com',
      'instructure-uploads-global.s3.amazonaws.com',
    ].filter(Boolean)
  );
  if (!allowedHosts.has(parsed.hostname)) return res.status(403).end();

  try {
    const upstream = await fetch(avatarUrl, {
      headers: { Authorization: `Bearer ${process.env.CANVAS_API_TOKEN}` },
    });
    if (!upstream.ok) return res.status(upstream.status).end();

    const ct = upstream.headers.get('content-type') || 'image/jpeg';
    if (!ct.startsWith('image/')) return res.status(415).end();

    res.set('Content-Type', ct);
    res.set('Cache-Control', 'public, max-age=86400');
    upstream.body.pipe(res);
  } catch {
    res.status(502).end();
  }
});

module.exports = router;

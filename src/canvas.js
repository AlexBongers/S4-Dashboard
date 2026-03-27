'use strict';

const fetch = require('node-fetch');

/** Default cache lifetime in milliseconds (5 minutes), configurable via CANVAS_CACHE_TTL_SECONDS env var. */
const CACHE_TTL_MS = (parseInt(process.env.CANVAS_CACHE_TTL_SECONDS, 10) || 300) * 1000;

class CanvasClient {
  constructor({ apiToken, baseUrl, courseId }) {
    // Strip trailing slash and extract the origin (base host)
    const url = new URL(baseUrl);
    this.apiBase = `${url.protocol}//${url.host}/api/v1`;
    this.courseId = courseId;
    this.headers = {
      Authorization: `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
    };

    // Simple in-memory cache: { key: { data, timestamp } }
    this._cache = {};
  }

  /**
   * Return cached data if still fresh, otherwise null.
   */
  _cacheGet(key) {
    const entry = this._cache[key];
    if (entry && Date.now() - entry.timestamp < CACHE_TTL_MS) {
      return entry.data;
    }
    return null;
  }

  /**
   * Store data in the cache.
   */
  _cacheSet(key, data) {
    this._cache[key] = { data, timestamp: Date.now() };
  }

  /**
   * Clear all cached data (called when the user explicitly refreshes).
   */
  clearCache() {
    this._cache = {};
  }

  async _get(path, params = {}) {
    const url = new URL(`${this.apiBase}${path}`);
    Object.entries(params).forEach(([key, value]) => {
      if (Array.isArray(value)) {
        value.forEach((v) => url.searchParams.append(`${key}[]`, v));
      } else {
        url.searchParams.set(key, value);
      }
    });

    const results = [];
    let nextUrl = url.toString();

    while (nextUrl) {
      const response = await fetch(nextUrl, { headers: this.headers });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(
          `Canvas API error ${response.status} for ${nextUrl}: ${text}`
        );
      }
      const data = await response.json();
      if (Array.isArray(data)) {
        results.push(...data);
      } else {
        return data;
      }

      // Handle pagination via Link header
      const linkHeader = response.headers.get('Link') || '';
      const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
      nextUrl = nextMatch ? nextMatch[1] : null;
    }

    return results;
  }

  async getStudents() {
    const cacheKey = `students_${this.courseId}`;
    const cached = this._cacheGet(cacheKey);
    if (cached) return cached;

    const enrollments = await this._get(`/courses/${this.courseId}/enrollments`, {
      type: ['StudentEnrollment'],
      state: ['active'],
      per_page: 100,
    });

    // Deduplicate: students enrolled in multiple sections appear more than once
    const seen = new Map();
    for (const e of enrollments) {
      if (!seen.has(e.user_id)) {
        seen.set(e.user_id, e);
      }
    }

    const result = Array.from(seen.values()).map((e) => ({
      id: e.user_id,
      name: e.user.name,
      sortableName: e.user.sortable_name,
      avatarUrl: e.user.avatar_url,
      grade: e.grades ? e.grades.current_score : null,
      letterGrade: e.grades ? e.grades.current_grade : null,
      lastActivityAt: e.last_activity_at || null,
    }));
    this._cacheSet(cacheKey, result);
    return result;
  }

  async getAssignments() {
    const cacheKey = `assignments_${this.courseId}`;
    const cached = this._cacheGet(cacheKey);
    if (cached) return cached;

    const assignments = await this._get(`/courses/${this.courseId}/assignments`, {
      per_page: 100,
      order_by: 'due_at',
    });

    const result = assignments.map((a) => ({
      id: a.id,
      name: a.name,
      dueAt: a.due_at,
      pointsPossible: a.points_possible,
      published: a.published,
      submissionTypes: a.submission_types,
      htmlUrl: a.html_url,
      assignmentGroupId: a.assignment_group_id,
      groupCategoryId: a.group_category_id || null,
    }));
    this._cacheSet(cacheKey, result);
    return result;
  }

  async getAllSubmissions() {
    const cacheKey = `submissions_${this.courseId}`;
    const cached = this._cacheGet(cacheKey);
    if (cached) return cached;

    const submissions = await this._get(
      `/courses/${this.courseId}/students/submissions`,
      {
        student_ids: ['all'],
        per_page: 100,
      }
    );

    const result = submissions.map((s) => ({
      assignmentId: s.assignment_id,
      userId: s.user_id,
      score: s.score,
      grade: s.grade,
      submittedAt: s.submitted_at,
      workflowState: s.workflow_state, // 'submitted', 'unsubmitted', 'graded', 'pending_review'
      late: s.late,
      missing: s.missing,
      excused: s.excused,
    }));
    this._cacheSet(cacheKey, result);
    return result;
  }

  async getCourseInfo() {
    const cacheKey = `course_${this.courseId}`;
    const cached = this._cacheGet(cacheKey);
    if (cached) return cached;

    const result = await this._get(`/courses/${this.courseId}`);
    this._cacheSet(cacheKey, result);
    return result;
  }

  async getAssignmentGroups() {
    const cacheKey = `assignment_groups_${this.courseId}`;
    const cached = this._cacheGet(cacheKey);
    if (cached) return cached;

    const groups = await this._get(`/courses/${this.courseId}/assignment_groups`, {
      per_page: 100,
    });

    const result = groups.map((g) => ({
      id: g.id,
      name: g.name,
      position: g.position,
      groupWeight: g.group_weight,
    }));
    this._cacheSet(cacheKey, result);
    return result;
  }

  async getStudentSummaries() {
    const cacheKey = `student_summaries_${this.courseId}`;
    const cached = this._cacheGet(cacheKey);
    if (cached) return cached;

    try {
      const summaries = await this._get(
        `/courses/${this.courseId}/analytics/student_summaries`,
        { per_page: 100 }
      );

      // Build a lookup by student id
      const result = {};
      for (const s of summaries) {
        result[s.id] = {
          pageViews: s.page_views ?? null,
          participations: s.participations ?? null,
          tardinessBreakdown: s.tardiness_breakdown || null,
        };
      }
      this._cacheSet(cacheKey, result);
      return result;
    } catch {
      // Analytics API may not be available for all courses
      return {};
    }
  }
  /**
   * Fetch submissions for a specific assignment and return the first DOCX
   * attachment found. Returns null if no DOCX attachment exists.
   * Results are cached with the normal TTL.
   */
  async getGroupSubmissionDocx(assignmentId) {
    const cacheKey = `group_docx_${this.courseId}_${assignmentId}`;
    const cached = this._cacheGet(cacheKey);
    // Use a wrapper so we can cache a null result without confusing it with
    // "not in cache" (which also returns null from _cacheGet).
    if (cached) return cached.attachment;

    let attachment = null;
    try {
      const submissions = await this._get(
        `/courses/${this.courseId}/assignments/${assignmentId}/submissions`,
        { student_ids: ['all'], include: ['attachment'], per_page: 100 }
      );

      for (const s of submissions) {
        if (!Array.isArray(s.attachments) || s.attachments.length === 0) continue;
        const docx = s.attachments.find(
          (a) =>
            (a.content_type &&
              a.content_type.includes('wordprocessingml')) ||
            (a.filename && a.filename.toLowerCase().endsWith('.docx'))
        );
        if (docx) {
          attachment = docx;
          break;
        }
      }
    } catch {
      // If the submissions endpoint fails, treat as no attachment
    }

    this._cacheSet(cacheKey, { attachment });
    return attachment;
  }

  /**
   * Download a Canvas file URL (authenticated) and return a Buffer.
   */
  async downloadFileBuffer(url) {
    const response = await fetch(url, { headers: this.headers });
    if (!response.ok) {
      throw new Error(`Canvas file download failed: ${response.status}`);
    }
    const arrayBuf = await response.buffer();
    return arrayBuf;
  }
}

module.exports = CanvasClient;

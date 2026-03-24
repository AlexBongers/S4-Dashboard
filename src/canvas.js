'use strict';

const fetch = require('node-fetch');

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

    return Array.from(seen.values()).map((e) => ({
      id: e.user_id,
      name: e.user.name,
      sortableName: e.user.sortable_name,
      avatarUrl: e.user.avatar_url,
      grade: e.grades ? e.grades.current_score : null,
      letterGrade: e.grades ? e.grades.current_grade : null,
    }));
  }

  async getAssignments() {
    const assignments = await this._get(`/courses/${this.courseId}/assignments`, {
      per_page: 100,
      order_by: 'due_at',
    });

    return assignments.map((a) => ({
      id: a.id,
      name: a.name,
      dueAt: a.due_at,
      pointsPossible: a.points_possible,
      published: a.published,
      submissionTypes: a.submission_types,
      htmlUrl: a.html_url,
    }));
  }

  async getAllSubmissions() {
    const submissions = await this._get(
      `/courses/${this.courseId}/students/submissions`,
      {
        student_ids: ['all'],
        per_page: 100,
      }
    );

    return submissions.map((s) => ({
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
  }

  async getCourseInfo() {
    return this._get(`/courses/${this.courseId}`);
  }
}

module.exports = CanvasClient;

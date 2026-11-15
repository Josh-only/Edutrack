import { apiRequest, isRecord, requireNumber, requireString } from './api'

export type AttendanceStatus = 'present' | 'absent'
export type AssessmentType = 'assignment' | 'exam'

export interface Course {
  id: number
  code: string
  title: string
  description: string | null
  teacher: { id: number; name: string }
  enrollmentCount: number
}

export interface CourseRosterEntry {
  id: number
  studentId: number
  firstName: string
  lastName: string
  email: string
  status: 'active' | 'dropped'
}

export interface GradeEntry {
  studentId: number
  studentName: string
  score: number
}

export interface Assessment {
  id: number
  title: string
  type: AssessmentType
  date: string
  maxScore: number
  grades: GradeEntry[]
}

export interface CourseDetails extends Course {
  roster: CourseRosterEntry[]
  assessments: Assessment[]
}

export interface AttendanceRecord {
  id: number
  enrollmentId: number
  studentId: number
  studentName: string
  date: string
  status: AttendanceStatus
}

export interface AcademicReportRow {
  courseId: number
  code: string
  title: string
  teacherName: string
  enrollmentCount: number
  attendanceRate: number | null
  gradeAverage: number | null
}

export interface StudentOverview {
  courseCount: number
  attendanceRate: number | null
  gradeAverage: number | null
  courses: Course[]
}

export interface InAppNotification {
  id: number
  message: string
  readAt: string | null
  createdAt: string
}

const invalidCourse = 'The course data returned by the server is invalid.'

function parseCourse(value: unknown): Course {
  if (!isRecord(value) || !isRecord(value.teacher)) throw new Error(invalidCourse)
  const description = value.description
  if (description !== null && typeof description !== 'string') throw new Error(invalidCourse)
  return {
    id: requireNumber(value.id, invalidCourse),
    code: requireString(value.code, invalidCourse),
    title: requireString(value.title, invalidCourse),
    description,
    teacher: {
      id: requireNumber(value.teacher.id, invalidCourse),
      name: requireString(value.teacher.name, invalidCourse),
    },
    enrollmentCount: requireNumber(value.enrollmentCount, invalidCourse),
  }
}

function parseRosterEntry(value: unknown): CourseRosterEntry {
  if (!isRecord(value) || (value.status !== 'active' && value.status !== 'dropped')) {
    throw new Error('The course roster returned by the server is invalid.')
  }
  return {
    id: requireNumber(value.id, 'The course roster returned by the server is invalid.'),
    studentId: requireNumber(value.studentId, 'The course roster returned by the server is invalid.'),
    firstName: requireString(value.firstName, 'The course roster returned by the server is invalid.'),
    lastName: requireString(value.lastName, 'The course roster returned by the server is invalid.'),
    email: requireString(value.email, 'The course roster returned by the server is invalid.'),
    status: value.status,
  }
}

function parseAssessment(value: unknown): Assessment {
  if (!isRecord(value) || !Array.isArray(value.grades) ||
      (value.type !== 'assignment' && value.type !== 'exam')) {
    throw new Error('The gradebook data returned by the server is invalid.')
  }
  return {
    id: requireNumber(value.id, 'The gradebook data returned by the server is invalid.'),
    title: requireString(value.title, 'The gradebook data returned by the server is invalid.'),
    type: value.type,
    date: requireString(value.date, 'The gradebook data returned by the server is invalid.'),
    maxScore: requireNumber(value.maxScore, 'The gradebook data returned by the server is invalid.'),
    grades: value.grades.map((grade: unknown) => {
      if (!isRecord(grade)) throw new Error('The gradebook data returned by the server is invalid.')
      return {
        studentId: requireNumber(grade.studentId, 'The gradebook data returned by the server is invalid.'),
        studentName: requireString(grade.studentName, 'The gradebook data returned by the server is invalid.'),
        score: requireNumber(grade.score, 'The gradebook data returned by the server is invalid.'),
      }
    }),
  }
}

export async function getCourses(): Promise<Course[]> {
  const result = await apiRequest('/courses')
  if (!Array.isArray(result)) throw new Error('The course list returned by the server is invalid.')
  return result.map(parseCourse)
}

export async function getCourse(id: number): Promise<CourseDetails> {
  const result = await apiRequest(`/courses/${encodeURIComponent(id)}`)
  if (!isRecord(result) || !Array.isArray(result.roster) || !Array.isArray(result.assessments)) {
    throw new Error('The course details returned by the server are invalid.')
  }
  return {
    ...parseCourse(result),
    roster: result.roster.map(parseRosterEntry),
    assessments: result.assessments.map(parseAssessment),
  }
}

export async function createCourse(input: {
  code: string
  title: string
  description?: string
  teacherId: number
}): Promise<Course> {
  return parseCourse(await apiRequest('/courses', { method: 'POST', body: JSON.stringify(input) }))
}

export async function updateCourse(id: number, input: Partial<{
  code: string
  title: string
  description: string
  teacherId: number
}>): Promise<Course> {
  return parseCourse(await apiRequest(`/courses/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  }))
}

export async function deleteCourse(id: number): Promise<void> {
  await apiRequest(`/courses/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export async function enrollStudent(courseId: number, studentId: number): Promise<void> {
  await apiRequest(`/courses/${encodeURIComponent(courseId)}/enrollments`, {
    method: 'POST',
    body: JSON.stringify({ studentId }),
  })
}

export async function withdrawEnrollment(enrollmentId: number): Promise<void> {
  await apiRequest(`/enrollments/${encodeURIComponent(enrollmentId)}/withdraw`, { method: 'PATCH' })
}

export async function getAttendance(courseId: number, date?: string): Promise<AttendanceRecord[]> {
  const query = date ? `?date=${encodeURIComponent(date)}` : ''
  const result = await apiRequest(`/courses/${encodeURIComponent(courseId)}/attendance${query}`)
  if (!Array.isArray(result)) throw new Error('The attendance data returned by the server is invalid.')
  return result.map((value: unknown) => {
    if (!isRecord(value) || (value.status !== 'present' && value.status !== 'absent')) {
      throw new Error('The attendance data returned by the server is invalid.')
    }
    return {
      id: requireNumber(value.id, 'The attendance data returned by the server is invalid.'),
      enrollmentId: requireNumber(value.enrollmentId, 'The attendance data returned by the server is invalid.'),
      studentId: requireNumber(value.studentId, 'The attendance data returned by the server is invalid.'),
      studentName: requireString(value.studentName, 'The attendance data returned by the server is invalid.'),
      date: requireString(value.date, 'The attendance data returned by the server is invalid.'),
      status: value.status,
    }
  })
}

export async function saveAttendance(
  courseId: number,
  date: string,
  records: Array<{ studentId: number; status: AttendanceStatus }>,
): Promise<void> {
  await apiRequest(`/courses/${encodeURIComponent(courseId)}/attendance`, {
    method: 'POST',
    body: JSON.stringify({ date, records }),
  })
}

export async function createAssessment(
  courseId: number,
  input: { title: string; type: AssessmentType; maxScore: number; date: string },
): Promise<Assessment> {
  return parseAssessment(await apiRequest(`/courses/${encodeURIComponent(courseId)}/assessments`, {
    method: 'POST',
    body: JSON.stringify(input),
  }))
}

export async function saveGrades(
  assessmentId: number,
  grades: Array<{ studentId: number; score: number }>,
): Promise<void> {
  await apiRequest(`/assessments/${encodeURIComponent(assessmentId)}/grades`, {
    method: 'PUT',
    body: JSON.stringify({ grades }),
  })
}

export async function getAcademicReport(): Promise<AcademicReportRow[]> {
  const result = await apiRequest('/reports/academic')
  if (!isRecord(result) || !Array.isArray(result.courses)) {
    throw new Error('The academic report returned by the server is invalid.')
  }
  return result.courses.map((value: unknown) => {
    if (!isRecord(value)) throw new Error('The academic report returned by the server is invalid.')
    const attendanceRate = value.attendanceRate
    const gradeAverage = value.gradeAverage
    if ((attendanceRate !== null && typeof attendanceRate !== 'number') ||
        (gradeAverage !== null && typeof gradeAverage !== 'number')) {
      throw new Error('The academic report returned by the server is invalid.')
    }
    return {
      courseId: requireNumber(value.courseId, 'The academic report returned by the server is invalid.'),
      code: requireString(value.code, 'The academic report returned by the server is invalid.'),
      title: requireString(value.title, 'The academic report returned by the server is invalid.'),
      teacherName: requireString(value.teacherName, 'The academic report returned by the server is invalid.'),
      enrollmentCount: requireNumber(value.enrollmentCount, 'The academic report returned by the server is invalid.'),
      attendanceRate,
      gradeAverage,
    }
  })
}

export async function getStudentOverview(): Promise<StudentOverview> {
  const result = await apiRequest('/reports/student')
  if (!isRecord(result) || !Array.isArray(result.courses)) {
    throw new Error('The student overview returned by the server is invalid.')
  }
  const attendanceRate = result.attendanceRate
  const gradeAverage = result.gradeAverage
  if ((attendanceRate !== null && typeof attendanceRate !== 'number') ||
      (gradeAverage !== null && typeof gradeAverage !== 'number')) {
    throw new Error('The student overview returned by the server is invalid.')
  }
  return {
    courseCount: requireNumber(result.courseCount, 'The student overview returned by the server is invalid.'),
    attendanceRate,
    gradeAverage,
    courses: result.courses.map(parseCourse),
  }
}

export async function getNotifications(): Promise<InAppNotification[]> {
  const result = await apiRequest('/notifications')
  if (!Array.isArray(result)) throw new Error('The notifications returned by the server are invalid.')
  return result.map((value: unknown) => {
    if (!isRecord(value)) throw new Error('The notifications returned by the server are invalid.')
    const readAt = value.readAt
    if (readAt !== null && typeof readAt !== 'string') throw new Error('The notifications returned by the server are invalid.')
    return {
      id: requireNumber(value.id, 'The notifications returned by the server are invalid.'),
      message: requireString(value.message, 'The notifications returned by the server are invalid.'),
      readAt,
      createdAt: requireString(value.createdAt, 'The notifications returned by the server are invalid.'),
    }
  })
}

export async function markNotificationRead(id: number): Promise<void> {
  await apiRequest(`/notifications/${encodeURIComponent(id)}/read`, { method: 'PATCH' })
}

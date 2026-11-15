import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import { EmptyState, ErrorState, LoadingState, PageTitle } from '../components/PagePrimitives'
import { getStudents } from '../services/students'
import type { Student } from '../services/api-models'
import { getMyStaffProfile, getStaff } from '../services/staff'
import type { StaffMember } from '../services/api-models'
import {
  createAssessment,
  createCourse,
  deleteCourse,
  enrollStudent,
  getAttendance,
  getCourse,
  getCourses,
  saveAttendance,
  saveGrades,
  updateCourse,
  withdrawEnrollment,
} from '../services/academic'
import type {
  AssessmentType,
  AttendanceStatus,
  Course,
  CourseDetails,
} from '../services/academic'
import '../Academic.css'

const today = () => new Date().toISOString().slice(0, 10)

export default function CoursesPage() {
  const { account } = useAuth()
  const { id } = useParams()
  const navigate = useNavigate()
  const hasCourseRoute = id !== undefined
  const courseId = hasCourseRoute ? Number(id) : null
  const isStudent = account?.accountType === 'student'
  const isSuperAdmin = account?.accountType === 'super_admin'
  const basePath = isSuperAdmin ? '/super-admin' : isStudent ? '/student' : '/staff'
  const canManage = !isStudent

  const [courses, setCourses] = useState<Course[]>([])
  const [course, setCourse] = useState<CourseDetails | null>(null)
  const [students, setStudents] = useState<Student[]>([])
  const [staff, setStaff] = useState<StaffMember[]>([])
  const [ownStaffId, setOwnStaffId] = useState<number | null>(null)
  const [listLoading, setListLoading] = useState(true)
  const [listError, setListError] = useState('')
  const [loadedCourseId, setLoadedCourseId] = useState<number | null>(null)
  const [detailFailure, setDetailFailure] = useState<{ id: number; message: string } | null>(null)
  const [retry, setRetry] = useState(0)
  const [saving, setSaving] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')
  const [message, setMessage] = useState('')
  const [formError, setFormError] = useState('')
  const [showCourseForm, setShowCourseForm] = useState(false)
  const [editingCourse, setEditingCourse] = useState(false)
  const [courseForm, setCourseForm] = useState({ code: '', title: '', description: '', teacherId: '' })
  const [studentId, setStudentId] = useState('')
  const [attendanceDate, setAttendanceDate] = useState(today())
  const [attendanceDraft, setAttendanceDraft] = useState<{
    courseId: number
    date: string
    values: Record<number, AttendanceStatus>
  } | null>(null)
  const [attendanceFailure, setAttendanceFailure] = useState<{ courseId: number; date: string; message: string } | null>(null)
  const [assessmentForm, setAssessmentForm] = useState({
    title: '',
    type: 'assignment' as AssessmentType,
    maxScore: '100',
    date: today(),
  })
  const [gradeDrafts, setGradeDrafts] = useState<Record<number, Record<number, string>>>({})

  function reload() {
    setListLoading(true)
    setListError('')
    setLoadedCourseId(null)
    setDetailFailure(null)
    setAttendanceDraft(null)
    setAttendanceFailure(null)
    setGradeDrafts({})
    setRetry((value) => value + 1)
  }

  useEffect(() => {
    let active = true
    const tasks: Promise<unknown>[] = [getCourses()]
    if (canManage) tasks.push(getStudents())
    if (isSuperAdmin) tasks.push(getStaff())
    else if (account?.accountType === 'staff') tasks.push(getMyStaffProfile())
    void Promise.all(tasks).then((results) => {
      if (!active) return
      setCourses(results[0] as Course[])
      setListError('')
      let index = 1
      if (canManage) {
        setStudents((results[index] as { all: Student[] }).all)
        index++
      }
      if (isSuperAdmin) setStaff(results[index] as StaffMember[])
      else if (account?.accountType === 'staff') setOwnStaffId((results[index] as StaffMember).id)
    }).catch((reason: unknown) => {
      if (active) setListError(reason instanceof Error ? reason.message : 'Unable to load courses.')
    }).finally(() => {
      if (active) setListLoading(false)
    })
    return () => { active = false }
  }, [account?.accountType, canManage, isStudent, isSuperAdmin, retry])

  useEffect(() => {
    if (courseId === null || !Number.isInteger(courseId) || courseId < 1) return
    let active = true
    void getCourse(courseId).then((result) => {
      if (active) {
        setCourse(result)
        setLoadedCourseId(courseId)
        setDetailFailure(null)
        setCourseForm({
          code: result.code,
          title: result.title,
          description: result.description ?? '',
          teacherId: String(result.teacher.id),
        })
      }
    }).catch((reason: unknown) => {
      if (active) setDetailFailure({
        id: courseId,
        message: reason instanceof Error ? reason.message : 'Unable to load this course.',
      })
    })
    return () => { active = false }
  }, [courseId, retry])

  useEffect(() => {
    if (!course || isStudent) return
    let active = true
    void getAttendance(course.id, attendanceDate).then((records) => {
      if (!active) return
      setAttendanceDraft({
        courseId: course.id,
        date: attendanceDate,
        values: Object.fromEntries(records.map((record) => [record.studentId, record.status])),
      })
    }).catch((reason: unknown) => {
      if (active) setAttendanceFailure({
        courseId: course.id,
        date: attendanceDate,
        message: reason instanceof Error ? reason.message : 'Unable to load attendance.',
      })
    })
    return () => { active = false }
  }, [course, attendanceDate, isStudent])

  const availableStudents = useMemo(() => {
    const enrolled = new Set(course?.roster.map((entry) => entry.studentId) ?? [])
    return students.filter((student) => !enrolled.has(student.id))
  }, [course, students])

  async function submitCourse(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setFormError('')
    setMessage('')
    try {
      const input = {
        code: courseForm.code.trim(),
        title: courseForm.title.trim(),
        description: courseForm.description.trim(),
        teacherId: isSuperAdmin ? Number(courseForm.teacherId) : ownStaffId ?? 0,
      }
      if (editingCourse && course) {
        await updateCourse(course.id, input)
        setMessage('Course updated.')
      } else {
        await createCourse(input)
        setMessage('Course created.')
        setCourseForm({ code: '', title: '', description: '', teacherId: isSuperAdmin ? '' : String(ownStaffId ?? '') })
      }
      setShowCourseForm(false)
      setEditingCourse(false)
      reload()
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : 'Unable to save the course.')
    } finally {
      setSaving(false)
    }
  }

  async function addStudent(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!course || !studentId) return
    setSaving(true)
    setFormError('')
    try {
      await enrollStudent(course.id, Number(studentId))
      setStudentId('')
      setMessage('Student enrolled.')
      reload()
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : 'Unable to enroll the Student.')
    } finally {
      setSaving(false)
    }
  }

  async function dropStudent(enrollmentId: number) {
    setFormError('')
    setMessage('')
    try {
      await withdrawEnrollment(enrollmentId)
      setMessage('Enrollment withdrawn.')
      reload()
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : 'Unable to withdraw enrollment.')
    }
  }

  async function submitAttendance(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!course) return
    setSaving(true)
    setAttendanceFailure(null)
    try {
      await saveAttendance(course.id, attendanceDate, course.roster.map((entry) => ({
        studentId: entry.studentId,
        status: attendanceValues[entry.studentId] ?? 'present',
      })))
      setMessage('Attendance saved.')
    } catch (reason) {
      setAttendanceFailure({
        courseId: course.id,
        date: attendanceDate,
        message: reason instanceof Error ? reason.message : 'Unable to save attendance.',
      })
    } finally {
      setSaving(false)
    }
  }

  async function submitAssessment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!course) return
    setSaving(true)
    setFormError('')
    try {
      await createAssessment(course.id, {
        ...assessmentForm,
        maxScore: Number(assessmentForm.maxScore),
      })
      setAssessmentForm({ title: '', type: 'assignment', maxScore: '100', date: today() })
      setMessage('Assessment added to the gradebook.')
      reload()
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : 'Unable to create the assessment.')
    } finally {
      setSaving(false)
    }
  }

  async function submitGrades(event: React.FormEvent<HTMLFormElement>, assessmentId: number) {
    event.preventDefault()
    if (!course) return
    const draft = gradeDrafts[assessmentId] ?? {}
    const grades = course.roster.map((entry) => ({
      studentId: entry.studentId,
      score: Number(draft[entry.studentId]),
    }))
    if (grades.some((grade) => draft[grade.studentId] === undefined || draft[grade.studentId] === '')) {
      setFormError('Enter a score for every Student before saving this gradebook.')
      return
    }
    setSaving(true)
    setFormError('')
    try {
      await saveGrades(assessmentId, grades)
      setMessage('Grades saved.')
      reload()
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : 'Unable to save grades.')
    } finally {
      setSaving(false)
    }
  }

  async function removeCourse() {
    if (!course || !window.confirm(`Delete ${course.code}? Courses with history cannot be deleted.`)) return
    try {
      await deleteCourse(course.id)
      navigate(`${basePath}/courses`)
      setMessage('Course deleted.')
      reload()
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : 'Unable to delete the course.')
    }
  }

  async function downloadCourseReport() {
    if (!course) return
    setExporting(true)
    setExportError('')
    try {
      const attendanceRecords = await getAttendance(course.id)
      const rows: Array<Array<string | number | null>> = [
        ['Record type', 'Date', 'Student', 'Details', 'Score', 'Maximum score'],
        ...attendanceRecords.map((record) => [
          'Attendance',
          record.date,
          record.studentName,
          record.status,
          null,
          null,
        ]),
        ...course.assessments.flatMap((assessment) => assessment.grades.map((grade) => [
          assessment.type,
          assessment.date,
          grade.studentName,
          assessment.title,
          grade.score,
          assessment.maxScore,
        ])),
      ]
      const csv = rows.map((row) => row.map((value) => {
        let text = value === null ? '' : String(value)
        if (/^[=+\-@]/.test(text.trimStart())) text = `'${text}`
        return `"${text.replaceAll('"', '""')}"`
      }).join(',')).join('\r\n')
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
      const link = document.createElement('a')
      link.href = url
      link.download = `edutrack-course-${course.id}-report.csv`
      document.body.append(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 0)
    } catch (reason) {
      setExportError(reason instanceof Error ? reason.message : 'Unable to export this course report.')
    } finally {
      setExporting(false)
    }
  }

  if (!account) return null
  if (!hasCourseRoute) {
    if (listLoading) return <LoadingState label="Loading courses…" />
    if (listError) return <ErrorState message={listError} onRetry={reload} />
    return (
      <>
        <PageTitle
          title={isStudent ? 'My courses' : 'Courses'}
          description={isStudent ? 'Your enrolled courses, attendance and grades.' : 'Manage courses, student enrollment, attendance and gradebooks.'}
          action={canManage ? <button className="button button--primary" type="button" onClick={() => {
            setShowCourseForm((value) => !value)
            setEditingCourse(false)
            setCourseForm({ code: '', title: '', description: '', teacherId: String(ownStaffId ?? '') })
          }}>{showCourseForm ? 'Close form' : 'Add course'}</button> : undefined}
        />
        {message && <p className="inline-success" role="status">{message}</p>}
        {formError && <p className="inline-error" role="alert">{formError}</p>}
        {showCourseForm && (
          <form className="panel form-grid academic-form" onSubmit={submitCourse}>
            <h3 className="form-grid-title">{editingCourse ? 'Edit course' : 'Create a course'}</h3>
            <label>Course code<input required maxLength={40} value={courseForm.code} onChange={(event) => setCourseForm({ ...courseForm, code: event.target.value })} /></label>
            <label>Course title<input required maxLength={160} value={courseForm.title} onChange={(event) => setCourseForm({ ...courseForm, title: event.target.value })} /></label>
            {isSuperAdmin && (
              <label>Teacher
                <select required value={courseForm.teacherId} onChange={(event) => setCourseForm({ ...courseForm, teacherId: event.target.value })}>
                  <option value="">Select a teacher</option>
                  {staff.map((member) => <option value={member.id} key={member.id}>{member.firstName} {member.lastName} · {member.department}</option>)}
                </select>
              </label>
            )}
            <label className="form-grid-wide">Description<textarea maxLength={2000} value={courseForm.description} onChange={(event) => setCourseForm({ ...courseForm, description: event.target.value })} /></label>
            {formError && <p className="inline-error form-grid-wide" role="alert">{formError}</p>}
            <div className="form-grid-wide"><button className="button button--primary" type="submit" disabled={saving}>{saving ? 'Saving…' : editingCourse ? 'Save changes' : 'Create course'}</button></div>
          </form>
        )}
        {courses.length === 0 ? (
          <EmptyState title={isStudent ? 'No courses yet' : 'No courses created'} description={isStudent ? 'Your enrolled courses will appear here.' : 'Create a course to start managing enrollment and class activity.'} />
        ) : (
          <section className="course-grid" aria-label="Courses">
            {courses.map((item) => (
              <Link className="course-card" to={`${basePath}/courses/${item.id}`} key={item.id}>
                <span className="course-code">{item.code}</span>
                <h3>{item.title}</h3>
                <p>{item.description || 'Course details and student activity.'}</p>
                <span className="course-card-meta">{item.teacher.name} · {item.enrollmentCount} enrolled</span>
                <span className="course-card-link">Open course →</span>
              </Link>
            ))}
          </section>
        )}
      </>
    )
  }

  if (courseId === null || !Number.isInteger(courseId) || courseId < 1) {
    return <ErrorState message="The course URL is invalid." />
  }
  if (detailFailure?.id === courseId) return <ErrorState message={detailFailure.message} onRetry={reload} />
  if (loadedCourseId !== courseId || !course) return <LoadingState label="Loading course…" />
  const attendanceValues = attendanceDraft?.courseId === course.id && attendanceDraft.date === attendanceDate
    ? attendanceDraft.values
    : {}
  const currentAttendanceError = attendanceFailure?.courseId === course.id && attendanceFailure.date === attendanceDate
    ? attendanceFailure.message
    : ''

  return (
    <>
      <PageTitle
        eyebrow="COURSE"
        title={course.title}
        description={`${course.code} · Teacher: ${course.teacher.name}`}
        action={(
          <div className="button-row">
            <Link className="button button--secondary" to={`${basePath}/courses`}>All courses</Link>
            <button className="button button--secondary" type="button" disabled={exporting} onClick={() => { void downloadCourseReport() }}>
              {exporting ? 'Preparing CSV…' : 'Download report'}
            </button>
          </div>
        )}
      />
      {message && <p className="inline-success" role="status">{message}</p>}
      {formError && <p className="inline-error" role="alert">{formError}</p>}
      {exportError && <p className="inline-error" role="alert">{exportError}</p>}
      {canManage && (
        <div className="button-row course-actions">
          <button className="button button--secondary" type="button" onClick={() => {
            setShowCourseForm((value) => !value)
            setEditingCourse(true)
            setFormError('')
          }}>{showCourseForm ? 'Close editor' : 'Edit course'}</button>
          {isSuperAdmin && <button className="button button--quiet" type="button" onClick={() => { void removeCourse() }}>Delete course</button>}
        </div>
      )}
      {showCourseForm && canManage && (
        <form className="panel form-grid academic-form" onSubmit={submitCourse}>
          <h3 className="form-grid-title">Edit course</h3>
          <label>Course code<input required maxLength={40} value={courseForm.code} onChange={(event) => setCourseForm({ ...courseForm, code: event.target.value })} /></label>
          <label>Course title<input required maxLength={160} value={courseForm.title} onChange={(event) => setCourseForm({ ...courseForm, title: event.target.value })} /></label>
          {isSuperAdmin && (
            <label>Teacher
              <select required value={courseForm.teacherId} onChange={(event) => setCourseForm({ ...courseForm, teacherId: event.target.value })}>
                {staff.map((member) => <option value={member.id} key={member.id}>{member.firstName} {member.lastName}</option>)}
              </select>
            </label>
          )}
          <label className="form-grid-wide">Description<textarea maxLength={2000} value={courseForm.description} onChange={(event) => setCourseForm({ ...courseForm, description: event.target.value })} /></label>
          {formError && <p className="inline-error form-grid-wide" role="alert">{formError}</p>}
          <div className="form-grid-wide"><button className="button button--primary" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button></div>
        </form>
      )}

      <section className="content-grid">
        <article className="panel">
          <div className="panel-heading"><h3>Class roster</h3><span className="muted">{course.roster.length} students</span></div>
          {canManage && (
            <form className="inline-form" onSubmit={addStudent}>
              <label className="visually-hidden" htmlFor="enroll-student">Student to enroll</label>
              <select id="enroll-student" required value={studentId} onChange={(event) => setStudentId(event.target.value)}>
                <option value="">Select a Student</option>
                {availableStudents.map((student) => <option value={student.id} key={student.id}>{student.firstName} {student.lastName} · {student.email}</option>)}
              </select>
              <button className="button button--primary" type="submit" disabled={!studentId || saving}>Enroll</button>
            </form>
          )}
          {course.roster.length === 0 ? <EmptyState title="No Students enrolled" description="Enroll Students to start recording attendance and grades." /> : (
            <div className="table-scroll"><table className="data-table">
              <thead><tr><th>Student</th><th>Email</th>{canManage && <th>Action</th>}</tr></thead>
              <tbody>{course.roster.map((entry) => (
                <tr key={entry.id}>
                  <td>{entry.firstName} {entry.lastName}</td>
                  <td>{entry.email}</td>
                  {canManage && <td><button className="button button--quiet" type="button" onClick={() => { void dropStudent(entry.id) }}>Withdraw</button></td>}
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </article>
        <article className="panel">
          <div className="panel-heading"><h3>Attendance</h3></div>
          {canManage ? (
            <form onSubmit={submitAttendance}>
              <label className="date-field">Class date<input type="date" required value={attendanceDate} onChange={(event) => setAttendanceDate(event.target.value)} /></label>
              {currentAttendanceError && <p className="inline-error" role="alert">{currentAttendanceError}</p>}
              {course.roster.length === 0 ? <p className="muted">Enroll Students before recording attendance.</p> : (
                <>
                  <div className="attendance-list">{course.roster.map((entry) => (
                    <label className="attendance-row" key={entry.studentId}>
                      <span>{entry.firstName} {entry.lastName}</span>
                      <select value={attendanceValues[entry.studentId] ?? 'present'} onChange={(event) => setAttendanceDraft({
                        courseId: course.id,
                        date: attendanceDate,
                        values: {
                          ...attendanceValues,
                          [entry.studentId]: event.target.value as AttendanceStatus,
                        },
                      })}>
                        <option value="present">Present</option>
                        <option value="absent">Absent</option>
                      </select>
                    </label>
                  ))}</div>
                  <button className="button button--primary" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save attendance'}</button>
                </>
              )}
            </form>
          ) : (
            <AttendanceHistory courseId={course.id} />
          )}
        </article>
      </section>

      <section className="panel gradebook-panel">
        <div className="panel-heading"><h3>Gradebook</h3>{canManage && <span className="muted">Record assessment scores for the class</span>}</div>
        {canManage && (
          <form className="inline-form assessment-form" onSubmit={submitAssessment}>
            <label>Assessment name<input required minLength={2} maxLength={160} value={assessmentForm.title} onChange={(event) => setAssessmentForm({ ...assessmentForm, title: event.target.value })} /></label>
            <label>Type<select value={assessmentForm.type} onChange={(event) => setAssessmentForm({ ...assessmentForm, type: event.target.value as AssessmentType })}><option value="assignment">Assignment</option><option value="exam">Exam</option></select></label>
            <label>Max score<input type="number" min="0.01" step="0.01" required value={assessmentForm.maxScore} onChange={(event) => setAssessmentForm({ ...assessmentForm, maxScore: event.target.value })} /></label>
            <label>Date<input type="date" required value={assessmentForm.date} onChange={(event) => setAssessmentForm({ ...assessmentForm, date: event.target.value })} /></label>
            <button className="button button--primary" type="submit" disabled={saving || course.roster.length === 0}>Add assessment</button>
          </form>
        )}
        {course.assessments.length === 0 ? <EmptyState title="No assessments yet" description={canManage ? 'Create an assignment or exam to start entering grades.' : 'Your grades will appear here when an assessment is published.'} /> : (
          <div className="assessment-list">{course.assessments.map((assessment) => {
            const existing = new Map(assessment.grades.map((grade) => [grade.studentId, grade]))
            return (
              <article className="assessment-card" key={assessment.id}>
                <div className="assessment-heading">
                  <div><h4>{assessment.title}</h4><p>{assessment.type} · {assessment.date} · out of {assessment.maxScore}</p></div>
                </div>
                {canManage ? (
                  <form onSubmit={(event) => { void submitGrades(event, assessment.id) }}>
                    <div className="table-scroll"><table className="data-table grade-table">
                      <thead><tr><th>Student</th><th>Score / {assessment.maxScore}</th></tr></thead>
                      <tbody>{course.roster.map((entry) => {
                        const currentValue = gradeDrafts[assessment.id]?.[entry.studentId] ??
                          String(existing.get(entry.studentId)?.score ?? '')
                        return (
                          <tr key={entry.studentId}>
                            <td>{entry.firstName} {entry.lastName}</td>
                            <td><input aria-label={`${entry.firstName} ${entry.lastName} score for ${assessment.title}`} type="number" min="0" max={assessment.maxScore} step="0.01" value={currentValue} required onChange={(event) => setGradeDrafts({
                              ...gradeDrafts,
                              [assessment.id]: { ...gradeDrafts[assessment.id], [entry.studentId]: event.target.value },
                            })} /></td>
                          </tr>
                        )
                      })}</tbody>
                    </table></div>
                    <button className="button button--primary" type="submit" disabled={saving || course.roster.length === 0}>Save grades</button>
                  </form>
                ) : (
                  <p className="student-score">{existing.get(course.roster[0]?.studentId ?? -1)?.score ?? 'Not graded'} / {assessment.maxScore}</p>
                )}
              </article>
            )
          })}</div>
        )}
      </section>
    </>
  )
}

function AttendanceHistory({ courseId }: { courseId: number }) {
  const [result, setResult] = useState<{
    courseId: number
    records: Awaited<ReturnType<typeof getAttendance>>
  } | null>(null)
  const [failure, setFailure] = useState<{ courseId: number; message: string } | null>(null)
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    let active = true
    void getAttendance(courseId).then((result) => {
      if (active) {
        setResult({ courseId, records: result })
        setFailure(null)
      }
    }).catch((reason: unknown) => {
      if (active) setFailure({
        courseId,
        message: reason instanceof Error ? reason.message : 'Unable to load your attendance.',
      })
    })
    return () => { active = false }
  }, [courseId, retry])

  const records = result?.courseId === courseId ? result.records : []
  const loading = result?.courseId !== courseId && failure?.courseId !== courseId
  const error = failure?.courseId === courseId ? failure.message : ''
  return (
    <>
      {loading ? <LoadingState label="Loading attendance…" /> : error ? <ErrorState message={error} onRetry={() => setRetry((value) => value + 1)} /> : records.length === 0 ? (
        <EmptyState title="No attendance records" description="Your attendance history will appear here." />
      ) : records.map((record) => (
        <p className={`attendance-status attendance-status--${record.status}`} key={record.id}>{record.date}: {record.status}</p>
      ))}
    </>
  )
}

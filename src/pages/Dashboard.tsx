import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import { LoadingState, PageTitle, ErrorState } from '../components/PagePrimitives'
import { getOverview } from '../services/administration'
import type { Overview } from '../services/administration'
import { getStudentOverview } from '../services/academic'
import type { StudentOverview } from '../services/academic'

const STATUSES = ['active', 'pending', 'inactive', 'suspended'] as const

export default function DashboardPage() {
  const { account } = useAuth()
  const [overview, setOverview] = useState<Overview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const [studentOverview, setStudentOverview] = useState<StudentOverview | null>(null)
  const [studentLoading, setStudentLoading] = useState(true)
  const [studentError, setStudentError] = useState('')
  const [studentRetry, setStudentRetry] = useState(0)

  useEffect(() => {
    if (account?.accountType !== 'super_admin') return
    let active = true
    void getOverview().then((result) => {
      if (active) setOverview(result)
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : 'Unable to load the overview.')
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [account?.accountType, retry])

  useEffect(() => {
    if (account?.accountType !== 'student') return
    let active = true
    void getStudentOverview().then((result) => {
      if (active) setStudentOverview(result)
    }).catch((reason: unknown) => {
      if (active) setStudentError(reason instanceof Error ? reason.message : 'Unable to load your academic overview.')
    }).finally(() => {
      if (active) setStudentLoading(false)
    })
    return () => { active = false }
  }, [account?.accountType, studentRetry])

  if (!account) return null
  const home = account.accountType === 'super_admin'
    ? '/super-admin'
    : account.accountType === 'staff'
      ? '/staff'
      : '/student'

  if (account.accountType !== 'super_admin') {
    const isStudent = account.accountType === 'student'
    return (
      <>
        <PageTitle
          title={isStudent ? 'Student overview' : 'Staff overview'}
          description={isStudent ? 'Your enrolled courses and academic progress.' : 'Manage Students, courses, attendance and gradebooks for your classes.'}
          action={<Link className="button button--secondary" to={`${home}/courses`}>{isStudent ? 'View my courses' : 'Manage courses'}</Link>}
        />
        {isStudent ? studentLoading ? <LoadingState label="Loading your academic overview…" /> : studentError ? (
          <ErrorState message={studentError} onRetry={() => {
            setStudentLoading(true)
            setStudentError('')
            setStudentRetry((value) => value + 1)
          }} />
        ) : studentOverview ? (
          <>
            <section className="metric-grid" aria-label="My academic overview">
              <article className="metric-card"><span>Enrolled courses</span><strong>{studentOverview.courseCount}</strong></article>
              <article className="metric-card"><span>Attendance rate</span><strong>{studentOverview.attendanceRate === null ? 'No data' : `${studentOverview.attendanceRate}%`}</strong></article>
              <article className="metric-card"><span>Grade average</span><strong>{studentOverview.gradeAverage === null ? 'No data' : `${studentOverview.gradeAverage}%`}</strong></article>
            </section>
            <section className="quick-links">
              <h3>My courses</h3>
              {studentOverview.courses.length === 0 ? <span className="muted">No courses enrolled yet.</span> : studentOverview.courses.map((course) => (
                <Link to={`${home}/courses/${course.id}`} key={course.id}>{course.code} · {course.title}</Link>
              ))}
              <Link to={`${home}/profile`}>View my profile</Link>
            </section>
          </>
        ) : null : (
          <section className="welcome-panel">
            <p className="eyebrow">SIGNED IN AS STAFF</p>
            <h2>{account.email}</h2>
            <p>Open your assigned classes to manage rosters, attendance and gradebooks.</p>
          </section>
        )}
      </>
    )
  }

  return (
    <>
      <PageTitle title="Overview" description="Current account and profile counts from the backend." />
      {loading ? <LoadingState label="Loading school overview…" /> : error ? (
        <ErrorState message={error} onRetry={() => { setLoading(true); setError(''); setRetry((value) => value + 1) }} />
      ) : overview ? (
        <>
          <section className="metric-grid" aria-label="School overview">
            <article className="metric-card"><span>Student profiles</span><strong>{overview.students}</strong></article>
            <article className="metric-card"><span>Staff profiles</span><strong>{overview.staff}</strong></article>
            {STATUSES.map((status) => (
              <article className="metric-card" key={status}>
                <span>{status} accounts</span>
                <strong>{overview.accountsByStatus[status] ?? 0}</strong>
              </article>
            ))}
          </section>
          <section className="quick-links">
            <h3>Administration</h3>
            <Link to={`${home}/students`}>Manage Students</Link>
            <Link to={`${home}/staff`}>Manage Staff</Link>
            <Link to={`${home}/courses`}>Manage courses</Link>
            <Link to={`${home}/reports`}>Academic reports</Link>
            <Link to={`${home}/invitations`}>Review invitations</Link>
            <Link to={`${home}/audit`}>View audit history</Link>
          </section>
        </>
      ) : <ErrorState message="The server returned no overview." onRetry={() => { setLoading(true); setRetry((value) => value + 1) }} />}
    </>
  )
}

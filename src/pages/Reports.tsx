import { useEffect, useState } from 'react'
import { EmptyState, ErrorState, LoadingState, PageTitle } from '../components/PagePrimitives'
import { getAcademicReport } from '../services/academic'
import type { AcademicReportRow } from '../services/academic'
import '../Academic.css'

function csvCell(value: string | number | null): string {
  let text = value === null ? '' : String(value)
  if (/^[=+\-@]/.test(text.trimStart())) text = `'${text}`
  return `"${text.replaceAll('"', '""')}"`
}

export default function ReportsPage() {
  const [rows, setRows] = useState<AcademicReportRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    let active = true
    void getAcademicReport().then((result) => {
      if (active) setRows(result)
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : 'Unable to load academic reports.')
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [retry])

  function downloadCsv() {
    const header = ['Course code', 'Course title', 'Teacher', 'Enrolled students', 'Attendance rate (%)', 'Average grade (%)']
    const data = rows.map((row) => [
      row.code,
      row.title,
      row.teacherName,
      row.enrollmentCount,
      row.attendanceRate,
      row.gradeAverage,
    ])
    const csv = [header, ...data].map((line) => line.map(csvCell).join(',')).join('\r\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'edutrack-academic-report.csv'
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <>
      <PageTitle
        title="Academic reports"
        description="Course enrollment, attendance and grade averages. Download a CSV for further review."
        action={!loading && !error && rows.length > 0
          ? <button className="button button--primary" type="button" onClick={downloadCsv}>Download CSV</button>
          : undefined}
      />
      {loading ? <LoadingState label="Generating academic report…" /> : error ? (
        <ErrorState message={error} onRetry={() => {
          setLoading(true)
          setError('')
          setRetry((value) => value + 1)
        }} />
      ) : rows.length === 0 ? (
        <EmptyState title="No course data to report" description="Create courses and record student activity to generate a report." />
      ) : (
        <section className="panel">
          <div className="table-scroll"><table className="data-table">
            <thead><tr><th>Course</th><th>Teacher</th><th>Enrollment</th><th>Attendance</th><th>Grade average</th></tr></thead>
            <tbody>{rows.map((row) => (
              <tr key={row.courseId}>
                <td><strong>{row.code}</strong><span className="table-note">{row.title}</span></td>
                <td>{row.teacherName}</td>
                <td>{row.enrollmentCount}</td>
                <td>{row.attendanceRate === null ? 'No data' : `${row.attendanceRate}%`}</td>
                <td>{row.gradeAverage === null ? 'No data' : `${row.gradeAverage}%`}</td>
              </tr>
            ))}</tbody>
          </table></div>
        </section>
      )}
    </>
  )
}

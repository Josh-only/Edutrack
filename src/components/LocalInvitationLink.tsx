import { useState } from 'react'

export default function LocalInvitationLink({ url }: { url: string }) {
  const [copyMessage, setCopyMessage] = useState('')

  async function copyLink() {
    setCopyMessage('')
    try {
      await navigator.clipboard.writeText(url)
      setCopyMessage('Invitation link copied.')
    } catch {
      setCopyMessage('Copy was unavailable. Select and copy the link below.')
    }
  }

  return (
    <aside className="callout local-invitation-link" aria-label="Local invitation link">
      <strong>Local-only invitation link</strong>
      <p>This link lets its holder set the account password and expires in 48 hours. Treat it as a secret; use it only for local testing.</p>
      <div className="button-row">
        <a className="text-link" href={url} target="_blank" rel="noreferrer">Open setup link</a>
        <button className="button button--secondary" type="button" onClick={() => void copyLink()}>Copy link</button>
      </div>
      <p><code>{url}</code></p>
      {copyMessage && <p role="status">{copyMessage}</p>}
    </aside>
  )
}

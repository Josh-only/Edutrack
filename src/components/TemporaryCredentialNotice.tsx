import { useState } from 'react'
import type { TemporaryCredential } from '../services/api-models'

export default function TemporaryCredentialNotice({
  credential,
  email,
  onDismiss,
}: {
  credential: TemporaryCredential
  email: string
  onDismiss: () => void
}) {
  const [copyMessage, setCopyMessage] = useState('')

  async function copyPassword() {
    setCopyMessage('')
    try {
      await navigator.clipboard.writeText(credential.temporaryPassword)
      setCopyMessage('Temporary password copied.')
    } catch {
      setCopyMessage('Copy was unavailable. Select and copy the password above.')
    }
  }

  return (
    <aside className="callout" aria-label="Temporary account password" role="status">
      <strong>Temporary password for {email}</strong>
      <p>Share it privately. It expires {new Date(credential.expiresAt).toLocaleString()} if unused. After the first sign-in it remains valid until the user changes it in Profile. This password will not be shown again.</p>
      <label>
        Temporary password
        <input aria-label="Temporary password" readOnly value={credential.temporaryPassword} onFocus={(event) => event.currentTarget.select()} />
      </label>
      <div className="button-row">
        <button className="button button--secondary" type="button" onClick={() => void copyPassword()}>Copy password</button>
        <button className="button button--quiet" type="button" onClick={onDismiss}>Dismiss</button>
      </div>
      {copyMessage && <p>{copyMessage}</p>}
    </aside>
  )
}

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { AuthContext } from '../auth/context'
import type { AuthContextValue } from '../auth/context'
import { RequireAccount } from './ProtectedRoutes'
import type { AccountIdentity } from '../services/api-models'

afterEach(cleanup)

const staffAccount: AccountIdentity = {
  id: 2,
  email: 'staff@example.test',
  accountType: 'staff',
  status: 'active',
}

function renderProtectedRoute(account: AccountIdentity | null, initialPath = '/super-admin/audit') {
  const authValue: AuthContextValue = {
    account,
    status: account ? 'authenticated' : 'unauthenticated',
    notice: '',
    signIn: async () => {
      throw new Error('Sign-in is not part of this route test.')
    },
    signOut: () => {},
    refreshAccount: async () => {
      if (!account) throw new Error('No authenticated account is available.')
      return account
    },
  }

  return render(
    <AuthContext.Provider value={authValue}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route element={<RequireAccount roles={['super_admin']} />}>
            <Route path="/super-admin/audit" element={<p>Audit page</p>} />
          </Route>
          <Route path="/login" element={<LoginDestination />} />
          <Route path="/staff/dashboard" element={<p>Staff dashboard</p>} />
          <Route path="*" element={<p>Not found</p>} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  )
}

function LoginDestination() {
  const location = useLocation()
  return (
    <>
      <p>Login page</p>
      <output data-testid="login-state">{JSON.stringify(location.state)}</output>
    </>
  )
}

describe('RequireAccount', () => {
  it('sends unauthenticated visitors to login and preserves their destination', () => {
    renderProtectedRoute(null)

    expect(screen.getByText('Login page')).toBeTruthy()
    expect(screen.getByTestId('login-state').textContent).toBe('{"from":"/super-admin/audit"}')
  })

  it('sends an authenticated user without the required role to their own dashboard', () => {
    renderProtectedRoute(staffAccount)

    expect(screen.getByText('Staff dashboard')).toBeTruthy()
  })

  it('renders the protected page for an allowed role', () => {
    renderProtectedRoute({ ...staffAccount, accountType: 'super_admin' })

    expect(screen.getByText('Audit page')).toBeTruthy()
  })
})

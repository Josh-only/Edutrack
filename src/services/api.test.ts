import { afterEach, describe, expect, it, vi } from 'vitest'
import { API_URL, apiRequest, parseLocalInvitationUrl, SESSION_EXPIRED_EVENT } from './api'

afterEach(() => {
  vi.unstubAllGlobals()
  sessionStorage.clear()
})

describe('apiRequest', () => {
  it('sends the stored bearer token and signals an expired authenticated session', async () => {
    sessionStorage.setItem('accessToken', 'test-token')
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ message: 'Session expired' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const dispatchEvent = vi.spyOn(window, 'dispatchEvent')

    await expect(apiRequest('/users/me')).rejects.toMatchObject({
      name: 'ApiError',
      message: 'Session expired',
      status: 401,
    })

    const request = fetchMock.mock.calls[0]
    expect(request?.[0]).toBe(`${API_URL}/users/me`)
    expect(new Headers(request?.[1]?.headers).get('Authorization')).toBe('Bearer test-token')
    expect(dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: SESSION_EXPIRED_EVENT }),
    )
  })
})

describe('parseLocalInvitationUrl', () => {
  it('accepts only local invitation setup URLs', () => {
    expect(parseLocalInvitationUrl(
      'http://localhost:5173/accept-invitation?token=test-token',
      'Invalid URL',
    )).toBe('http://localhost:5173/accept-invitation?token=test-token')
    expect(parseLocalInvitationUrl(undefined, 'Invalid URL')).toBeUndefined()
    expect(() => parseLocalInvitationUrl('https://example.test/?token=secret', 'Invalid URL')).toThrow('Invalid URL')
  })
})

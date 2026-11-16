export type AccountType = 'super_admin' | 'staff' | 'student'
export type AccountStatus = 'pending' | 'active' | 'inactive' | 'suspended'

export interface AccountIdentity {
  id: number
  email: string
  accountType: AccountType
  status: AccountStatus
}

export interface TemporaryCredential {
  temporaryPassword: string
  expiresAt: string
}

export interface Student {
  id: number
  userId: number | null
  firstName: string
  lastName: string
  email: string
  status: AccountStatus | null
}

export interface StudentCreation extends Student {
  credential: TemporaryCredential
}

export interface StaffMember {
  id: number
  userId: number
  email: string
  firstName: string
  lastName: string
  phoneNumber: string
  department: string
  designation: string
  status: AccountStatus
}

export interface StaffCreation extends StaffMember {
  credential: TemporaryCredential
}

export interface TemporaryPasswordIssue extends TemporaryCredential {
  email: string
  accountType: AccountType
}

export type InvitationStatus = 'pending' | 'accepted' | 'expired' | 'revoked'

export interface Invitation {
  id: number
  email: string
  accountType: AccountType
  purpose: string
  createdAt: string
  expiresAt: string
  acceptedAt: string | null
  revokedAt: string | null
  status: InvitationStatus
  creator: { id: number; email: string } | null
}

export interface InvitationPage {
  items: Invitation[]
  total: number
  page: number
  limit: number
  totalPages: number
}

export interface AuditEvent {
  id: number
  actorUserId: number | null
  action: string
  targetType: string
  targetId: number | null
  reason: string | null
  changes: Record<string, unknown> | null
  occurredAt: string
}

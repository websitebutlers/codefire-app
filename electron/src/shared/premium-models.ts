export interface PremiumUser {
  id: string
  email: string
  displayName: string
  avatarUrl: string | null
}

export interface Team {
  id: string
  name: string
  slug: string
  ownerId: string
  plan: 'starter' | 'agency'
  seatLimit: number
  projectLimit: number | null
  createdAt: string
}

export interface TeamMember {
  teamId: string
  userId: string
  role: 'owner' | 'admin' | 'member'
  joinedAt: string
  user?: PremiumUser
}

export interface TeamInvite {
  id: string
  teamId: string
  email: string
  role: 'admin' | 'member'
  status: 'pending' | 'accepted' | 'expired'
  createdAt: string
  expiresAt: string
}

export interface TeamGrant {
  id: string
  teamId: string
  grantType: 'oss_project' | 'oss_contributor' | 'custom'
  planTier: 'starter' | 'agency'
  seatLimit: number | null
  projectLimit: number | null
  repoUrl: string | null
  note: string | null
  expiresAt: string | null
  createdAt: string
}

export interface SyncState {
  entityType: 'task' | 'note' | 'taskNote' | 'project'
  localId: string
  remoteId: string | null
  projectId: string | null
  lastSyncedAt: string | null
  dirty: boolean
}

export interface Notification {
  id: string
  userId: string
  projectId: string | null
  type: 'mention' | 'assignment' | 'review_request' | 'review_resolved'
  title: string
  body: string | null
  entityType: string
  entityId: string
  isRead: boolean
  createdAt: string
}

export interface ActivityEvent {
  id: string
  projectId: string
  userId: string
  eventType: string
  entityType: string
  entityId: string
  metadata: Record<string, unknown>
  createdAt: string
  user?: PremiumUser
}

export interface SessionSummary {
  id: string
  projectId: string
  userId: string
  sessionSlug: string | null
  model: string | null
  gitBranch: string | null
  summary: string
  filesChanged: string[]
  durationMins: number | null
  startedAt: string | null
  endedAt: string | null
  sharedAt: string
  user?: PremiumUser
}

export interface ProjectDoc {
  id: string
  projectId: string
  title: string
  content: string
  sortOrder: number
  createdBy: string
  lastEditedBy: string | null
  createdAt: string
  updatedAt: string
  createdByUser?: PremiumUser
  lastEditedByUser?: PremiumUser
}

export interface ReviewRequest {
  id: string
  projectId: string
  taskId: string
  requestedBy: string
  assignedTo: string
  status: 'pending' | 'approved' | 'changes_requested' | 'dismissed'
  comment: string | null
  createdAt: string
  resolvedAt: string | null
  requestedByUser?: PremiumUser
  assignedToUser?: PremiumUser
}

export interface PresenceState {
  userId: string
  displayName: string
  avatarUrl: string | null
  activeFile: string | null
  gitBranch: string | null
  onlineAt: string
  status: 'active' | 'idle' | 'offline'
}

export type PremiumStatus = {
  enabled: boolean
  authenticated: boolean
  user: PremiumUser | null
  team: Team | null
  grant: TeamGrant | null
  subscriptionActive: boolean
  syncEnabled: boolean
}

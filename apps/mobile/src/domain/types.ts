export type Provider = 'kakao' | 'google';
export type Role = 'admin' | 'user';
export type Gender = 'male' | 'female' | 'other';
export type DepartureOption = 'main' | 'late' | 'car' | 'other';
export type SourceFields = Pick<EventItem, 'title' | 'category' | 'description' | 'location' | 'target' | 'startsAt' | 'endsAt' | 'allDay'>;
export interface EventSource {
  kind: 'manual' | 'bulletin'; syncMode: 'automatic' | 'manual'; lastSyncedAt: string | null;
  missing: boolean; pending: boolean; latest: SourceFields | null; url: string | null; warnings: string[];
}
export interface SyncResult {
  id: string; status: 'success' | 'failed' | 'skipped'; trigger: 'scheduled' | 'manual' | 'cli';
  startedAt: string; finishedAt: string | null; created: number; updated: number; unchanged: number;
  pending: number; missing: number; errorCode: string | null;
}
export interface EventSyncStatus { schedule: string; lastRun: SyncResult | null; lastSuccessAt: string | null }

export interface AppUser {
  id: string;
  name: string;
  role: Role;
  isMemberVerified: boolean;
  verificationRequestedAt?: string | null;
  memberVerificationRevokedAt?: string | null;
  status: 'active' | 'merged' | 'deleting';
  version: number;
  peerGroup?: string | null;
  gender?: Gender | null;
  phoneNumber?: string | null;
}

export interface EventItem {
  id: string;
  title: string;
  category: string;
  description: string;
  memberDetails?: string;
  location: string;
  target: string;
  startsAt: string | null;
  endsAt: string | null;
  allDay: boolean;
  visibility: 'public' | 'members';
  requiresMemberVerification: boolean;
  publicationStatus: 'draft' | 'published' | 'hidden';
  lifecycleStatus: 'active' | 'cancelled' | 'completed';
  registrationEnabled: boolean;
  registrationOpensAt: string | null;
  registrationClosesAt: string | null;
  cancellationClosesAt: string | null;
  sourceUrl?: string | null;
  source?: EventSource;
  sourcePromotionId?: string | null;
  sourceBulletinId?: string | null;
  version: number;
  updatedAt?: string;
  registrationStatus?: 'not_open' | 'open' | 'closed' | 'disabled' | 'cancelled';
  isDemo?: boolean;
  retreatSlug?: string;
}

export interface Registration {
  id: string;
  eventId: string;
  userId?: string;
  participantName: string;
  status: 'confirmed' | 'cancelled';
  attendanceStatus: 'unmarked' | 'present' | 'absent';
  confirmationCode: string;
  version: number;
  confirmedAt?: string | null;
  cancelledAt?: string | null;
  checkedAt?: string | null;
  checkedBy?: string | null;
  event?: EventItem;
  retreatSlug?: string;
  answers?: RetreatAnswers;
}

export interface RetreatAnswers {
  peerGroup: string; gender: Gender; phoneNumber: string;
  departureOption: DepartureOption; departureNote: string | null; prayerRequest: string | null;
}
export interface RetreatRegistrationInput extends RetreatAnswers {
  participantName: string; expectedEventVersion: number; expectedRegistrationVersion: number;
}
export interface RetreatRegistration extends Registration {
  retreatSlug: string; answers: RetreatAnswers;
}
export interface RetreatDetail {
  slug: string; title: string; shortName: string; theme: string;
  scripture: { reference: string; excerpt: string };
  description: string; startsAt: string; endsAt: string;
  location: { name: string; address: string }; isDemo: boolean;
  schedule: { date: string; label: string; items: { time: string; title: string; description?: string }[] }[];
  departureOptions: { id: DepartureOption; label: string; description: string; departureAt: string | null; requiresNote: boolean }[];
  registrationPath: string; event: EventItem;
}

export interface LoginMethod {
  id: string;
  provider: string;
  label?: string;
  accountLabel?: string;
  canUnlink: boolean;
}

export interface MergePreview {
  requestId: string;
  expiresAt: string;
  targetUser: AppUser;
  sourceUser: AppUser;
  methods: LoginMethod[];
  registrationCount: number;
  duplicateCount: number;
  isMemberVerified: boolean;
  conflicts: { eventId?: string; title?: string; code: string; message: string }[];
  registrations?: Registration[];
  previewToken?: string;
  status?: 'prepared' | 'completed' | 'cancelled' | 'expired';
  requiresAdminApproval?: boolean;
}

export type EventInput = Omit<EventItem, 'id' | 'version' | 'updatedAt' | 'registrationStatus' | 'source'> & {
  id?: string;
  expectedVersion?: number;
};

export interface EventFilters {
  query?: string;
  category?: string;
  period?: 'upcoming' | 'past' | 'all';
}

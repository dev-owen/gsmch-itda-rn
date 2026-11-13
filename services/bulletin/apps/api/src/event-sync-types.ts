export const BULLETIN_SOURCE_ORIGIN = 'https://gsmch-youth-bulletin.gsmch-youth-dev.workers.dev';
export const BULLETIN_SYNC_CRON = '0 0 * * MON'; // Mondays 09:00 Asia/Seoul.

export type SourceFields = {
  title: string; category: 'event' | 'recruitment'; description: string;
  location: string; target: string; startsAt: string | null; endsAt: string | null; allDay: boolean;
};
export type SourceEvent = {
  sourceId: string; identityKey: string; bulletinId: string; bulletinDate: string;
  sourceUrl: string; fields: SourceFields; reviewRequired: boolean; warnings: string[];
};
export type SourceSnapshot = { sourceSystem: string; bulletinId: string; bulletinDate: string; events: SourceEvent[]; requestedAt?: string };
export type SyncTrigger = 'scheduled' | 'manual' | 'cli';
export type SyncResult = {
  id: string; status: 'success' | 'failed' | 'skipped'; trigger: SyncTrigger;
  startedAt: string; finishedAt: string | null; created: number; updated: number; unchanged: number;
  pending: number; missing: number; errorCode: string | null;
};

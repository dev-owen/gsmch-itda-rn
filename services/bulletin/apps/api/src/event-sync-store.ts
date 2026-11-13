import type { Pool, PoolClient } from 'pg';
import { transaction } from './db.js';
import { editableEvent, ensureActiveMember, eventInput, EventError, iso, lockMembers, normalizedSourceFields,
  sameSourceFields, sourceFieldsFromEvent, type Actor, type EventRow } from './event-domain.js';
import type { SourceEvent, SourceFields, SourceSnapshot, SyncResult, SyncTrigger } from './event-sync-types.js';

const SYNC_LOCK = 87361831;
type RunRow = { id: string; status: SyncResult['status']; trigger: SyncTrigger; started_at: Date | string;
  finished_at: Date | string | null; created: number; updated: number; unchanged: number; pending: number; missing: number; error_code: string | null };
function runView(row: RunRow): SyncResult {
  return { id: row.id, status: row.status, trigger: row.trigger, startedAt: iso(row.started_at)!, finishedAt: iso(row.finished_at),
    created: row.created, updated: row.updated, unchanged: row.unchanged, pending: row.pending, missing: row.missing, errorCode: row.error_code };
}
function sourceValues(fields: SourceFields) {
  return [fields.title, fields.category, fields.description, fields.location, fields.target, fields.startsAt, fields.endsAt, fields.allDay];
}
function registrationSensitiveChange(current: EventRow, fields: SourceFields) {
  return iso(current.starts_at) !== iso(fields.startsAt) || iso(current.ends_at) !== iso(fields.endsAt)
    || current.all_day !== fields.allDay || current.location !== fields.location;
}
function validCombinedSettings(current: EventRow, fields: SourceFields) {
  return eventInput.safeParse({ ...editableEvent(current), ...fields }).success;
}
async function insertRun(client: Pick<PoolClient, 'query'>, result: Omit<SyncResult, 'id'>, source?: SourceSnapshot) {
  const row = (await client.query<RunRow>(`INSERT INTO event_sync_runs
    (status,trigger,started_at,finished_at,created,updated,unchanged,pending,missing,error_code,source_system,source_bulletin_date)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
  [result.status, result.trigger, result.startedAt, result.finishedAt, result.created, result.updated,
    result.unchanged, result.pending, result.missing, result.errorCode, source?.sourceSystem || null, source?.bulletinDate || null])).rows[0];
  return runView(row);
}

function validateSnapshot(snapshot: SourceSnapshot): SourceSnapshot {
  if (!snapshot.sourceSystem || snapshot.sourceSystem.length > 1000 || !snapshot.bulletinId || !/^\d{4}-\d{2}-\d{2}$/.test(snapshot.bulletinDate)) {
    throw new EventError(422, 'INVALID_SOURCE_SNAPSHOT', '원문 정보를 확인할 수 없습니다.');
  }
  const seen = new Set<string>();
  const events = snapshot.events.map((source) => {
    if (!source.sourceId || source.sourceId.length > 1000 || !source.identityKey || source.identityKey.length > 1000 || seen.has(source.sourceId)) {
      throw new EventError(422, 'INVALID_SOURCE_SNAPSHOT', '원문 행사 식별자가 올바르지 않습니다.');
    }
    seen.add(source.sourceId);
    const parsed = eventInput.parse(source.fields);
    const url = new URL(source.sourceUrl);
    if (!['https:', 'http:'].includes(url.protocol)) throw new EventError(422, 'INVALID_SOURCE_SNAPSHOT', '원문 주소가 올바르지 않습니다.');
    return { ...source, fields: normalizedSourceFields(parsed), warnings: [...new Set(source.warnings)].slice(0, 30) };
  });
  return { ...snapshot, events };
}

/** Only a completely fetched and validated bulletin reaches this transaction. No network I/O occurs while locked. */
export async function applyBulletinSnapshot(pool: Pool, rawSnapshot: SourceSnapshot, trigger: SyncTrigger): Promise<SyncResult> {
  const snapshot = validateSnapshot(rawSnapshot);
  const startedAt = snapshot.requestedAt ? new Date(snapshot.requestedAt).toISOString() : new Date().toISOString();
  return transaction(pool, async (client) => {
    const locked = (await client.query<{ locked: boolean }>('SELECT pg_try_advisory_xact_lock($1) AS locked', [SYNC_LOCK])).rows[0].locked;
    if (!locked) return insertRun(client, { status: 'skipped', trigger, startedAt, finishedAt: new Date().toISOString(),
      created: 0, updated: 0, unchanged: 0, pending: 0, missing: 0, errorCode: 'SYNC_IN_PROGRESS' }, snapshot);
    const previous = (await client.query<{ started_at: Date | string; source_bulletin_date: string }>(`SELECT started_at,source_bulletin_date FROM event_sync_runs
      WHERE status='success' AND source_system=$1 ORDER BY started_at DESC,id DESC LIMIT 1`, [snapshot.sourceSystem])).rows[0];
    if (previous && (new Date(previous.started_at).getTime() > Date.parse(startedAt) || previous.source_bulletin_date > snapshot.bulletinDate)) {
      return insertRun(client, { status: 'skipped', trigger, startedAt, finishedAt: new Date().toISOString(), created: 0,
        updated: 0, unchanged: 0, pending: 0, missing: 0, errorCode: 'STALE_SOURCE_RESPONSE' }, snapshot);
    }
    const count = { created: 0, updated: 0, unchanged: 0, pending: 0, missing: 0 };
    const seenEvents = new Set<string>();
    for (const source of snapshot.events) {
      let current = (await client.query<EventRow>(`SELECT e.* FROM events e JOIN event_source_aliases a ON a.event_id=e.id
        WHERE a.source_system=$1 AND a.source_id=$2 FOR UPDATE OF e`, [snapshot.sourceSystem, source.sourceId])).rows[0];
      // Unknown or ambiguous dates never match across weeks solely by a repeated title.
      if (!current && !source.reviewRequired && source.fields.startsAt) {
        current = (await client.query<EventRow>(`SELECT * FROM events WHERE source_system=$1 AND source_identity_key=$2 FOR UPDATE`,
          [snapshot.sourceSystem, source.identityKey])).rows[0];
      }
      if (!current) {
        current = (await client.query<EventRow>(`INSERT INTO events
          (title,category,description,location,target,starts_at,ends_at,all_day,publication_status,
           source_system,source_id,source_identity_key,source_snapshot_identity_key,source_bulletin_id,source_bulletin_date,
           source_url,sync_mode,source_snapshot,source_review_required,source_warnings,source_pending,source_synced_at,source_sync_error)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'automatic',$17::jsonb,$18,$19::jsonb,$18,now(),$20) RETURNING *`,
        [...sourceValues(source.fields), source.reviewRequired ? 'draft' : 'published', snapshot.sourceSystem, source.sourceId,
          source.reviewRequired || !source.fields.startsAt ? null : source.identityKey, source.identityKey, source.bulletinId, source.bulletinDate,
          source.sourceUrl, JSON.stringify(source.fields), source.reviewRequired, JSON.stringify(source.warnings),
          source.reviewRequired ? 'SOURCE_REVIEW_REQUIRED' : null])).rows[0];
        count.created++;
        if (source.reviewRequired) count.pending++;
      } else {
        const collision = !source.reviewRequired && !!source.fields.startsAt && (await client.query('SELECT 1 FROM events WHERE source_system=$1 AND source_identity_key=$2 AND id<>$3',
          [snapshot.sourceSystem, source.identityKey, current.id])).rowCount! > 0;
        const changedFields = !sameSourceFields(sourceFieldsFromEvent(current), source.fields);
        let reason: string | null = source.reviewRequired ? 'SOURCE_REVIEW_REQUIRED' : collision ? 'SOURCE_IDENTITY_CONFLICT' : null;
        if (!reason && changedFields && current.sync_mode === 'manual') reason = 'MANUAL_CHANGES';
        if (!reason && changedFields && registrationSensitiveChange(current, source.fields)) {
          const active = await client.query("SELECT 1 FROM registrations WHERE event_id=$1 AND status='confirmed' LIMIT 1", [current.id]);
          if (active.rowCount) reason = 'ACTIVE_REGISTRATIONS_REQUIRE_REVIEW';
        }
        if (!reason && changedFields && !validCombinedSettings(current, source.fields)) reason = 'SOURCE_CONFLICTS_WITH_REGISTRATION_SETTINGS';
        const apply = current.sync_mode !== 'manual' && !reason;
        const nextFields = apply ? source.fields : sourceFieldsFromEvent(current);
        const pending = !sameSourceFields(nextFields, source.fields) || !!reason;
        const identity = !source.reviewRequired && source.fields.startsAt && !collision ? source.identityKey : current.source_identity_key || null;
        const metadataChanged = current.source_id !== source.sourceId || current.source_bulletin_id !== source.bulletinId
          || current.source_bulletin_date !== source.bulletinDate || current.source_url !== source.sourceUrl
          || !current.source_snapshot || !sameSourceFields(current.source_snapshot, source.fields)
          || current.source_snapshot_identity_key !== source.identityKey || current.source_identity_key !== identity
          || !!current.source_review_required !== source.reviewRequired || JSON.stringify(current.source_warnings || []) !== JSON.stringify(source.warnings)
          || !!current.source_pending !== pending || !!current.source_missing || (current.source_sync_error || null) !== reason;
        const changed = (apply && changedFields) || metadataChanged;
        current = (await client.query<EventRow>(`UPDATE events SET title=$2,category=$3,description=$4,location=$5,target=$6,
          starts_at=$7,ends_at=$8,all_day=$9,source_system=$10,source_id=$11,source_identity_key=$12,
          source_snapshot_identity_key=$13,source_bulletin_id=$14,source_bulletin_date=$15,source_url=$16,
          source_snapshot=$17::jsonb,source_review_required=$18,source_warnings=$19::jsonb,source_pending=$20,
          source_missing=false,source_synced_at=now(),source_sync_error=$21,version=version+$22,
          updated_at=CASE WHEN $22=1 THEN now() ELSE updated_at END WHERE id=$1 RETURNING *`,
        [current.id, ...sourceValues(nextFields), snapshot.sourceSystem, source.sourceId, identity, source.identityKey,
          source.bulletinId, source.bulletinDate, source.sourceUrl, JSON.stringify(source.fields), source.reviewRequired,
          JSON.stringify(source.warnings), pending, reason, changed ? 1 : 0])).rows[0];
        if (changed) count.updated++; else count.unchanged++;
        if (pending) count.pending++;
      }
      seenEvents.add(current.id);
      await client.query(`INSERT INTO event_source_aliases(source_system,source_id,event_id) VALUES ($1,$2,$3)
        ON CONFLICT (source_system,source_id) DO UPDATE SET last_seen_at=now()`, [snapshot.sourceSystem, source.sourceId, current.id]);
    }
    // Source disappearance is a review signal; it never cancels an event or destroys registrations.
    await client.query(`UPDATE events SET source_missing=true,source_synced_at=now(),
      version=version+CASE WHEN source_missing THEN 0 ELSE 1 END,
      updated_at=CASE WHEN source_missing THEN updated_at ELSE now() END
      WHERE source_system=$1 AND NOT (id=ANY($2::uuid[]))`, [snapshot.sourceSystem, [...seenEvents]]);
    count.missing = Number((await client.query<{ count: string }>('SELECT count(*) FROM events WHERE source_system=$1 AND source_missing', [snapshot.sourceSystem])).rows[0].count);
    return insertRun(client, { status: 'success', trigger, startedAt, finishedAt: new Date().toISOString(), ...count, errorCode: null }, snapshot);
  });
}

export async function recordSyncFailure(pool: Pool, trigger: SyncTrigger, errorCode: string): Promise<SyncResult> {
  const at = new Date().toISOString();
  return insertRun(pool, { status: 'failed', trigger, startedAt: at, finishedAt: at, created: 0, updated: 0, unchanged: 0,
    pending: 0, missing: 0, errorCode: /^[A-Z][A-Z0-9_]{0,79}$/.test(errorCode) ? errorCode : 'SYNC_FAILED' });
}
export async function getSyncStatus(pool: Pool): Promise<{ lastRun: SyncResult | null; lastSuccessAt: string | null }> {
  const [latest, success] = await Promise.all([
    pool.query<RunRow>('SELECT * FROM event_sync_runs ORDER BY started_at DESC,id DESC LIMIT 1'),
    pool.query<{ last_success_at: Date | string | null }>("SELECT max(finished_at) AS last_success_at FROM event_sync_runs WHERE status='success'"),
  ]);
  return { lastRun: latest.rows[0] ? runView(latest.rows[0]) : null, lastSuccessAt: iso(success.rows[0].last_success_at) };
}

export async function changeSourceSyncMode(pool: Pool, actor: Actor, id: string, mode: 'manual' | 'automatic', expectedVersion: number): Promise<EventRow> {
  return transaction(pool, async (client) => {
    const admin = ensureActiveMember((await lockMembers(client, [actor.userId]))[0], actor);
    if (admin.role !== 'admin') throw new EventError(403, 'FORBIDDEN', '관리자 권한이 필요합니다.');
    await client.query('SELECT pg_advisory_xact_lock($1)', [SYNC_LOCK]);
    const current = (await client.query<EventRow>('SELECT * FROM events WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!current) throw new EventError(404, 'NOT_FOUND', '행사를 찾을 수 없습니다.');
    if (current.version !== expectedVersion) throw new EventError(409, 'EVENT_CHANGED', '최신 행사와 원문 변경을 다시 확인해 주세요.');
    if (!current.source_system || !current.source_snapshot) throw new EventError(409, 'SOURCE_NOT_CONNECTED', '연결된 주보 원문이 없습니다.');
    if (mode === 'manual') {
      if (current.sync_mode === 'manual') return current;
      return (await client.query<EventRow>("UPDATE events SET sync_mode='manual',version=version+1,updated_at=now() WHERE id=$1 RETURNING *", [id])).rows[0];
    }
    if (current.source_missing) throw new EventError(409, 'SOURCE_MISSING', '원문에 다시 나타난 뒤 자동 반영을 재개할 수 있습니다.');
    if (current.source_review_required) throw new EventError(409, 'SOURCE_REVIEW_REQUIRED', '원문의 일정이 불명확해 자동 반영할 수 없습니다.');
    if (!validCombinedSettings(current, current.source_snapshot)) throw new EventError(409, 'SOURCE_CONFLICTS_WITH_REGISTRATION_SETTINGS', '원문 일정과 현재 신청 설정을 먼저 조정해 주세요.');
    const collision = await client.query('SELECT 1 FROM events WHERE source_system=$1 AND source_identity_key=$2 AND id<>$3',
      [current.source_system, current.source_snapshot_identity_key, id]);
    if (collision.rowCount) throw new EventError(409, 'SOURCE_IDENTITY_CONFLICT', '같은 원문 일정에 연결된 행사를 먼저 확인해 주세요.');
    return (await client.query<EventRow>(`UPDATE events SET title=$2,category=$3,description=$4,location=$5,target=$6,
      starts_at=$7,ends_at=$8,all_day=$9,sync_mode='automatic',source_identity_key=source_snapshot_identity_key,
      source_pending=false,source_sync_error=NULL,version=version+1,updated_at=now() WHERE id=$1 RETURNING *`,
    [id, ...sourceValues(current.source_snapshot)])).rows[0];
  });
}

import type { Pool, PoolClient } from 'pg';
import { HTTPException } from 'hono/http-exception';
import type { BulletinRow } from './types';
import type { BulletinInput, WorshipItem } from './validation';

type Queryable = Pick<Pool, 'query'> | PoolClient;

export type WorshipItemRow = {
  type: 'text' | 'sermon'; label: string; content: string; assignee: string;
  sermon: { sermonTitle?: string; scripture?: string } | null;
};

export function toWorshipItem(row: WorshipItemRow): WorshipItem {
  const fields = { label: row.label, assignee: row.assignee };
  return row.type === 'sermon'
    ? { ...fields, type: 'sermon', content: { sermonTitle: row.sermon?.sermonTitle ?? '', scripture: row.sermon?.scripture ?? '' } }
    : { ...fields, type: 'text', content: row.content || '' };
}

export async function transaction<T>(pool: Pool, run: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await run(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

const bulletinSelect = `SELECT b.id, b.service_date::text, b.theme, b.cover_media_id,
  m.object_key AS cover_object_key, m.alt_text AS cover_alt_text,
  b.sermon_title, b.scripture, b.preacher, b.status, b.published_at
  FROM bulletins b LEFT JOIN media_assets m ON m.id = b.cover_media_id`;

export async function getBulletin(db: Queryable, condition: string, value: string) {
  const result = await db.query<BulletinRow>(`${bulletinSelect} WHERE ${condition}`, [value]);
  if (!result.rows[0]) return null;
  const b = result.rows[0];
  const [items, community, promotions] = await Promise.all([
    db.query<WorshipItemRow>('SELECT type, label, content, sermon, assignee FROM worship_items WHERE bulletin_id = $1 ORDER BY position', [b.id]),
    db.query<{ category: string; content: string; details: Pick<BulletinInput['communityNews'][number], 'people' | 'wedding' | 'weddings'> }>('SELECT category, content, details FROM community_news WHERE bulletin_id = $1 ORDER BY position', [b.id]),
    db.query<{ id: string; title: string; body: string; details: BulletinInput['promotions'][number]['details']; url: string | null; link_label: string | null; linked_events?: CanonicalCalendarRow[] | null }>(`SELECT p.id,p.title,p.body,p.details,p.url,p.link_label,
      (SELECT jsonb_agg(to_jsonb(e)) FROM events e WHERE e.source_promotion_id=p.id AND e.publication_status='published' AND e.visibility='public' AND e.starts_at IS NOT NULL) AS linked_events
      FROM promotions p WHERE p.bulletin_id = $1 ORDER BY p.position`, [b.id]),
  ]);
  return {
    id: b.id, serviceDate: b.service_date, theme: b.theme, coverMediaId: b.cover_media_id,
    cover: b.cover_object_key ? { objectKey: b.cover_object_key, altText: b.cover_alt_text } : null,
    sermonTitle: b.sermon_title, scripture: b.scripture, preacher: b.preacher,
    status: b.status, publishedAt: b.published_at,
    worshipItems: items.rows.map(toWorshipItem), communityNews: community.rows.map(({ details, ...news }) => ({ ...news, ...details })),
    promotions: promotions.rows.map(({ link_label, linked_events, ...p }) => ({ ...p,
      details: linked_events?.length ? [...p.details.filter((detail) => detail.type !== 'schedule'), ...linked_events.map((event) => event.lifecycle_status === 'cancelled'
        ? { type: 'text' as const, title: event.title, body: '취소된 행사입니다.' }
        : { type: 'schedule' as const, title: event.title, body: event.description, schedule: canonicalSchedule(event) })]
        : p.details, url: p.url ?? '', linkLabel: link_label ?? '' })),
  };
}

type CanonicalCalendarRow = { id: string; title: string; description: string; starts_at: Date | string; ends_at: Date | string | null; all_day: boolean; lifecycle_status?: string };
function canonicalSchedule(event: CanonicalCalendarRow) {
  const seoul = (value: Date | string) => new Date(new Date(value).getTime() + 9 * 60 * 60 * 1000).toISOString();
  const start = seoul(event.starts_at), end = event.ends_at ? seoul(event.ends_at) : start;
  return { startDate: start.slice(0, 10), endDate: end.slice(0, 10), allDay: event.all_day,
    startTime: event.all_day ? '' : start.slice(11, 16), endTime: event.all_day || !event.ends_at ? '' : end.slice(11, 16) };
}

// Both web calendar and app read the canonical event rows. Unlinked legacy advertisements remain visible.
export async function getPromotionCalendarEvents(db: Queryable) {
  const result = await db.query<{ bulletin_id: string; title: string; body: string; details: BulletinInput['promotions'][number]['details']; url: string | null; link_label: string | null; canonical_event?: CanonicalCalendarRow | null }>(
    `SELECT p.bulletin_id,p.title,p.body,p.details,p.url,p.link_label,NULL::jsonb AS canonical_event FROM promotions p
      JOIN bulletins b ON b.id = p.bulletin_id
      WHERE b.status = 'published' AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(p.details) AS detail WHERE detail->>'type' = 'schedule'
      ) AND NOT EXISTS (SELECT 1 FROM events e WHERE e.source_promotion_id=p.id AND e.publication_status='published' AND e.visibility='public')
      UNION ALL
      SELECT p.bulletin_id,COALESCE(p.title,e.title),e.description,'[]'::jsonb,p.url,p.link_label,to_jsonb(e) FROM events e
      LEFT JOIN promotions p ON p.id=e.source_promotion_id
      WHERE e.publication_status='published' AND e.visibility='public' AND e.starts_at IS NOT NULL
      ORDER BY title`
  );
  return result.rows.flatMap((promotion) => {
    if (promotion.canonical_event) {
      const event = promotion.canonical_event;
      if (event.lifecycle_status === 'cancelled') return [];
      return [{ ...canonicalSchedule(event), title: event.title, content: event.description, url: promotion.url || '', linkLabel: promotion.link_label || '',
        sourceBulletinId: promotion.bulletin_id || '', sourceTitle: promotion.title, sourceEventId: event.id }];
    }
    return promotion.details.flatMap((detail) => {
    if (detail.type !== 'schedule' || !detail.schedule) return [];
    return [{ ...detail.schedule, title: detail.title, content: detail.body || promotion.body,
      url: promotion.url || '', linkLabel: promotion.link_label || '', sourceBulletinId: promotion.bulletin_id, sourceTitle: promotion.title }];
    });
  });
}

export async function getSiteInfo(db: Queryable) {
  const result = await db.query<{ church_name: string; worship_time: string; gathering_time: string; introduction: string; vision: string; address: string; map_url: string; recurring_info: unknown; church_events: unknown }>(
    'SELECT church_name, worship_time, gathering_time, introduction, vision, address, map_url, recurring_info, church_events FROM site_info WHERE id = 1'
  );
  const row = result.rows[0];
  if (!row) throw new Error('site_info row is missing');
  return { churchName: row.church_name, worshipTime: row.worship_time, gatheringTime: row.gathering_time,
    introduction: row.introduction, vision: row.vision, address: row.address, mapUrl: row.map_url, recurringInfo: row.recurring_info, churchEvents: row.church_events };
}

export async function replaceBulletin(client: PoolClient, id: string, data: BulletinInput) {
  await client.query(
    `UPDATE bulletins SET service_date = $2, theme = $3, cover_media_id = $4,
      sermon_title = $5, scripture = $6, preacher = $7, updated_at = now() WHERE id = $1`,
    [id, data.serviceDate, data.theme, data.coverMediaId, data.sermonTitle, data.scripture, data.preacher]
  );
  await client.query('DELETE FROM worship_items WHERE bulletin_id = $1', [id]);
  // Preserve advertisement identity across edits/reordering instead of deleting and recreating it.
  const previous = await client.query<{ id: string; position: number }>('SELECT id,position FROM promotions WHERE bulletin_id=$1 ORDER BY position FOR UPDATE', [id]);
  const hasExplicitIdentities = data.promotions.some((promotion) => !!promotion.id);
  const promotions = data.promotions.map((promotion, position) => ({ ...promotion,
    id: promotion.id || (!hasExplicitIdentities && previous.rows.find((row) => row.position === position)?.id) || crypto.randomUUID() }));
  const identities = promotions.map((promotion) => promotion.id);
  if (identities.length) {
    const foreign = await client.query('SELECT id FROM promotions WHERE id=ANY($1::uuid[]) AND bulletin_id<>$2', [identities, id]);
    if (foreign.rowCount) throw new HTTPException(409, { message: '다른 주보의 광고 ID를 사용할 수 없습니다.' });
  }
  await client.query('DELETE FROM promotions WHERE bulletin_id=$1 AND NOT (id=ANY($2::uuid[]))', [id, identities]);
  await client.query('DELETE FROM community_news WHERE bulletin_id = $1', [id]);
  if (data.worshipItems.length) await client.query(
    `INSERT INTO worship_items (bulletin_id, position, type, label, content, sermon, assignee)
     SELECT $1, ordinality - 1, item->>'type', item->>'label', item->>'content', item->'sermon', item->>'assignee'
     FROM jsonb_array_elements($2::jsonb) WITH ORDINALITY AS x(item, ordinality)`,
    [id, JSON.stringify(data.worshipItems.map((item) => ({ ...item,
      content: item.type === 'sermon' ? '' : item.content,
      sermon: item.type === 'sermon' ? item.content : {},
    })))]
  );
  if (data.communityNews.length) await client.query(
    `INSERT INTO community_news (bulletin_id, position, category, content, details)
     SELECT $1, ordinality - 1, item->>'category', item->>'content', item->'details'
     FROM jsonb_array_elements($2::jsonb) WITH ORDINALITY AS x(item, ordinality)`,
    [id, JSON.stringify(data.communityNews.map(({ category, content, people, wedding, weddings }) => ({ category, content, details: { people, wedding, weddings } })))]
  );
  if (data.promotions.length) await client.query(
    `INSERT INTO promotions (id, bulletin_id, position, title, body, details, url, link_label)
     SELECT (item->>'id')::uuid,$1,ordinality-1,item->>'title',item->>'body',item->'details',NULLIF(item->>'url',''),COALESCE(item->>'linkLabel', '')
     FROM jsonb_array_elements($2::jsonb) WITH ORDINALITY AS x(item,ordinality)
     ON CONFLICT (id) DO UPDATE SET position=EXCLUDED.position,title=EXCLUDED.title,body=EXCLUDED.body,
       details=EXCLUDED.details,url=EXCLUDED.url,link_label=EXCLUDED.link_label WHERE promotions.bulletin_id=EXCLUDED.bulletin_id`,
    [id, JSON.stringify(promotions)]
  );
}

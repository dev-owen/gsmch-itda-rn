-- LOCAL DEMONSTRATION ONLY. Production setup must never execute this seed implicitly.
-- Existing edits to this fixed demo event are preserved on repeat local setup.
INSERT INTO events (id,title,category,description,location,target,starts_at,ends_at,all_day,
  publication_status,lifecycle_status,registration_enabled,registration_opens_at,registration_closes_at,
  cancellation_closes_at,visibility,requires_member_verification,is_demo)
VALUES ('20270122-0124-4000-8000-000000000001','2027 느헤미야 겨울 수련회','event',
  '다시, 함께 세우다 · 느헤미야 2:18. 체험용 가상 행사이며 실제 교회 행사나 신청이 아닙니다.',
  '가상 은혜수양관 · 실제 장소 아님','청년 성도와 새가족',
  '2027-01-15T14:00:00+09:00','2027-01-17T15:00:00+09:00',false,
  'published','active',true,'2026-11-01T00:00:00+09:00','2027-01-14T23:59:00+09:00',
  '2027-01-14T23:59:00+09:00','public',false,true)
ON CONFLICT (id) DO NOTHING;

-- Correct the original local demo dates once. Preserve the event identity,
-- registrations and subsequent administrator edits on repeat setup.
UPDATE events
SET starts_at='2027-01-15T14:00:00+09:00',
    ends_at='2027-01-17T15:00:00+09:00',
    registration_closes_at='2027-01-14T23:59:00+09:00',
    cancellation_closes_at='2027-01-14T23:59:00+09:00',
    version=version+1,updated_at=now()
WHERE id='20270122-0124-4000-8000-000000000001'
  AND is_demo=true
  AND starts_at='2027-01-22T14:00:00+09:00'
  AND ends_at='2027-01-24T15:00:00+09:00'
  AND registration_closes_at='2027-01-21T23:59:00+09:00'
  AND cancellation_closes_at='2027-01-21T23:59:00+09:00'
  AND (registration_opens_at IS NULL OR registration_opens_at<='2027-01-14T23:59:00+09:00');

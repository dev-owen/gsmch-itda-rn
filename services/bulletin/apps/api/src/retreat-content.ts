// Keep this identity stable when dates change so existing registrations remain attached.
export const DEMO_EVENT_ID = '20270122-0124-4000-8000-000000000001';
export const RETREAT_SLUG = 'nehemiah-winter';

/** Explicitly fictional content for the local product demonstration; never seeded into production automatically. */
export const nehemiahWinterRetreat = {
  slug: RETREAT_SLUG,
  title: '2027 느헤미야 겨울 수련회',
  shortName: '느동수',
  theme: '다시, 함께 세우다',
  scripture: { reference: '느헤미야 2:18', excerpt: '일어나 건축하자' },
  description: '말씀 앞에서 마음을 새롭게 하고, 함께 예배하며 서로의 삶을 세우는 2박 3일. 화면과 신청 흐름을 살펴보기 위한 가상 수련회입니다.',
  startsAt: '2027-01-15T05:00:00.000Z',
  endsAt: '2027-01-17T06:00:00.000Z',
  location: { name: '가상 은혜수양관', address: '체험용 가상 장소입니다. 실제 방문 장소가 아닙니다.' },
  isDemo: true as const,
  schedule: [
    { date: '2027-01-15', label: '첫째 날 · 마음을 열다', items: [
      { time: '13:00', title: '본대 출발', description: '교회 집결 및 가상 수양관 이동' },
      { time: '14:00', title: '환영과 공동체 만남' },
      { time: '19:00', title: '첫날 저녁 예배', description: '말씀 앞에서 다시 시작하기' },
    ] },
    { date: '2027-01-16', label: '둘째 날 · 함께 세우다', items: [
      { time: '08:00', title: '아침 말씀과 기도' },
      { time: '14:00', title: '공동체 나눔', description: '서로의 이야기를 듣고 함께 기도하는 시간' },
      { time: '19:00', title: '찬양과 저녁 예배' },
    ] },
    { date: '2027-01-17', label: '셋째 날 · 삶으로 나아가다', items: [
      { time: '10:00', title: '파송 예배' },
      { time: '13:00', title: '마무리와 귀가 준비' },
      { time: '15:00', title: '교회 도착 예정', description: '전체 일정과 시각은 가상 예시입니다.' },
    ] },
  ],
  departureOptions: [
    { id: 'main', label: '본대', description: '1월 15일 오후 1시 교회에서 함께 출발', departureAt: '2027-01-15T04:00:00.000Z', requiresNote: false },
    { id: 'late', label: '후발대', description: '1월 15일 오후 7시 교회에서 출발', departureAt: '2027-01-15T10:00:00.000Z', requiresNote: false },
    { id: 'car', label: '자차', description: '직접 이동하며 출발 예정 시각을 알려주세요.', departureAt: null, requiresNote: true },
    { id: 'other', label: '기타', description: '별도 이동 방법과 출발 예정 시각을 알려주세요.', departureAt: null, requiresNote: true },
  ],
  registrationPath: '/retreats/nehemiah-winter/apply',
};

import { createContext, useContext, useEffect, useState, type PropsWithChildren } from 'react';
import { usePathname } from 'expo-router';
import type { AppUser, DepartureOption, Gender } from '@/domain/types';
import { useSession } from '@/services/session';
import { authReturnTo } from '@/services/auth';

export interface RetreatDraft {
  participantName: string; peerGroup: string; gender: Gender | ''; phoneNumber: string;
  departureOption: DepartureOption; departureNote: string; prayerRequest: string;
}
type DraftState = { scope: string; draft: RetreatDraft; view: 'edit' | 'review'; reviewed: boolean; reviewedEventVersion: number | null; allowGuestLogin: boolean };
type DraftContextValue = {
  draft: RetreatDraft; view: DraftState['view']; reviewed: boolean; reviewedEventVersion: number | null;
  locked: { participantName: boolean; peerGroup: boolean; gender: boolean; phoneNumber: boolean };
  update(patch: Partial<RetreatDraft>): void; setView(view: DraftState['view']): void;
  setReviewed(checked: boolean, eventVersion: number): void; beginGuestLogin(): void; cancelGuestLogin(): void; clear(): void;
};
const DraftContext = createContext<DraftContextValue | null>(null);
const blankDraft = (): RetreatDraft => ({ participantName: '', peerGroup: '', gender: '', phoneNumber: '', departureOption: 'main', departureNote: '', prayerRequest: '' });
function newState(scope: string): DraftState { return { scope, draft: blankDraft(), view: 'edit', reviewed: false, reviewedEventVersion: null, allowGuestLogin: false }; }
function align(previous: DraftState, scope: string, allowResume: boolean): DraftState {
  if (previous.scope === scope) return previous;
  if (previous.scope === 'guest' && scope !== 'guest' && previous.allowGuestLogin && allowResume) return { ...previous, scope, reviewed: false, reviewedEventVersion: null, allowGuestLogin: false };
  return newState(scope);
}
export function retreatSessionScope(user: AppUser | null) { return user ? `${user.id}:${user.version}` : 'guest'; }

// Form answers live only in this provider's memory. No URLs or device storage.
export function RetreatDraftProvider({ children }: PropsWithChildren) {
  const { user } = useSession();
  const pathname = usePathname();
  const scope = retreatSessionScope(user);
  const returnTo = authReturnTo();
  const allowResume = returnTo === '/retreats/nehemiah-winter/apply';
  const inLoginFlow = pathname === '/retreats/nehemiah-winter/apply' || pathname === '/auth/callback' || pathname === '/auth/proof';
  const [state, setState] = useState(() => newState(scope));
  const visible = align(state, scope, allowResume);
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => { if (active) setState(previous => { const next = align(previous, scope, allowResume); return !inLoginFlow && next.allowGuestLogin ? { ...next, allowGuestLogin: false } : next; }); });
    return () => { active = false; };
  }, [scope, allowResume, inLoginFlow]);
  const locked = {
    participantName: !!user?.name?.trim(), peerGroup: !!user?.peerGroup?.trim(),
    gender: !!user?.gender, phoneNumber: !!user?.phoneNumber?.trim(),
  };
  const draft: RetreatDraft = {
    ...visible.draft,
    participantName: locked.participantName ? user!.name : visible.draft.participantName,
    peerGroup: locked.peerGroup ? user!.peerGroup! : visible.draft.peerGroup,
    gender: locked.gender ? user!.gender! : visible.draft.gender,
    phoneNumber: locked.phoneNumber ? user!.phoneNumber! : visible.draft.phoneNumber,
  };
  const value: DraftContextValue = {
    draft, locked, view: visible.view, reviewed: visible.reviewed, reviewedEventVersion: visible.reviewedEventVersion,
    update: patch => setState(previous => { const current = align(previous, scope, allowResume); const allowed = { ...patch }; if (locked.participantName) delete allowed.participantName; if (locked.peerGroup) delete allowed.peerGroup; if (locked.gender) delete allowed.gender; if (locked.phoneNumber) delete allowed.phoneNumber; return { ...current, draft: { ...current.draft, ...allowed }, reviewed: false }; }),
    setView: view => setState(previous => ({ ...align(previous, scope, allowResume), view, reviewed: false })),
    setReviewed: (reviewed, eventVersion) => setState(previous => ({ ...align(previous, scope, allowResume), reviewed, reviewedEventVersion: reviewed ? eventVersion : null })),
    beginGuestLogin: () => setState(previous => ({ ...align(previous, scope, allowResume), allowGuestLogin: scope === 'guest' })),
    cancelGuestLogin: () => setState(previous => previous.scope === scope ? { ...previous, allowGuestLogin: false } : previous),
    clear: () => setState(previous => previous.scope === scope ? newState(scope) : previous),
  };
  return <DraftContext.Provider value={value}>{children}</DraftContext.Provider>;
}

export function useRetreatDraft() {
  const context = useContext(DraftContext);
  if (!context) throw new Error('RetreatDraftProvider가 필요합니다.');
  return context;
}

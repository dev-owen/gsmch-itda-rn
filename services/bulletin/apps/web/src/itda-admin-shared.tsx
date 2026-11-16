import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import './itda-admin.css';

export const GENDER_LABELS = { male: '남성', female: '여성', other: '기타' } as const;
export const DEPARTURE_LABELS = { main: '본대', late: '후발대', car: '자차', other: '기타' } as const;
export const ATTENDANCE_LABELS = { unmarked: '미확인', present: '출석', absent: '결석' } as const;

export function formatAdminDate(value: string | null, withTime = false) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Seoul',
    ...(withTime ? { hour: '2-digit', minute: '2-digit', hour12: false } : {}),
  }).format(date);
}

export function AdminBadge({ tone = 'neutral', children }: {
  tone?: 'green' | 'amber' | 'red' | 'neutral' | 'blue'; children: ReactNode;
}) {
  return <span className={`itda-badge ${tone}`}>{children}</span>;
}

export function AdminNotice({ error, children }: { error?: string; children?: ReactNode }) {
  if (!error && !children) return null;
  return <div className={error ? 'form-error' : 'form-notice'} role={error ? 'alert' : 'status'}>{error || children}</div>;
}

export function AdminDialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const element = dialog.current!;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    element.showModal();
    const cancel = (event: Event) => { event.preventDefault(); close.current(); };
    element.addEventListener('cancel', cancel);
    return () => {
      element.removeEventListener('cancel', cancel);
      element.close();
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, []);
  return <dialog ref={dialog} className="itda-dialog" aria-labelledby={titleId} onClick={(event) => {
    if (event.target !== event.currentTarget) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
  }}>
    <div className="itda-dialog-heading"><div><span className="eyebrow dark">ITDA ADMIN</span><h2 id={titleId}>{title}</h2></div><button type="button" className="icon-button" aria-label="상세 창 닫기" onClick={onClose}><X size={22} /></button></div>
    <div className="itda-dialog-content">{children}</div>
  </dialog>;
}

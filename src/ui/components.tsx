import { create } from 'zustand';
import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { tapFeedback } from '../native';
import { useStore, useT } from '../store';

/* ---------- question dialog (big buttons, one question) ---------- */

export interface AskOptions {
  title?: string;
  text: string;
  /** short list under the text (e.g. what is missing) */
  items?: { text: string; tag?: string; tone?: 'bad' | 'warn' | 'info' }[];
  yes: string;
  no: string;
  /** a third, quieter button */
  other?: string;
  danger?: boolean;
}
type Answer = 'yes' | 'no' | 'other';

interface DialogState {
  open: (AskOptions & { resolve: (v: Answer) => void }) | null;
}
const useDialog = create<DialogState>(() => ({ open: null }));

export function ask(o: AskOptions): Promise<Answer> {
  // a new question replaces an old one (the old one counts as "no")
  useDialog.getState().open?.resolve('no');
  return new Promise((resolve) => useDialog.setState({ open: { ...o, resolve } }));
}

export function confirm(text: string, yes: string, no: string, danger = false): Promise<boolean> {
  return ask({ text, yes, no, danger }).then((a) => a === 'yes');
}

/** Closes whatever is open on top (dialog, sheet). Returns true if something was closed. */
export function closeDialog(): boolean {
  const d = useDialog.getState().open;
  if (d) {
    d.resolve('no');
    useDialog.setState({ open: null });
    return true;
  }
  const s = useSheets.getState().stack;
  if (s.length) {
    s[s.length - 1]();
    return true;
  }
  return false;
}

export function DialogHost() {
  const d = useDialog((s) => s.open);
  if (!d) return null;
  const done = (v: Answer) => {
    tapFeedback();
    d.resolve(v);
    useDialog.setState({ open: null });
  };
  return (
    <div className="scrim" onClick={() => done('no')}>
      <div className="dialog" role="alertdialog" aria-modal="true" aria-label={d.title ?? d.text} onClick={(e) => e.stopPropagation()}>
        {d.title && <h2 className="dialog-title">{d.title}</h2>}
        <p className="dialog-text">{d.text}</p>
        {d.items && (
          <ul className="dialog-list">
            {d.items.map((x, i) => (
              <li key={i} className={`tone-${x.tone ?? 'info'}`}>
                {x.tag && <span className="pill">{x.tag}</span>}
                <span>{x.text}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="dialog-buttons">
          <button className="btn btn-plain" onClick={() => done('no')}>
            {d.no}
          </button>
          <button className={`btn ${d.danger ? 'btn-stop' : 'btn-go'}`} onClick={() => done('yes')}>
            {d.yes}
          </button>
        </div>
        {d.other && (
          <button className="btn btn-link" onClick={() => done('other')}>
            {d.other}
          </button>
        )}
      </div>
    </div>
  );
}

/* ---------- bottom sheet (bigger dialogs: share, map, guides) ---------- */

const useSheets = create<{ stack: (() => void)[] }>(() => ({ stack: [] }));

export function Sheet({ title, onClose, children, full = false }: { title: string; onClose: () => void; children: ReactNode; full?: boolean }) {
  const t = useT();
  // registered so the Android back button closes the top sheet first
  useEffect(() => {
    useSheets.setState((s) => ({ stack: [...s.stack, onClose] }));
    return () => useSheets.setState((s) => ({ stack: s.stack.filter((f) => f !== onClose) }));
  }, [onClose]);
  // portal: the tab strip is moved with a transform, which would trap a fixed overlay inside it
  return createPortal(
    <div className="scrim sheet-scrim" onClick={onClose}>
      <div className={`sheet ${full ? 'sheet-full' : ''}`} role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()} data-noswipe>
        <div className="sheet-head">
          <h2>{title}</h2>
          <button className="icon-btn" aria-label={t.close} onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

/* ---------- undo bar (every destructive action can be taken back) ---------- */

export function UndoBar() {
  const t = useT();
  const undo = useStore((s) => s.undo);
  useEffect(() => {
    if (!undo) return;
    const id = setTimeout(() => useStore.getState().clearUndo(), 8000);
    return () => clearTimeout(id);
  }, [undo]);
  if (!undo) return null;
  return (
    <div className="toast" role="status">
      <span>{undo.text}</span>
      <button
        className="btn btn-small"
        onClick={() => {
          tapFeedback();
          useStore.getState().undoDelete();
        }}
      >
        {t.undo}
      </button>
    </div>
  );
}

/* ---------- small building blocks ---------- */

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`card ${className}`}>{children}</section>;
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
  hint,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
  hint?: string;
}) {
  return (
    <div className="field">
      <div className="field-label">{label}</div>
      <div className="segmented" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button
            key={String(o.value)}
            role="radio"
            aria-checked={o.value === value}
            className={o.value === value ? 'on' : ''}
            onClick={() => {
              tapFeedback();
              onChange(o.value);
            }}
          >
            {o.label}
          </button>
        ))}
      </div>
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}

export function Toggle({ on, onChange, label, hint }: { on: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <button
      className="toggle-row"
      role="switch"
      aria-checked={on}
      onClick={() => {
        tapFeedback();
        onChange(!on);
      }}
    >
      <span>
        <span className="field-label">{label}</span>
        {hint && <span className="hint">{hint}</span>}
      </span>
      <span className={`switch ${on ? 'on' : ''}`} />
    </button>
  );
}

/** Opens a link in the system browser (never inside the app). */
export function ExtLink({ href, children, className = '' }: { href: string; children: ReactNode; className?: string }) {
  return (
    <a className={`ext-link ${className}`} href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

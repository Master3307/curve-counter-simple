import { create } from 'zustand';
import type { ReactNode } from 'react';
import { tapFeedback } from '../native';

/* ---------- confirm dialog (big buttons, one question) ---------- */

interface DialogState {
  open: { text: string; yes: string; no: string; danger?: boolean; resolve: (v: boolean) => void } | null;
}
const useDialog = create<DialogState>(() => ({ open: null }));

export function confirm(text: string, yes: string, no: string, danger = false): Promise<boolean> {
  return new Promise((resolve) => useDialog.setState({ open: { text, yes, no, danger, resolve } }));
}

export function closeDialog(): boolean {
  const d = useDialog.getState().open;
  if (!d) return false;
  d.resolve(false);
  useDialog.setState({ open: null });
  return true;
}

export function DialogHost() {
  const d = useDialog((s) => s.open);
  if (!d) return null;
  const done = (v: boolean) => {
    tapFeedback();
    d.resolve(v);
    useDialog.setState({ open: null });
  };
  return (
    <div className="scrim" onClick={() => done(false)}>
      <div className="dialog" role="alertdialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <p className="dialog-text">{d.text}</p>
        <div className="dialog-buttons">
          <button className="btn btn-plain" onClick={() => done(false)}>
            {d.no}
          </button>
          <button className={`btn ${d.danger ? 'btn-stop' : 'btn-go'}`} onClick={() => done(true)}>
            {d.yes}
          </button>
        </div>
      </div>
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
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
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

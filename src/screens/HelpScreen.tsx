import { useState } from 'react';
import { useStore, useT } from '../store';
import { GUIDES, guideFor, type Action, type Brand } from '../guides/guides';
import { APP_GUIDES } from '../guides/apps';
import { runAction, type Checks } from '../native';
import { Card, ExtLink } from '../ui/components';
import { SetupCheck, useBrand } from '../ui/SetupCheck';
import { AppIcon } from '../ui/icons';

export const GITHUB_USER = 'https://github.com/Master3307';
export const REPO = 'https://github.com/Master3307/curve-counter-simple';
export const OPENUSERJS = 'https://openuserjs.org/users/MrKoby07';

export function HelpScreen({ checks, onRecheck }: { checks: Checks; onRecheck: () => void }) {
  const t = useT();
  const lang = useStore((st) => st.settings.lang);
  const detected = useBrand();
  const [picked, setPicked] = useState<Brand | null>(null);
  const [picking, setPicking] = useState(false);
  const guide = guideFor(picked ?? detected ?? 'android');

  const act = async (a: Action) => {
    await runAction(a);
    onRecheck();
  };

  return (
    <div className="screen">
      <h1>{t.tabHelp}</h1>

      <h2>{t.checkTitle}</h2>
      <p className="hint">{t.checkHint}</p>
      <Card>
        <SetupCheck checks={checks} onRecheck={onRecheck} />
        <button className="btn btn-link" onClick={onRecheck}>
          ↻ {t.checkAgain}
        </button>
      </Card>

      <h2>{t.guideFor(guide.name)}</h2>
      <Card>
        <ol className="steps">
          {guide.steps.map((step, i) => {
            const done = step.check != null && checks[step.check] === 'ok';
            return (
              <li key={i} className={done ? 'step-done' : ''}>
                <span className="step-num" aria-label={`${t.step} ${i + 1}${done ? ` – ${t.done}` : ''}`}>
                  {done ? '✓' : i + 1}
                </span>
                <div>
                  <p>{step.text[lang]}</p>
                  {done ? (
                    <span className="hint">{t.done}</span>
                  ) : (
                    step.action && (
                      <button className="btn btn-small btn-go" onClick={() => act(step.action!)}>
                        {t.openIt}
                      </button>
                    )
                  )}
                </div>
              </li>
            );
          })}
        </ol>
        <button className="btn btn-link" onClick={() => setPicking(!picking)}>
          {t.otherPhone}
        </button>
        {picking && (
          <div className="brand-grid" aria-label={t.pickPhone}>
            {GUIDES.map((g) => (
              <button
                key={g.brand}
                className={g.brand === guide.brand ? 'on' : ''}
                onClick={() => {
                  setPicked(g.brand);
                  setPicking(false);
                }}
              >
                {g.name}
              </button>
            ))}
          </div>
        )}
      </Card>

      <h2>{t.faqTitle}</h2>
      <Card className="faq">
        {t.faq.map(([q, a], i) => (
          <details key={i}>
            <summary>{q}</summary>
            <p>{a}</p>
          </details>
        ))}
      </Card>

      <h2>{t.bringTitle}</h2>
      <p className="hint">{t.bringHint}</p>
      <Card className="faq">
        {APP_GUIDES.filter((a) => a.bring).map((a) => (
          <details key={a.id}>
            <summary>{a.name}</summary>
            <ol className="steps small">
              {a.bring![lang].map((s, i) => (
                <li key={i}>
                  <span className="step-num">{i + 1}</span>
                  <p>{s}</p>
                </li>
              ))}
            </ol>
          </details>
        ))}
        <details>
          <summary>{t.otherApps}</summary>
          <p>{t.otherAppsText}</p>
        </details>
      </Card>

      <h2>{t.sendTitle}</h2>
      <Card>
        <p>{t.sendText}</p>
      </Card>

      <h2>{t.aboutTitle}</h2>
      <Card className="about">
        <div className="about-head">
          <AppIcon className="about-icon" />
          <div>
            <b>{t.appName}</b>
            <span className="hint">
              {t.version} {__APP_VERSION__}
            </span>
          </div>
        </div>
        <p>{t.aboutText}</p>
        <p className="about-links">
          {t.madeBy}{' '}
          <ExtLink href={GITHUB_USER}>Korbinian</ExtLink> (
          <ExtLink href={OPENUSERJS}>MrKoby07</ExtLink>)
        </p>
        <p className="about-links">
          <ExtLink href={GITHUB_USER}>GitHub: Master3307 ↗</ExtLink>
          <br />
          <ExtLink href={REPO}>{t.sourceCode} ↗</ExtLink>
          <br />
          <ExtLink href={`${REPO}/issues`}>{t.reportBug} ↗</ExtLink>
        </p>
        <p className="hint">{t.aiNote}</p>
        <p className="hint">{t.mapCredit}</p>
        <p className="hint">{t.placeholderNote}</p>
      </Card>
    </div>
  );
}

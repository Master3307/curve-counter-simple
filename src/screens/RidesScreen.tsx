import { useMemo, useRef, useState } from 'react';
import { rideName, useStore, useT, type Ride, type Route } from '../store';
import { ask, Card, confirm, Segmented, Sheet } from '../ui/components';
import { fmtDate, fmtDistance, fmtDuration, fmtSpeed, fmtTime, speedUnit } from '../ui/format';
import { IconCurveLeft, IconCurveRight, IconTrash } from '../ui/icons';
import { RideDetails } from '../ui/RideDetails';
import { MapPreview, MapSheet, type MapLine } from '../ui/Map';
import { ShareSheet } from '../ui/Share';
import { importPicked } from '../tracking/fileIo';
import { IMPORT_ACCEPT } from '../logic/formats';
import { canMerge, variants } from '../logic/routes';
import { tapFeedback } from '../native';

const VARIANT_COLORS = ['#f2a922', '#2f6fe0', '#d6531a', '#17803a', '#8e44ad', '#16a2b8'];
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

export function RidesScreen() {
  const t = useT();
  const rides = useStore((s) => s.rides);
  const routes = useStore((s) => s.routes);
  const { units, lang } = useStore((s) => s.settings);
  const [view, setView] = useState<'rides' | 'routes'>('rides');
  const [busy, setBusy] = useState(false);
  const [saveAll, setSaveAll] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const onImport = async (list: FileList | null) => {
    if (!list?.length) return;
    setBusy(true);
    try {
      await importPicked([...list]);
    } finally {
      setBusy(false);
    }
  };

  const sum = rides.reduce(
    (a, r) => ({
      left: a.left + r.left,
      right: a.right + r.right,
      distanceM: a.distanceM + r.distanceM,
      timeMs: a.timeMs + (r.source === 'route' ? 0 : (r.endedAt ?? Date.now()) - r.startedAt),
    }),
    { left: 0, right: 0, distanceM: 0, timeMs: 0 },
  );
  const exportable = rides.filter((r) => r.hasTrack && r.endedAt != null);

  return (
    <div className="screen">
      <h1>{t.tabRides}</h1>
      <Segmented
        label={t.show}
        value={view}
        options={[
          { value: 'rides', label: t.viewRides },
          { value: 'routes', label: t.viewRoutes(routes.length) },
        ]}
        onChange={setView}
      />

      <button className={`btn btn-plain wide ${busy ? 'busy' : ''}`} disabled={busy} onClick={() => fileInput.current?.click()}>
        ⤓ {busy ? t.working : t.importRide}
      </button>
      <input
        ref={fileInput}
        className="hidden-input"
        aria-hidden="true"
        tabIndex={-1}
        type="file"
        accept={IMPORT_ACCEPT}
        multiple
        onChange={(e) => {
          void onImport(e.target.files);
          e.target.value = '';
        }}
      />
      <p className="hint center">{t.importFormats}</p>

      {view === 'rides' && (
        <>
          {rides.length === 0 && <p className="empty">{t.noRides}</p>}
          {rides.length > 0 && (
            <Card className="sum-card">
              <div className="sum-title">
                {t.allRides} · {t.rides(rides.length)}
              </div>
              <div className="lr-row big">
                <span className="lr lr-left">
                  <IconCurveLeft /> {sum.left}
                </span>
                <span className="lr lr-total">{sum.left + sum.right}</span>
                <span className="lr lr-right">
                  {sum.right} <IconCurveRight />
                </span>
              </div>
              <div className="meta">
                {fmtDistance(sum.distanceM, units, lang)} · {fmtDuration(sum.timeMs)}
                {sum.distanceM > 1000 && ` · ${t.per100kmShort(Math.round(((sum.left + sum.right) / sum.distanceM) * 100_000))}`}
              </div>
            </Card>
          )}
          {rides.map((r) => (
            <RideCard key={r.id} ride={r} />
          ))}
          {exportable.length > 1 && (
            <button className="btn btn-link" onClick={() => setSaveAll(true)}>
              {t.exportAll}
            </button>
          )}
        </>
      )}

      {view === 'routes' && <RoutesView />}
      {saveAll && <ShareSheet rides={exportable} mode="save" onClose={() => setSaveAll(false)} />}
    </div>
  );
}

function RideCard({ ride: r }: { ride: Ride }) {
  const t = useT();
  const activeId = useStore((s) => s.activeId);
  const { units, lang } = useStore((s) => s.settings);
  const [open, setOpen] = useState(false);
  const [sheet, setSheet] = useState<'share' | 'save' | 'merge' | 'rename' | null>(null);
  const running = r.id === activeId;
  const name = rideName(r);

  const onDelete = async () => {
    if (await confirm(t.deleteConfirm, t.delete, t.keep, true)) useStore.getState().deleteRide(r.id);
  };

  return (
    <Card className="ride-card">
      <div className="ride-head">
        <div>
          <div className="ride-date">{name ?? fmtDate(r.startedAt, lang)}</div>
          <div className="meta">
            {r.source === 'route' ? (
              <>{t.plannedRoute}</>
            ) : (
              <>
                {name ? `${fmtDate(r.startedAt, lang)} · ` : ''}
                {fmtTime(r.startedAt, lang)} – {r.endedAt ? fmtTime(r.endedAt, lang) : t.running} ·{' '}
                {r.source === 'gpx' ? t.imported : r.mode === 'auto' ? t.auto : t.manual}
              </>
            )}
          </div>
        </div>
        {!running && (
          <button className="icon-btn" aria-label={t.delete} onClick={onDelete}>
            <IconTrash />
          </button>
        )}
      </div>
      {r.shape && !open && (
        <button className="preview-btn" aria-label={t.details} onClick={() => setOpen(true)}>
          <MapPreview shape={r.shape} curves={r.curves} />
        </button>
      )}
      <div className="lr-row">
        <span className="lr lr-left">
          <IconCurveLeft /> {r.left}
        </span>
        <span className="lr lr-total">
          {r.left + r.right} <small>{t.curves}</small>
        </span>
        <span className="lr lr-right">
          {r.right} <IconCurveRight />
        </span>
      </div>
      {r.quality === 'approx' && <p className="hint">{t.importApprox}</p>}
      <dl className="facts">
        <div>
          <dt>{t.distance}</dt>
          <dd>{fmtDistance(r.distanceM, units, lang)}</dd>
        </div>
        {r.source !== 'route' && (
          <>
            <div>
              <dt>{t.onTheRoad}</dt>
              <dd>{fmtDuration((r.endedAt ?? Date.now()) - r.startedAt)}</dd>
            </div>
            <div>
              <dt>{t.riding}</dt>
              <dd>{fmtDuration(r.movingS * 1000)}</dd>
            </div>
            <div>
              <dt>{t.avgSpeed}</dt>
              <dd>
                {fmtSpeed(r.avgSpeed, units)} {speedUnit(units)}
              </dd>
            </div>
            <div>
              <dt>{t.topSpeed}</dt>
              <dd>
                {fmtSpeed(r.topSpeed, units)} {speedUnit(units)}
              </dd>
            </div>
          </>
        )}
      </dl>
      <div className="card-buttons">
        <button className="btn btn-plain" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? t.hideDetails : t.details}
        </button>
        {r.hasTrack && !running && (
          <button className="btn btn-go" onClick={() => setSheet('share')}>
            {t.share}
          </button>
        )}
      </div>
      {open && (
        <RideDetails
          ride={r}
          actions={
            !running && (
              <div className="detail-actions">
                {r.hasTrack && (
                  <button className="btn btn-plain wide" onClick={() => setSheet('save')}>
                    {t.saveAsFile}
                  </button>
                )}
                <button className="btn btn-plain wide" onClick={() => setSheet('rename')}>
                  {t.rename}
                </button>
                {r.shape && (
                  <button className="btn btn-plain wide" onClick={() => setSheet('merge')}>
                    {t.addToRoute}
                  </button>
                )}
              </div>
            )
          }
        />
      )}
      {(sheet === 'share' || sheet === 'save') && <ShareSheet rides={[r]} mode={sheet} onClose={() => setSheet(null)} />}
      {sheet === 'merge' && <MergeSheet rideIds={[r.id]} onClose={() => setSheet(null)} />}
      {sheet === 'rename' && (
        <RenameSheet
          value={name ?? ''}
          onClose={() => setSheet(null)}
          onSave={(v) => {
            const before = r.name;
            useStore.getState().updateRide(r.id, { name: v || undefined });
            useStore.getState().offerUndo({ text: t.renamed, rides: [], restore: (s) => ({ rides: s.rides.map((x) => (x.id === r.id ? { ...x, name: before } : x)) }) });
          }}
        />
      )}
    </Card>
  );
}

export function RenameSheet({ value, onSave, onClose }: { value: string; onSave: (v: string) => void; onClose: () => void }) {
  const t = useT();
  const [v, setV] = useState(value);
  return (
    <Sheet title={t.rename} onClose={onClose}>
      <input className="text-input" value={v} maxLength={60} autoFocus onChange={(e) => setV(e.target.value)} aria-label={t.name} placeholder={t.namePlaceholder} />
      <button
        className="btn btn-go btn-huge"
        onClick={() => {
          tapFeedback();
          onSave(v.trim());
          onClose();
        }}
      >
        {t.save}
      </button>
    </Sheet>
  );
}

/**
 * Put rides (or a whole route) into a route. Start and end must be at the same places:
 * close → straight in; a bit apart → ask; far apart → not possible.
 */
function MergeSheet({ rideIds, fromRoute, onClose }: { rideIds: string[]; fromRoute?: Route; onClose: () => void }) {
  const t = useT();
  const rides = useStore((s) => s.rides);
  const routes = useStore((s) => s.routes);
  const shape = rides.find((r) => r.id === rideIds[0])?.shape ?? [];
  const targets = routes.filter((x) => x !== fromRoute && !rideIds.every((id) => x.rideIds.includes(id)));

  const put = async (target: Route | null) => {
    const store = useStore.getState();
    if (target) {
      const ref = rides.find((r) => target.rideIds.includes(r.id) && r.shape)?.shape ?? [];
      const { check, gapM } = canMerge(shape, ref);
      if (check === 'tooFar') return;
      if (check === 'ask' && !(await confirm(t.mergeAsk(gapM), t.mergeYes, t.cancel))) return;
    }
    const ids = new Set(rideIds);
    let next = store.routes.map((x) => ({ ...x, rideIds: x.rideIds.filter((i) => !ids.has(i)) }));
    if (target) next = next.map((x) => (x.id === target.id ? { ...x, rideIds: [...x.rideIds, ...rideIds] } : x));
    else next.push({ id: uid(), name: fromRoute?.name ?? t.routeName(store.routes.length + 1), rideIds });
    store.setRoutes(
      next.filter((x) => x.rideIds.length),
      target ? t.merged : t.routeCreated,
    );
    tapFeedback(true);
    onClose();
  };

  return (
    <Sheet title={fromRoute ? t.mergeRoutes : t.addToRoute} onClose={onClose}>
      <p className="hint">{t.mergeHint}</p>
      {targets.length === 0 && <p className="empty">{t.noOtherRoutes}</p>}
      {targets.map((x) => {
        const ref = rides.find((r) => x.rideIds.includes(r.id) && r.shape)?.shape ?? [];
        const { check, gapM } = canMerge(shape, ref);
        return (
          <button key={x.id} className={`list-btn ${check === 'tooFar' ? 'disabled' : ''}`} disabled={check === 'tooFar'} onClick={() => put(x)}>
            <span>
              <b>{x.name}</b>
              <span className="hint">
                {t.rides(x.rideIds.length)} · {check === 'ok' ? t.sameStartEnd : check === 'ask' ? t.endsApart(gapM) : t.tooFarApart(gapM)}
              </span>
            </span>
            <MapPreview shape={ref} className="mini" />
          </button>
        );
      })}
      {!fromRoute && (
        <button className="btn btn-plain wide" onClick={() => put(null)}>
          ＋ {t.newRoute}
        </button>
      )}
      <p className="hint">{t.mergeUndoHint}</p>
    </Sheet>
  );
}

function RoutesView() {
  const t = useT();
  const routes = useStore((s) => s.routes);
  if (!routes.length) return <p className="empty">{t.noRoutes}</p>;
  return (
    <>
      <p className="hint">{t.routesHint}</p>
      {routes.map((x) => (
        <RouteCard key={x.id} route={x} />
      ))}
    </>
  );
}

function RouteCard({ route }: { route: Route }) {
  const t = useT();
  const allRides = useStore((s) => s.rides);
  const { units, lang } = useStore((s) => s.settings);
  const [sheet, setSheet] = useState<'map' | 'merge' | 'rename' | null>(null);
  const rides = useMemo(() => allRides.filter((r) => route.rideIds.includes(r.id)), [allRides, route.rideIds]);
  const groups = useMemo(() => variants(rides), [rides]);
  const lines: MapLine[] = useMemo(
    () =>
      groups.map((ids, i) => ({
        id: ids[0],
        shape: rides.find((r) => r.id === ids[0])?.shape ?? [],
        color: VARIANT_COLORS[i % VARIANT_COLORS.length],
        label: t.variant(i + 1),
      })),
    [groups, rides, t],
  );
  const best = rides.reduce<Ride | null>((b, r) => (!b || r.left + r.right > b.left + b.right ? r : b), null);

  const remove = (id: string) => {
    const s = useStore.getState();
    s.setRoutes(
      s.routes.map((x) => (x.id === route.id ? { ...x, rideIds: x.rideIds.filter((i) => i !== id) } : x)).filter((x) => x.rideIds.length),
      t.removedFromRoute,
    );
  };
  const dissolve = async () => {
    const a = await ask({ text: t.dissolveConfirm, yes: t.dissolve, no: t.keep, danger: true });
    if (a !== 'yes') return;
    const s = useStore.getState();
    s.setRoutes(
      s.routes.filter((x) => x.id !== route.id),
      t.routeDissolved,
    );
  };

  return (
    <Card className="ride-card">
      <div className="ride-head">
        <div>
          <div className="ride-date">{route.name}</div>
          <div className="meta">
            {t.rides(rides.length)} · {t.variants(groups.length)}
          </div>
        </div>
      </div>
      <button className="preview-btn" aria-label={t.mapBig} onClick={() => setSheet('map')}>
        <MapPreview lines={lines} />
      </button>
      {best && (
        <p className="detail-line">
          {t.mostCurves}: {best.left + best.right} · {fmtDate(best.startedAt, lang)}
        </p>
      )}
      <ul className="route-rides">
        {groups.map((ids, gi) =>
          ids.map((id) => {
            const r = rides.find((x) => x.id === id)!;
            return (
              <li key={id}>
                <span className="variant-dot" style={{ background: VARIANT_COLORS[gi % VARIANT_COLORS.length] }} aria-label={t.variant(gi + 1)} />
                <span className="grow">
                  {rideName(r) ?? fmtDate(r.startedAt, lang)}
                  <span className="hint">
                    ↰ {r.left} · {r.right} ↱ · {fmtDistance(r.distanceM, units, lang)}
                    {groups.length > 1 && ` · ${t.variant(gi + 1)}`}
                  </span>
                </span>
                <button className="icon-btn small" aria-label={t.removeFromRoute} onClick={() => remove(id)}>
                  ✕
                </button>
              </li>
            );
          }),
        )}
      </ul>
      <div className="card-buttons">
        <button className="btn btn-plain" onClick={() => setSheet('rename')}>
          {t.rename}
        </button>
        <button className="btn btn-plain" onClick={() => setSheet('merge')}>
          {t.mergeRoutes}
        </button>
      </div>
      <button className="btn btn-link danger" onClick={dissolve}>
        {t.dissolve}
      </button>
      {sheet === 'map' && <MapSheet lines={lines} title={route.name} onClose={() => setSheet(null)} />}
      {sheet === 'merge' && <MergeSheet rideIds={route.rideIds} fromRoute={route} onClose={() => setSheet(null)} />}
      {sheet === 'rename' && (
        <RenameSheet
          value={route.name}
          onClose={() => setSheet(null)}
          onSave={(v) => {
            const s = useStore.getState();
            if (v) s.setRoutes(s.routes.map((x) => (x.id === route.id ? { ...x, name: v } : x)), t.renamed);
          }}
        />
      )}
    </Card>
  );
}

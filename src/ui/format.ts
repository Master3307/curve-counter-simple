import { localeOf, type Lang } from '../i18n/strings';
import type { Units } from '../store';

/** 0:42 h · 1:23 h */
export function fmtDuration(ms: number): string {
  const min = Math.max(0, Math.floor(ms / 60_000));
  return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')} h`;
}

export function fmtDistance(m: number, units: Units, lang: Lang): string {
  const v = units === 'imperial' ? m / 1609.344 : m / 1000;
  const n = v.toLocaleString(localeOf(lang), { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return `${n} ${units === 'imperial' ? 'mi' : 'km'}`;
}

/** m/s → "64" (number only, unit via speedUnit) */
export function fmtSpeed(msValue: number, units: Units): string {
  return String(Math.round(units === 'imperial' ? msValue * 2.236936 : msValue * 3.6));
}
export const speedUnit = (units: Units) => (units === 'imperial' ? 'mph' : 'km/h');

export function fmtDate(t: number, lang: Lang): string {
  return new Date(t).toLocaleDateString(localeOf(lang), { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}
export function fmtTime(t: number, lang: Lang): string {
  return new Date(t).toLocaleTimeString(localeOf(lang), { hour: '2-digit', minute: '2-digit' });
}

/** 1 245 m · 4 085 ft */
export function fmtHeight(m: number, units: Units, lang: Lang): string {
  const v = Math.round(units === 'imperial' ? m * 3.28084 : m);
  return `${v.toLocaleString(localeOf(lang))} ${units === 'imperial' ? 'ft' : 'm'}`;
}

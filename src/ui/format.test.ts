import { fmtDistance, fmtDuration, fmtSpeed } from './format';

describe('format', () => {
  it('formats ride time', () => {
    expect(fmtDuration(0)).toBe('0:00 h');
    expect(fmtDuration(83 * 60_000 + 30_000)).toBe('1:23 h');
  });
  it('formats distance and speed in both unit systems', () => {
    expect(fmtDistance(48_300, 'metric', 'en')).toBe('48.3 km');
    expect(fmtDistance(48_300, 'metric', 'de')).toBe('48,3 km');
    expect(fmtDistance(1609.344, 'imperial', 'en')).toBe('1.0 mi');
    expect(fmtSpeed(100 / 3.6, 'metric')).toBe('100');
    expect(fmtSpeed(100 / 3.6, 'imperial')).toBe('62');
  });
  it('uses European formats in both languages (24 h, day before month)', async () => {
    const { fmtTime, fmtDate } = await import('./format');
    const t = Date.UTC(2026, 10, 19, 17, 5);
    const local = new Date(t);
    const hh = String(local.getHours()).padStart(2, '0');
    expect(fmtTime(t, 'de')).toBe(`${hh}:05`);
    expect(fmtTime(t, 'en')).toBe(`${hh}:05`); // not "05:05 PM"
    expect(fmtDate(t, 'en')).toMatch(/19 Nov/);
    expect(fmtDate(t, 'de')).toMatch(/19\. Nov/);
  });
  it('German and metric are the defaults on every phone', async () => {
    const { DEFAULT_SETTINGS } = await import('../store');
    expect(DEFAULT_SETTINGS.lang).toBe('de');
    expect(DEFAULT_SETTINGS.units).toBe('metric');
  });
});

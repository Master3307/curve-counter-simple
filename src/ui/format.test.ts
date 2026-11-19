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
});

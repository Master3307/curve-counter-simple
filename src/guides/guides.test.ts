import { brandFor, GUIDES, guideFor } from './guides';

describe('guides', () => {
  it('detects brands', () => {
    expect(brandFor('android', 'samsung')).toBe('samsung');
    expect(brandFor('android', 'Xiaomi')).toBe('xiaomi');
    expect(brandFor('android', 'realme')).toBe('oppo');
    expect(brandFor('android', 'Fairphone')).toBe('android');
    expect(brandFor('ios', 'Apple')).toBe('iphone');
  });

  it('keeps every guide dead simple: max 3 steps, both languages', () => {
    for (const g of GUIDES) {
      expect(g.steps.length).toBeLessThanOrEqual(3);
      for (const s of g.steps) {
        expect(s.text.de.length).toBeGreaterThan(5);
        expect(s.text.en.length).toBeGreaterThan(5);
      }
    }
    expect(guideFor('android').brand).toBe('android');
  });

  it('every step with a button tells the user to tap that button (same word)', () => {
    for (const g of GUIDES)
      for (const st of g.steps) {
        if (!st.action) continue;
        expect(st.text.de).toContain('„Öffnen“');
        expect(st.text.en).toContain('"Open"');
      }
  });
});

import { distanceMeters } from '../geo';

describe('distanceMeters', () => {
  it('returns ~0 for the same point', () => {
    expect(distanceMeters(41.2995, 69.2401, 41.2995, 69.2401)).toBeLessThan(1);
  });

  it('matches a known distance (roughly) between two Tashkent landmarks', () => {
    // Amir Temur Square to Tashkent Tower — real-world distance ~1.7km.
    const d = distanceMeters(41.311081, 69.279737, 41.31108, 69.269);
    expect(d).toBeGreaterThan(500);
    expect(d).toBeLessThan(1200);
  });

  it('is symmetric', () => {
    const a = distanceMeters(41.3, 69.2, 41.31, 69.25);
    const b = distanceMeters(41.31, 69.25, 41.3, 69.2);
    expect(a).toBeCloseTo(b, 3);
  });
});

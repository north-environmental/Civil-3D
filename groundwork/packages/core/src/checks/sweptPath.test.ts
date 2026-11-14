import { describe, expect, it } from 'vitest';
import { WB67 } from '../criteria/vehicles';
import { type Pt, pointInRegion, regionArea } from '../geometry/basic';
import { filletPath, sweptEnvelope } from './sweptPath';

describe('WB-67 swept path (kinematic)', () => {
  it('vehicle dimensions add up to the 73.5 ft overall length', () => {
    expect(WB67.frontOverhangFt + WB67.tractorWheelbaseFt + WB67.kingpinToRearAxleFt + WB67.rearOverhangFt).toBeCloseTo(73.5, 6);
  });

  it('on a straight path the envelope is the vehicle width and there is no off-tracking', () => {
    const path: Pt[] = [];
    for (let x = 0; x <= 400; x += 2) path.push([x, 0]);
    const r = sweptEnvelope(path);
    expect(r.maxOffTrackingFt).toBeLessThan(0.01);
    // Rectangle from the rear bumper at the start to the front bumper at the end, 8.5 ft wide.
    const length = 400 + WB67.frontOverhangFt + WB67.tractorWheelbaseFt + WB67.kingpinToRearAxleFt + WB67.rearOverhangFt;
    expect(regionArea(r.envelope)).toBeCloseTo(length * WB67.widthFt, -1);
    expect(pointInRegion([200, 4.2], r.envelope)).toBe(true);
    expect(pointInRegion([200, 4.4], r.envelope)).toBe(false);
  });

  it('fillets a 90° corner with a tangent arc of the requested radius', () => {
    const p = filletPath([[0, 0], [300, 0], [300, 300]], 50, 2);
    // The arc is centered at (250, 50); every point between the tangent points is 50 ft from it.
    const onArc = p.filter((q) => q[0] > 250.5 && q[1] < 49.5);
    expect(onArc.length).toBeGreaterThan(10);
    for (const q of onArc) expect(Math.hypot(q[0] - 250, q[1] - 50)).toBeCloseTo(50, 1);
    expect(p[0]).toEqual([0, 0]);
    expect(p[p.length - 1]).toEqual([300, 300]);
  });

  it('off-tracks on a 90° turn at a 50 ft radius by roughly the steady-state amount', () => {
    const path = filletPath([[0, 0], [300, 0], [300, 300]], 50, 2);
    const r = sweptEnvelope(path);
    // Steady-state off-tracking on a circle of radius R: R − sqrt(R² − WB1² − WB2²) would exceed R here
    // (WB2 alone is 45.5 ft), so on a 90° turn the transient value is large but below the wheelbase sum.
    expect(r.maxOffTrackingFt).toBeGreaterThan(12);
    expect(r.maxOffTrackingFt).toBeLessThan(30);
    // The envelope bulges to the inside of the turn: a point 8 ft inside the arc midpoint (285.4, 14.6) is swept.
    expect(pointInRegion([279.7, 20.3], r.envelope)).toBe(true);
    // …but the outside of the turn is not.
    expect(pointInRegion([312, -12], r.envelope)).toBe(false);
  });
});

import type { Car } from './car';
import type { Controls } from './input';
import type { Track } from './track';

/** Simple pure-pursuit driver: aims at a point ahead on the centre line, lifts in tight corners. */
export function autopilot(car: Car, track: Track, skill = 1): Controls {
  const look = Math.round(12 + car.speed * 0.22);
  const p = track.pts[track.wrap(car.trackIdx + look)];
  const desired = Math.atan2(p.x - car.pos.x, p.z - car.pos.z);
  let diff = desired - car.heading;
  diff = Math.atan2(Math.sin(diff), Math.cos(diff));

  // how sharp is the road further ahead?
  const a = track.tan[track.wrap(car.trackIdx + look)];
  const b = track.tan[track.wrap(car.trackIdx + look * 2)];
  const bend = Math.acos(Math.min(1, a.x * b.x + a.z * b.z));

  const tooFast = car.speed > 95 * skill - bend * 140;
  return {
    throttle: tooFast ? 0.2 : 1,
    brake: tooFast && car.speed > 70 ? 0.4 : 0,
    steer: Math.max(-1, Math.min(1, diff * 2.8)),
    drift: false,
    start: false,
    restart: false,
    mute: false,
  };
}

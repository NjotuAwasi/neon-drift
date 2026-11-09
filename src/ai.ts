import type { Car } from './car';
import type { Controls } from './input';
import { ROAD_HALF, type Track } from './track';

/**
 * Pure-pursuit driver: aims at a point ahead on the track, offset sideways by `lane`,
 * and lifts off before sharp bends. `skill` scales the target top speed.
 */
export function autopilot(car: Car, track: Track, skill = 1, lane = 0): Controls {
  const look = Math.round(12 + car.speed * 0.22);
  const k = track.wrap(car.trackIdx + look);
  const p = track.pts[k], s = track.side[k];
  const l = Math.max(-(ROAD_HALF - 2.5), Math.min(ROAD_HALF - 2.5, lane));
  const desired = Math.atan2(p.x + s.x * l - car.pos.x, p.z + s.z * l - car.pos.z);
  let diff = desired - car.heading;
  diff = Math.atan2(Math.sin(diff), Math.cos(diff));

  // how sharp is the road further ahead?
  const a = track.tan[k];
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

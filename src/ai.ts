import * as THREE from 'three';
import type { Car } from './car';
import type { Controls } from './input';
import { ROAD_HALF, type Track } from './track';

/**
 * Pure-pursuit driver. Steers at a point ahead on the track (offset by `lane`),
 * and follows the track's precomputed speed profile so it brakes for corners.
 * `skill` scales target speed.
 */
export function drive(car: Car, track: Track, skill = 1, lane = 0): Controls {
  const sp = track.spacing;
  const prof = track.profile;
  const look = Math.max(4, Math.round((16 + car.speed * 0.3) / sp));
  const k = track.wrap(car.trackIdx + look);
  const target = Math.min(95 * skill, prof[track.wrap(car.trackIdx + Math.round(6 / sp))] * skill);

  // hold a lane on straights, drift back to the centre line for tight corners
  const room = THREE.MathUtils.clamp((prof[k] - 45) / 35, 0, 1);
  const l = THREE.MathUtils.clamp(lane * room, -(ROAD_HALF - 2.5), ROAD_HALF - 2.5);
  const p = track.pts[k], s = track.side[k];
  const desired = Math.atan2(p.x + s.x * l - car.pos.x, p.z + s.z * l - car.pos.z);
  let diff = desired - car.heading;
  diff = Math.atan2(Math.sin(diff), Math.cos(diff));

  const over = car.speed - target;
  return {
    throttle: over > 3 ? 0 : over > 0 ? 0.35 : 1,
    brake: over > 3 ? Math.min(1, over / 12) : 0,
    steer: THREE.MathUtils.clamp(diff * 2.8, -1, 1),
    drift: false,
    start: false,
    restart: false,
    mute: false,
    back: false,
    navX: 0,
    navY: 0,
  };
}

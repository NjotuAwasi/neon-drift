import { TRACKS } from './tracks';

/** A friend's best lap, shareable as a URL: track, name, time and the full ghost. */
export interface Challenge {
  trackId: string;
  name: string;
  time: number;
  frames: number[]; // [x, z, heading, roll]* at 20 Hz
}

const VERSION = 1;
const Q = 10; // position quantum: 0.1 units
const HQ = 200; // heading quantum: 0.005 rad
const RQ = 300; // roll quantum

const clamp8 = (v: number) => Math.max(-128, Math.min(127, v));
export const cleanName = (n: string) => n.toUpperCase().replace(/[^A-Z0-9 ._-]/g, '').trim().slice(0, 12);

/**
 * Binary layout: version, track index, time (ms), name, frame count, first frame
 * absolute, then per-frame int8 deltas. Deltas are taken against the *decoded*
 * position (closed loop) so rounding never accumulates.
 */
function pack(c: Challenge) {
  const f = c.frames;
  const n = Math.floor(f.length / 4);
  if (n < 2) throw new Error('ghost too short');
  const name = new TextEncoder().encode(cleanName(c.name) || 'PLAYER');
  const buf = new ArrayBuffer(1 + 1 + 4 + 1 + name.length + 2 + 12 + 1 + (n - 1) * 4);
  const dv = new DataView(buf);
  let o = 0;
  dv.setUint8(o++, VERSION);
  dv.setUint8(o++, Math.max(0, TRACKS.findIndex((t) => t.id === c.trackId)));
  dv.setUint32(o, Math.round(c.time * 1000), true); o += 4;
  dv.setUint8(o++, name.length);
  new Uint8Array(buf, o, name.length).set(name); o += name.length;
  dv.setUint16(o, n, true); o += 2;
  let qx = Math.round(f[0] * Q), qz = Math.round(f[1] * Q), qh = Math.round(f[2] * HQ);
  dv.setInt32(o, qx, true); o += 4;
  dv.setInt32(o, qz, true); o += 4;
  dv.setInt32(o, qh, true); o += 4;
  dv.setInt8(o++, clamp8(Math.round(f[3] * RQ)));
  for (let i = 1; i < n; i++) {
    const dx = clamp8(Math.round(f[i * 4] * Q) - qx);
    const dz = clamp8(Math.round(f[i * 4 + 1] * Q) - qz);
    // heading only matters modulo 2π: encode the shortest turn so wrap-arounds never clamp
    const turn = f[i * 4 + 2] - qh / HQ;
    const dh = clamp8(Math.round(Math.atan2(Math.sin(turn), Math.cos(turn)) * HQ));
    qx += dx; qz += dz; qh += dh;
    dv.setInt8(o++, dx);
    dv.setInt8(o++, dz);
    dv.setInt8(o++, dh);
    dv.setInt8(o++, clamp8(Math.round(f[i * 4 + 3] * RQ)));
  }
  return new Uint8Array(buf);
}

function unpack(bytes: Uint8Array): Challenge | null {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let o = 0;
  if (dv.getUint8(o++) !== VERSION) return null;
  const track = TRACKS[dv.getUint8(o++)];
  if (!track) return null;
  const time = dv.getUint32(o, true) / 1000; o += 4;
  const nl = dv.getUint8(o++);
  const name = cleanName(new TextDecoder().decode(bytes.subarray(o, o + nl))) || 'RIVAL'; o += nl;
  const n = dv.getUint16(o, true); o += 2;
  let qx = dv.getInt32(o, true); o += 4;
  let qz = dv.getInt32(o, true); o += 4;
  let qh = dv.getInt32(o, true); o += 4;
  const frames = [qx / Q, qz / Q, qh / HQ, dv.getInt8(o++) / RQ];
  for (let i = 1; i < n; i++) {
    qx += dv.getInt8(o++);
    qz += dv.getInt8(o++);
    qh += dv.getInt8(o++);
    frames.push(qx / Q, qz / Q, qh / HQ, dv.getInt8(o++) / RQ);
  }
  if (!(time > 5 && time < 600) || n < 2) return null;
  if (frames.some((v) => !Number.isFinite(v) || Math.abs(v) > 1e5)) return null;
  return { trackId: track.id, name, time, frames };
}

async function transform(bytes: Uint8Array, t: CompressionStream | DecompressionStream) {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(t as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const canZip = typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';

function toB64url(bytes: Uint8Array) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s: string) {
  let b = s.replace(/-/g, '+').replace(/_/g, '/');
  while (b.length % 4) b += '=';
  const bin = atob(b);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function encodeChallenge(c: Challenge) {
  const raw = pack(c);
  if (canZip) return 'z' + toB64url(await transform(raw, new CompressionStream('deflate-raw')));
  return 'r' + toB64url(raw);
}

export async function decodeChallenge(code: string): Promise<Challenge | null> {
  try {
    let bytes = fromB64url(code.slice(1));
    if (code[0] === 'z') {
      if (!canZip) return null;
      bytes = await transform(bytes, new DecompressionStream('deflate-raw'));
    } else if (code[0] !== 'r') {
      return null;
    }
    return unpack(bytes);
  } catch {
    return null;
  }
}

export async function challengeLink(c: Challenge) {
  return `${location.origin}${location.pathname}#c=${await encodeChallenge(c)}`;
}

/** Share sheet on phones, clipboard on desktop; 'manual' means show the link to copy by hand. */
export async function shareLink(url: string, text: string): Promise<'shared' | 'copied' | 'manual' | 'cancelled'> {
  if (matchMedia('(pointer: coarse)').matches && typeof navigator.share === 'function') {
    try {
      await navigator.share({ title: 'Neon Drift challenge', text, url });
      return 'shared';
    } catch (e) {
      if ((e as DOMException)?.name === 'AbortError') return 'cancelled';
    }
  }
  try {
    await navigator.clipboard.writeText(`${text} ${url}`);
    return 'copied';
  } catch {
    return 'manual';
  }
}

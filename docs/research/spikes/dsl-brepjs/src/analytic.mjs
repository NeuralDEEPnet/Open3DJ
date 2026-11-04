// Independent analytic volumes (no kernel) for the required starters.
const PI = Math.PI;
// vented-enclosure: rounded rect prism minus inward shell (open top) minus 12 slot cuts through straight walls
const rr = (w, d, r) => w * d - (4 - PI) * r * r;
const outer = rr(70, 50, 4) * 28, inner = rr(70 - 4.8, 50 - 4.8, 4 - 2.4) * (28 - 2.4);
const slots = 12 * 3 * 2.4 * (28 * 0.45);
console.log("vented-enclosure", (outer - inner - slots).toFixed(3));
// lathe-profile: polygon revolved -> sum of frustums (Pappus per segment) with duplicate point removed
function lathe(inset, base, H = 90, bellyR = 34, neckR = 14, waist = 0.72) {
  const pts = [[0, base], [Math.max(0.5, bellyR - inset), base]];
  for (let i = 0; i <= 24; i++) { const t = i / 24, pinch = 1 - (1 - waist) * Math.sin(t * PI), r = (bellyR + (neckR - bellyR) * t) * pinch; pts.push([Math.max(0.5, r - inset), base + H * t]); }
  pts.push([0, base + H]);
  // closed polygon in (r,z); volume = |sum over edges of pi/3 * (z2-z1)*(r1^2+r1 r2+r2^2)|
  let v = 0; for (let i = 0; i < pts.length; i++) { const [r1, z1] = pts[i], [r2, z2] = pts[(i + 1) % pts.length]; v += PI / 3 * (z2 - z1) * (r1 * r1 + r1 * r2 + r2 * r2); }
  return Math.abs(v);
}
// inner pokes above outer (z 2.5..92.5 vs 0..90): subtracted part is the inner clipped at z<=90
function latheClipped(inset, base, zmax) {
  const H = 90, bellyR = 34, neckR = 14, waist = 0.72;
  const pts = [[0, base], [Math.max(0.5, bellyR - inset), base]];
  for (let i = 0; i <= 24; i++) { const t = i / 24, pinch = 1 - (1 - waist) * Math.sin(t * PI), r = (bellyR + (neckR - bellyR) * t) * pinch; pts.push([Math.max(0.5, r - inset), base + H * t]); }
  // clip the outer boundary polyline (pts[1..]) at zmax
  const prof = []; for (let i = 1; i < pts.length; i++) { const [r, z] = pts[i]; if (z <= zmax) prof.push([r, z]); else { const [rp, zp] = pts[i - 1]; if (zp < zmax) prof.push([rp + (r - rp) * (zmax - zp) / (z - zp), zmax]); break; } }
  let v = 0; for (let i = 0; i + 1 < prof.length; i++) { const [r1, z1] = prof[i], [r2, z2] = prof[i + 1]; v += PI / 3 * (z2 - z1) * (r1 * r1 + r1 * r2 + r2 * r2); }
  return v;
}
console.log("lathe-profile", (lathe(0, 0) - latheClipped(2.5, 2.5, 90)).toFixed(3));
// twisted-vase: twist does not change cross-section area; A(z)=A0*s(z)^2, s=1+(k-1)z/H
const hexA = (r) => 1.5 * Math.sqrt(3) * r * r;
const A0 = hexA(30), ri = 30 * Math.cos(PI / 6) - 2, A1 = 2 * Math.sqrt(3) * ri * ri, H = 120, k = 0.7;
const integ = (A, a, b) => { const f = (z) => A * (H / (3 * (k - 1))) * Math.pow(1 + (k - 1) * z / H, 3); return f(b) - f(a); };
console.log("twisted-vase", (integ(A0, 0, H) - integ(A1, 0, H - 2)).toFixed(3));
// exact lego: annulus minus circular segments cut by the inner wall planes (distance 2.7 from tube centre)
{
  const seg = (r, d) => (d >= r ? 0 : r * r * Math.acos(d / r) - d * Math.sqrt(r * r - d * d));
  const ann = PI * (3.25 ** 2 - 2.4 ** 2);
  const s = seg(3.25, 2.7) - seg(2.4, 2.7);
  const inner4 = 4 * (ann - s), outer4 = 4 * (ann - 2 * s); // (+-4,+-4): y-wall only; (+-12,+-4): x- and y-wall (segments disjoint)
  const shellV = 31.8 * 15.8 * 9.6 - 29.4 * 13.4 * 8.4, studsV = 8 * PI * 2.4 * 2.4 * 1.8;
  console.log("lego-brick exact", (shellV + studsV + (inner4 + outer4) * 8.4).toFixed(3), "segment", s.toFixed(5));
}

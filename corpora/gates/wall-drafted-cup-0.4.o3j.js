// Gate corpus case wall-drafted-cup-0.4 (cases.json has its expected verdicts).
// A cup 30 mm across at the base and 20 mm tall, flaring 8 degrees from vertical, with a side wall
// 0.4 mm thick measured square to the wall (curved and slanted faces) and a 2 mm floor.
// Original, MIT. Units are mm, Z is up.
const t = Math.tan((8 * Math.PI) / 180);
const w = 0.4 / Math.cos((8 * Math.PI) / 180); // the wall's width across, for 0.4 mm square to it
const R = (z) => 15 + z * t;
return cylinder(20, R(0), R(20)).subtract(cylinder(19, R(2) - w, R(21) - w).translateZ(2));

// Gate corpus case control-cone-pocket-from-below-40deg (cases.json has its expected verdicts).
// Control: a conical pocket 40 degrees from its axis, cut up into a 30 x 30 x 10 mm block from
// below (tip up, 4 mm under the top). Its wall leans 40 degrees past vertical, under the 45
// degree limit and its band. At the tip the tessellator's normals are not the surface's; until
// the overhang check used the triangles' own normals there, the tip read 52.7 degrees.
// Original, MIT. Units are mm, Z is up.
const R = 7 * Math.tan((40 * Math.PI) / 180);
return box(30, 30, 10).subtract(polygon([[0, 6], [0, -1], [R, -1]]).revolve());

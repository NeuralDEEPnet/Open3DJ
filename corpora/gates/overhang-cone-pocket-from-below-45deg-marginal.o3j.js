// Gate corpus case overhang-cone-pocket-from-below-45deg-marginal (cases.json has its expected verdicts).
// The pocket of control-cone-pocket-from-below-40deg at 45 degrees from its axis: its wall leans
// exactly 45 degrees past vertical, inside the 1 degree band, so a marginal failure. The tip read
// 58.1 degrees, an outright failure, until the overhang check used the triangles' own normals there.
// Original, MIT. Units are mm, Z is up.
const R = 7 * Math.tan((45 * Math.PI) / 180);
return box(30, 30, 10).subtract(polygon([[0, 6], [0, -1], [R, -1]]).revolve());

// Gate corpus case bridge-0.5-large-faces (cases.json has its expected verdicts).
// A Z-shaped part 200 mm long: two blocks, one low and one high, joined only by a bridge 0.5 mm
// thick, 1 mm long and 10 mm wide. The bridge's faces are parts of 100 mm faces, so sparse
// sampling of large faces would miss it. cases.json builds it along +Y, on its 200 x 20 mm side,
// so nothing overhangs.
// Original, MIT. Units are mm, Z is up.
const body = box(200, 10, 20).translate(100, 5, 0);
const top = box(100, 12, 11).translate(49.5, 5, 10.5);
const bottom = box(101.5, 12, 11).translate(149.25, 5, -1);
return body.subtract(top, bottom);

// Gate corpus case control-filleted-block (cases.json has its expected verdicts).
// Control: a 40 x 30 x 10 mm block with 5 mm fillets on its vertical edges and 2 mm on its top
// edges. The bottom edges stay sharp, so nothing overhangs.
// Original, MIT. Units are mm, Z is up.
return fillet(fillet(box(40, 30, 10), 5, { parallel: [0, 0, 1] }), 2, { atZ: 10 });

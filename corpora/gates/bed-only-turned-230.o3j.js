// Gate corpus case bed-only-turned-230 (cases.json has its expected verdicts).
// A 230 x 20 x 20 mm bar. It would fit the 220 x 220 mm bed on the diagonal, or stood on end, but
// the gate checks the part as designed (turned 0 or 90 degrees only), so it fails.
// Original, MIT. Units are mm, Z is up.
return box(230, 20, 20);

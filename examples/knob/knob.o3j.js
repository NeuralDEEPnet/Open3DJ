// Lathe-style knob: a revolved profile with a domed top, twelve grip flutes and a D-shaped
// bore for a 6 mm shaft. One part. Units are mm, Z is up.
const R = Param.number("Radius", 16, { min: 10, max: 30, unit: "mm" });
const H = Param.number("Height", 18, { min: 10, max: 40, unit: "mm" });
const flutes = Param.number("Flutes", 12, { min: 0, max: 24, integer: true });

// Sketch X is the radius and sketch Y the height. The top is a shallow arc centred on the
// axis, so it meets the axis square and the dome has a smooth pole (an arc that meets the
// axis at an angle makes a cone-like pole that STEP cannot carry).
const rimX = R - 3;
const domeR = (rimX * rimX + 4) / 4; // the circle through (rimX, H - 2) and (0, H) centred on the axis
const profile = path().moveTo(0, 0).lineH(R - 1).lineTo(R, 1).lineV(H - 5).lineTo(rimX, H - 2).arcTo(0, H, -domeR).close();
let knob = profile.revolve();

if (flutes > 0) {
  const flute = cylinder(H - 6, 1.6).translate(R + 0.6, 0, 2);
  knob = knob.subtract(circularPattern(flute, flutes));
}
// D bore: a 6 mm circle with a flat 1.5 mm from the axis, 12 mm deep from the bottom.
const dBore = cylinder(13, 3).translateZ(-1).intersect(box(6, 6, 14).translate(-1.5, 0, -1));
return knob.subtract(dBore).name("Knob").color("#2a9d8f");

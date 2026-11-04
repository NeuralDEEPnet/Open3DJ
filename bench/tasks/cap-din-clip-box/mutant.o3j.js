// Reference solution for cap-din-clip-box: a 45 x 60 x 90 mm enclosure body with a front lid,
// clipped onto 100 mm of 35 x 7.5 mm top-hat rail by two hooks that wrap the rail lips with
// 0.2 mm clearance. The rail runs along X; Y points out of the cabinet; Z is up.
// Original, MIT. Units are mm.
const bodyW = 45, bodyD = 60, bodyH = 90, wall = 2, lidT = 3;

// Simplified top-hat profile in sketch (s, y), s along world Z: crown, sides and lips 1 mm thick.
const profile = rect(27, 1).translate(0, 0.5)
  .add(rect(1, 7.5).translate(-13, 3.75), rect(1, 7.5).translate(13, 3.75), rect(5, 1).translate(-15, 7), rect(5, 1).translate(15, 7));
// Extrude along sketch Z, then turn so the extrusion runs along X and sketch Y stays Y.
const rail = profile.extrude(100).rotateY(90).translateX(-50);

const front = 7.5;
const body = box(bodyW, bodyD, bodyH).translate(0, front + bodyD / 2, -bodyH / 2)
  .subtract(box(bodyW - 2 * wall, bodyD, bodyH - 2 * wall).translate(0, front + wall + bodyD / 2, -bodyH / 2 + wall));
// Upper hook: a block over the lip edge and a nose behind the lip; the lower hook mirrors it.
const hook = box(bodyW, 2.6, 2.3).translate(0, 5 + 1.3, 17.7).add(box(bodyW, 1.7, 5).translate(0, 5 + 0.85, 15) /* MUTANT: the hook nose cuts into the rail lip */);
const clipped = body.add(hook, hook.clone().mirror([0, 0, 1]));
const lid = box(bodyW, lidT, bodyH).translate(0, front + bodyD + lidT / 2, -bodyH / 2);
return [
  { name: "Rail", shape: rail, color: "#adb5bd" },
  { name: "Body", shape: clipped, color: "#e9ecef" },
  { name: "Lid", shape: lid, color: "#ced4da" },
];

// Seeded envelope defect D12 (a narrow angle band): an arm turned about Z next to a fixed
// post. Two parts. The arm hits the post only within a few degrees of the post's angle, and
// only when it is long enough to reach it. Original test part for the Open3DJ envelope spike,
// MIT. Units are mm, Z is up.
const ang = Param.number("Angle", 20, { min: 0, max: 90, unit: "deg" });
const L = Param.number("Arm length", 30, { min: 20, max: 40, unit: "mm" });
const arm = box(L, 2, 5).translate(L / 2, 0, 0).rotateZ(ang);
const a = (47 * Math.PI) / 180;
const post = cylinder(5, 1).translate(25 * Math.cos(a), 25 * Math.sin(a), 0);
return [{ name: "Arm", shape: arm, color: "#5b6b7a" }, { name: "Post", shape: post, color: "#e07a5f" }];

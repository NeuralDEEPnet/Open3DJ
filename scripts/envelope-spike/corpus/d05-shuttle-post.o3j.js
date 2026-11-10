// Seeded envelope defect D05 (a clash band inside the range): a thin shuttle plate slides
// along X past a fixed stop post whose Y position is a parameter. Two parts. The shuttle hits
// the post only in a band of X near the post. Original test part for the Open3DJ envelope
// spike, MIT. Units are mm, Z is up.
const X = Param.number("Shuttle X", -20, { min: -30, max: 30, unit: "mm" });
const Y = Param.number("Post Y", 0, { min: -12, max: 12, unit: "mm" });
const shuttle = box(2, 10, 8).translate(X, 0, 0);
const post = cylinder(8, 1.5).translate(7, Y, 0);
return [{ name: "Shuttle", shape: shuttle, color: "#5b6b7a" }, { name: "Post", shape: post, color: "#e07a5f" }];

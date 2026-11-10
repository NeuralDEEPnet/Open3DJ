// Seeded envelope control C05: the shuttle and post of D05 with the shuttle's travel stopping
// 6 mm short of the post. Two parts that never touch. Original test part for the Open3DJ
// envelope spike, MIT. Units are mm, Z is up.
const X = Param.number("Shuttle X", -20, { min: -30, max: 0, unit: "mm" });
const Y = Param.number("Post Y", 0, { min: -12, max: 12, unit: "mm" });
const shuttle = box(2, 10, 8).translate(X, 0, 0);
const post = cylinder(8, 1.5).translate(7, Y, 0);
return [{ name: "Shuttle", shape: shuttle, color: "#5b6b7a" }, { name: "Post", shape: post, color: "#e07a5f" }];

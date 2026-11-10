// Seeded envelope control C10: a key sliding in a channel with the side gap equal to the
// clearance at every length (no drift), so it never drops below 0.2 mm. Two parts. Original
// test part for the Open3DJ envelope spike, MIT. Units are mm, Z is up.
const L = Param.number("Length", 60, { min: 40, max: 120, unit: "mm" });
const c = Param.number("Clearance", 0.3, { min: 0.2, max: 0.4, unit: "mm" });
const slotW = 10;
const channel = box(L, 20, 8).subtract(box(L + 2, slotW, 6).translate(0, 0, 3));
const key = box(20, slotW - 2 * c, 4).translate(0, 0, 3 + c);
return [{ name: "Channel", shape: channel, color: "#5b6b7a" }, { name: "Key", shape: key, color: "#e07a5f" }];

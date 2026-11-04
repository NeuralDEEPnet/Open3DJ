// Reference solution for cap-cable-organiser: a 100 x 40 x 25 mm block with five U-slots
// 6.4 mm wide on an 18 mm pitch, a 2 mm pad underneath, and five 6 mm cables lying in the
// slots 0.2 mm clear of the slot bottoms. Original, MIT. Units are mm, Z is up.
const L = 100, D = 40, H = 25, slotW = 6.4, depth = 12, pitch = 18, cableR = 3;
const xs = [-2, -1, 0, 1, 2].map((i) => i * pitch);
const bottomZ = H - depth;

// A U-slot: a round bottom plus straight sides up through the top, running along Y.
const uSlot = (x) => cylinder(D + 2, slotW / 2).pointAlong([0, 1, 0]).translate(x, -D / 2 - 1, bottomZ + slotW / 2)
  .add(box(slotW, D + 2, depth).translate(x, 0, bottomZ + slotW / 2));
const block = fillet(box(L, D, H), 3, { atZ: H, parallel: [1, 0, 0] }).subtract(xs.map(uSlot));
const pad = box(L, D, 2).translateZ(-2);
const cable = cylinder(120, cableR).pointAlong([0, 1, 0]).translateY(-60);
const cables = xs.map((x) => ({ name: "Cable", shape: cable.clone().translate(x, 0, bottomZ + slotW / 2), color: "#111111" }));

return [{ name: "Block", shape: block, color: "#bc6c25" }, { name: "Pad", shape: pad, color: "#343a40" }, ...cables];

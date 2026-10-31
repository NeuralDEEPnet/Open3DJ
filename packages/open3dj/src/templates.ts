// Starter scripts for `open3dj new`. Both are written for Open3DJ and run as they are; the
// CLI tests run them through the real job runner.

export const TEMPLATES = {
  part: `// A wall bracket: one part with parameters, two screw holes and rounded edges.
// Units are mm, Z is up. Run: open3dj run <this project>; then render and export.
const width = Param.number("Width", 60, { min: 30, max: 120, unit: "mm" });
const thick = Param.number("Thickness", 5, { min: 3, max: 12, unit: "mm" });
const size = Param.choice("Screw", "M4", ["M3", "M4", "M5"]);

const foot = box(width, 30, thick);
const wall = box(width, thick, 40).translate(0, 15 - thick / 2, 0);
const holes = [-1, 1].map((s) => lib.clearanceHole(size, { length: thick + 1 }).translate(s * (width / 2 - 10), -3, thick));
const bracket = foot.add(wall).subtract(holes);

return fillet(bracket, 1, { parallel: [1, 0, 0], minLength: width - 1 }).name("Bracket").color("#5b6b7a");
`,
  assembly: `// A small enclosure: a body, a lid seated on the rim with connectors, and four screws.
// The screws are clones, so the assembly shares one screw definition.
// Units are mm, Z is up. Run: open3dj run <this project>; then render and export.
const W = Param.number("Width", 80, { min: 50, max: 160, unit: "mm" });
const D = Param.number("Depth", 60, { min: 40, max: 120, unit: "mm" });
const H = Param.number("Height", 30, { min: 15, max: 80, unit: "mm" });
const wall = 2.4, lidT = 4;
const corners = [[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([sx, sy]) => [sx * (W / 2 - 7), sy * (D / 2 - 7)]);

const cavity = roundedRect(W - 2 * wall, D - 2 * wall, 2).extrude(H).translateZ(wall);
const bosses = corners.map(([x, y]) => cylinder(H - wall, 4.5).translate(x, y, wall));
const pockets = corners.map(([x, y]) => lib.heatSetPocket("M3").translate(x, y, H));
const body = roundedRect(W, D, 4).extrude(H).subtract(cavity).add(bosses).subtract(pockets)
  .withConnectors({ rim: connector.female("seat", { origin: [0, 0, H], axis: [0, 0, 1], up: [1, 0, 0] }) });

const holes = corners.map(([x, y]) => lib.clearanceHole("M3", { length: lidT + 1 }).translate(x, y, lidT));
const lid = roundedRect(W, D, 4).extrude(lidT).subtract(holes)
  .withConnectors({ under: connector.male("seat", { origin: [0, 0, 0], axis: [0, 0, -1], up: [1, 0, 0] }) })
  .matchTo(body, "under", "rim");

const screw = lib.bolt("M3", 8);
const screws = corners.map(([x, y]) => ({ name: "Screw", shape: screw.clone().translate(x, y, H + lidT) }));

return [{ name: "Body", shape: body, color: "#5b6b7a" }, { name: "Lid", shape: lid, color: "#00d4ff" }, ...screws];
`,
} as const;

export type TemplateName = keyof typeof TEMPLATES;

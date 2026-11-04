// H-det corpus: shell. The research spike found that reusing a warm occt-wasm instance broke
// bit-identity for shell (ARCHITECTURE.md section 8), so H-det runs these through the kernel's
// own shell: a tray with 6 mm vertical corner fillets hollowed to 2 mm walls (corner radii
// larger than the wall), and a closed cylinder hollowed to 1.5 mm with an open top.
// Original, MIT. Units are mm, Z is up.
const tray = fillet(box(60, 40, 30), 6, { parallel: [0, 0, 1] }).shell(2);
const cup = cylinder(40, 15).shell(1.5).translateX(60);
return [{ name: "Tray", shape: tray, color: "#5b6b7a" }, { name: "Cup", shape: cup, color: "#a8dadc" }];

// H-det corpus: offset. The DSL has no 3D offset yet (it arrives with tolerance(); see
// docs/DSL.md, Later entries), so this case drives the kernel's exact 2D offset through
// sketch.offset on curved and cornered profiles, grown and shrunk, then extrudes and combines
// them. The spike found offset results drifting on a warm kernel (ARCHITECTURE.md section 8).
// The ellipse case came back after the fix of 2026-10-28: ellipse(18, 10).offset(3) used to
// export a STEP file that re-imported as 0 solids (STEP_ROUNDTRIP_FAILED; see ops/build-log.md).
// Original, MIT. Units are mm, Z is up.
const starRing = star(7, 22, 12).offset(2).extrude(6)
  .subtract(star(7, 22, 12).offset(-1.5).extrude(8).translateZ(-1));
const oval = ngon(8, 16).offset(3).extrude(10).translateX(60)
  .subtract(roundedRect(30, 14, 3).offset(-1).extrude(12).translate(60, 0, 2));
const plate = roundedRect(50, 30, 6).offset(4).extrude(4).translateY(55)
  .subtract(slot(30, 8).offset(0.5).extrude(6).translate(0, 55, -1));
const ellipseRing = ellipse(18, 10).offset(3).extrude(10).translateY(-55)
  .subtract(ellipse(18, 10).offset(-2).extrude(12).translate(0, -55, -1));
return [{ name: "Star ring", shape: starRing }, { name: "Octagon cup", shape: oval }, { name: "Slotted plate", shape: plate }, { name: "Ellipse ring", shape: ellipseRing }];

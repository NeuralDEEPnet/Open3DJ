// Phone stand: a side profile extruded to width, with a front lip, a leaning backrest, a
// cable slot through the base and rounded long edges. One part. Units are mm, Z is up.
const W = Param.number("Width", 70, { min: 50, max: 120, unit: "mm" });

// Side profile in (Y, Z): base plate, backrest leaning back, phone ledge and front lip.
const side = polygon([
  [0, 0], [95, 0], [95, 6], [40, 6], [68, 78], [61, 81], [30, 6], [12, 6], [12, 16], [4, 16], [0, 10],
]);
// Extrude along sketch Z, then turn it so sketch X -> Y, sketch Y -> Z and the extrusion -> X.
const body = side.extrude(W).rotateX(90).rotateZ(90).translateX(-W / 2);

// The slot stays 3 mm clear of the ledge corners, so their 1.5 mm fillets do not run into it.
const cableSlot = slot(12, 10).rotate(90).translate(0, 21).extrude(8).translateZ(-1);
const lipNotch = box(12, 14, 12).translate(0, 6, 9);
const stand = body.subtract(cableSlot, lipNotch);

return fillet(stand, 1.5, { parallel: [1, 0, 0], minLength: W - 0.5 }).name("Phone stand").color("#264653");

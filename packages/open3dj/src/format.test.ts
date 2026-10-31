// The terminal layout of inspect fields=[selection] (open3dj inspect <project> --fields selection).
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatInspect } from "./format.ts";

const compute = { backend: "none" as const, device: "daemon", placement_reason: "test" };

test("inspect --fields selection prints what the person selected, or says nothing is", () => {
  const none = formatInspect({ status: "ok", compute, selection: { items: [], head: "r_0001", note: "Nothing is selected in open3dj view." } });
  assert.match(none, /^selection: none/m);
  const some = formatInspect({
    status: "ok", compute,
    selection: {
      rev: "r_0001", head: "r_0002", stale: true, items: [
        { path: "lid", def: "lid", kind: "face", element: "face:5", address: "lid@elem:face:5", ref: "lid.top" },
        { path: "screw#2", def: "screw", kind: "occurrence", address: "screw#2" },
        { path: "base", def: "base", kind: "edge", faces: ["face:3", "face:7"] },
      ],
    },
  });
  assert.equal(some, [
    "selection (r_0001, stale; head r_0002):",
    "  lid@elem:face:5 (lid.top)",
    "  screw#2",
    "  base: the edge between face:3 and face:7",
    "",
  ].join("\n"));
});

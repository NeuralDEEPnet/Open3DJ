// Keyboard shortcuts of the viewer, as pure functions (tested in Node).
//
// A letter means the same with Caps Lock on or off: the action follows the Shift key, not the
// case of e.key. Shortcuts are ignored only while a control takes typed text; a slider or a
// checkbox with focus keeps them working (the arrow keys still move the slider).

/** key (lower case) -> [action, action with Shift]. */
const KEYS = {
  f: ["fit", "fit-selection"],
  1: ["view-front"],
  2: ["view-top"],
  3: ["view-right"],
  4: ["view-iso"],
  p: ["projection"],
  h: ["hide", "show-all"],
  i: ["isolate"],
  e: ["edges"],
  m: ["markers"],
  d: ["drawing"],
  t: ["theme"],
  n: ["next-preset"],
  c: ["copy"],
  s: ["section", "screenshot"],
  x: ["xray"],
  r: ["measure"],
  o: ["overlay"],
  a: ["agent-frame", "agent-dismiss"],
  "?": ["help", "help"],
};

/** The action for a key press, or undefined. */
export function shortcutAction(key, shift) {
  if (typeof key !== "string" || key.length !== 1) return undefined;
  const entry = KEYS[key.toLowerCase()];
  if (!entry) return undefined;
  return shift ? entry[1] : entry[0];
}

const TEXT_INPUTS = new Set(["text", "search", "number", "email", "url", "password", "tel", "date", "datetime-local", "month", "time", "week"]);

/** True when target takes typed text, so letters must reach it rather than act as shortcuts. */
export function takesText(target) {
  if (!target || typeof target !== "object") return false;
  if (target.isContentEditable) return true;
  const tag = String(target.tagName ?? "").toUpperCase();
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") return TEXT_INPUTS.has(String(target.type ?? "text").toLowerCase());
  return false;
}

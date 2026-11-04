// Small colored status chips (W17). The colors live in css/app.css (.chip-ok, .chip-wait,
// .chip-go, .chip-info, .chip-bad, .chip-muted) and follow the light and dark theme.

// A new chip element (used in the past rides lists).
export function makeChip(text, kind) {
  const chip = document.createElement("span");
  chip.className = "chip chip-" + kind;
  chip.textContent = text;
  return chip;
}

// Updates a chip that already sits in the page: setChip(element, ["Waiting", "wait"]).
export function setChip(element, pair) {
  if (!element) return;
  element.className = "chip chip-" + pair[1];
  element.textContent = pair[0];
}

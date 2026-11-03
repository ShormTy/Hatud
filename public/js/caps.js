// Turns everything typed in a text box into CAPITAL LETTERS
// (used for the vehicle type and the plate number).
export function makeCaps(input) {
  if (!input) return;
  input.addEventListener("input", () => {
    const start = input.selectionStart;
    const end = input.selectionEnd;
    input.value = input.value.toUpperCase();
    try {
      input.setSelectionRange(start, end); // keep the cursor where it was
    } catch (error) {
      // some phones do not allow this: nothing to do
    }
  });
}

// A confirmation popup that matches the app (instead of the browser's plain box).
//   if (!(await confirmBox({ title: "Cancel?", message: "…", okText: "Yes", cancelText: "No" }))) return;
// It resolves to true (OK) or false (Cancel, Escape, or a tap outside the box).

export function confirmBox({ title, message, okText = "OK", cancelText = "Cancel", danger = false }) {
  return new Promise((resolve) => {
    const previouslyFocused = document.activeElement;

    const overlay = document.createElement("div");
    overlay.className = "dialog-overlay";

    const box = document.createElement("div");
    box.className = "dialog-box";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");

    const heading = document.createElement("p");
    heading.className = "dialog-title";
    heading.textContent = title;
    box.appendChild(heading);

    if (message) {
      const text = document.createElement("p");
      text.className = "dialog-message";
      text.textContent = message;
      box.appendChild(text);
    }

    const buttons = document.createElement("div");
    buttons.className = "dialog-buttons";

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "secondary";
    cancel.textContent = cancelText;

    const ok = document.createElement("button");
    ok.type = "button";
    ok.className = danger ? "primary danger" : "primary";
    ok.textContent = okText;

    buttons.appendChild(cancel);
    buttons.appendChild(ok);
    box.appendChild(buttons);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    function close(answer) {
      document.removeEventListener("keydown", onKey, true);
      overlay.remove();
      if (previouslyFocused && previouslyFocused.focus) previouslyFocused.focus();
      resolve(answer);
    }
    function onKey(event) {
      if (event.key === "Escape") { event.preventDefault(); close(false); }
    }

    ok.addEventListener("click", () => close(true));
    cancel.addEventListener("click", () => close(false));
    overlay.addEventListener("click", (event) => { if (event.target === overlay) close(false); });
    document.addEventListener("keydown", onKey, true);
    cancel.focus(); // the safe choice has the focus
  });
}

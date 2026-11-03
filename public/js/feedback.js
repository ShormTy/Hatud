// The feedback link at the bottom of the student and driver pages.
// The owner pastes the Google Form address below, between the quotes
// (it must start with https://). Until then the link says the form is not ready.
const FEEDBACK_URL = "https://forms.gle/hwNzD6Lp22T8eHJB7";

const link = document.getElementById("feedback-link");
if (link) {
  if (FEEDBACK_URL.startsWith("https://")) {
    link.href = FEEDBACK_URL;
  } else {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      window.alert("The feedback form is not ready yet.");
    });
  }
}

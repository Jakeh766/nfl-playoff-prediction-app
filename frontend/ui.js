let accountModalReturnFocus = null;

function accountModalIsOpen() {
  return !elements.accountDialog.hidden;
}

function accountModalFocusableElements() {
  return Array.from(elements.accountDialog.querySelectorAll(
    'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )).filter((element) => !element.closest(".hidden") && !element.hidden);
}

function setAccountModalBackgroundInert(isInert) {
  // Only our page chrome belongs to the modal background. Password managers
  // append their clickable autofill menus to body as separate elements.
  document.querySelectorAll(
    "body > #site-header, body > main, body > #toast, body > #site-footer",
  ).forEach((element) => {
    if (isInert) {
      if (!element.inert) {
        element.inert = true;
        element.dataset.accountModalInert = "true";
      }
    } else if (element.dataset.accountModalInert === "true") {
      element.inert = false;
      delete element.dataset.accountModalInert;
    }
  });
}

function openAccountModal(initialFocus = null) {
  if (accountModalIsOpen()) return;
  accountModalReturnFocus = document.activeElement;
  elements.accountDialog.hidden = false;
  elements.accountDialog.setAttribute("aria-hidden", "false");
  document.body.classList.add("account-modal-open");
  setAccountModalBackgroundInert(true);
  const focusTarget = initialFocus || elements.closeAccountDialog;
  requestAnimationFrame(() => focusTarget?.focus());
}

function closeAccountModal({ restoreFocus = true } = {}) {
  if (!accountModalIsOpen()) return;
  elements.accountDialog.hidden = true;
  elements.accountDialog.setAttribute("aria-hidden", "true");
  document.body.classList.remove("account-modal-open");
  setAccountModalBackgroundInert(false);
  elements.accountDialog.dispatchEvent(new Event("close"));
  if (restoreFocus && accountModalReturnFocus?.isConnected) {
    accountModalReturnFocus.focus();
  }
  accountModalReturnFocus = null;
}

elements.accountDialog.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    closeAccountModal();
    return;
  }
  if (event.key !== "Tab") return;
  const focusable = accountModalFocusableElements();
  if (!focusable.length) {
    event.preventDefault();
    return;
  }
  const first = focusable[0];
  const last = focusable.at(-1);
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
});


let toastTimer;

function setPasswordVisibility(toggle, visible) {
  const input = document.getElementById(toggle.getAttribute("aria-controls"));
  if (!input) return;
  input.type = visible ? "text" : "password";
  toggle.setAttribute("aria-pressed", String(visible));
  toggle.setAttribute("aria-label", visible ? "Hide password" : "Show password");
}

function resetPasswordVisibility(container = document) {
  container.querySelectorAll("[data-password-toggle]").forEach((toggle) => {
    setPasswordVisibility(toggle, false);
  });
}

function showToast(message) {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  toastTimer = setTimeout(() => elements.toast.classList.remove("show"), 2800);
}

function explainNameValidation(input, maximumLength) {
  input.setCustomValidity("");
  if (input.validity.tooShort || input.validity.tooLong) {
    input.setCustomValidity(`Use 3–${maximumLength} characters.`);
  } else if (input.validity.patternMismatch) {
    input.setCustomValidity(
      "Use letters, numbers, spaces, periods, apostrophes, underscores, or hyphens.",
    );
  }
}

function openPrediction(scrollToPredictor = true) {
  if (PAGE === "picks") {
    loadPredictionIntoEditor(scrollToPredictor);
  } else {
    window.location.assign(sportUrl(LOCAL_PREVIEW ? "/picks.html" : "/picks"));
  }
}

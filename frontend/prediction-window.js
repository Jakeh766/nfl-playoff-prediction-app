let predictionCountdownTimer;

function predictionLockDateLabel(lockAt) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(lockAt));
}

function setPredictionEditingLocked(locked, message = "") {
  state.predictionsLocked = locked;
  if (PAGE === "picks" && locked && state.savedPrediction && predictionHasUnsavedChanges()) {
    // At the deadline, the persisted bracket becomes the read-only view.
    loadPredictionIntoEditor(false);
  }
  document.body.classList.toggle("predictions-locked", locked);

  if (elements.predictionLockNotice) {
    elements.predictionLockNotice.classList.remove("hidden");
    elements.predictionLockNotice.classList.toggle("locked", locked);
    elements.predictionLockTitle.textContent = locked
      ? "Brackets are locked."
      : "Picks are open.";
    elements.predictionLockMessage.textContent = message;
  }

  [
    elements.randomizeBracket,
    elements.buildBracket,
    elements.savePrediction,
  ].forEach((control) => {
    if (control) control.disabled = locked;
  });

  if (PAGE === "picks" && elements.afcSeeds?.childElementCount) {
    renderSeedSelectors();
    if (state.bracketBuilt) renderBracket();
  }
  if (PAGE === "picks") updateSaveState();
}

function renderPredictionCountdown() {
  if (!state.predictionWindow || !elements.kickoffCountdown) return;

  if (state.predictionWindow.devNflUnlocked) {
    elements.kickoffCountdown.classList.add("dev-unlocked");
    elements.kickoffCountdownLabel.textContent = "DEV BRACKETS OPEN";
    elements.devUnlockHeadline.classList.remove("hidden");
    elements.kickoffLockTime.dateTime = state.predictionWindow.lockAt;
    elements.kickoffLockTime.textContent = `Original deadline: ${predictionLockDateLabel(state.predictionWindow.lockAt)}`;
    elements.countdownStatus.textContent = "NFL picks are open for testing on dev. Production remains locked.";
    return;
  }

  const lockTime = new Date(state.predictionWindow.lockAt).getTime();
  const now = Date.now() + state.predictionClockOffset;
  const remaining = Math.max(0, lockTime - now);
  const totalSeconds = Math.floor(remaining / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  elements.countdownDays.textContent = String(days).padStart(2, "0");
  elements.countdownHours.textContent = String(hours).padStart(2, "0");
  elements.countdownMinutes.textContent = String(minutes).padStart(2, "0");
  elements.countdownSeconds.textContent = String(seconds).padStart(2, "0");

  if (!remaining && !state.predictionsLocked) {
    state.predictionWindow.locked = true;
    setPredictionEditingLocked(true, "The regular season has started. Saved brackets are now read-only.");
  }

  elements.countdownStatus.textContent = remaining
    ? "Finish and save your bracket before the season starts."
    : "";
  elements.kickoffCountdownLabel.textContent = remaining
    ? "BRACKETS LOCK IN"
    : "Brackets are locked";
  elements.kickoffCountdown.classList.toggle("locked", !remaining);
}

async function initializePredictionWindow() {
  try {
    const response = await fetch(sportUrl("/api/prediction-window"), { cache: "no-store" });
    if (!response.ok) throw new Error("Prediction deadline unavailable");
    const windowState = await response.json();
    if (!windowState.lockAt || !Number.isFinite(windowState.serverTime)) {
      throw new Error("Invalid prediction deadline response");
    }

    state.predictionWindow = windowState;
    state.predictionClockOffset = windowState.serverTime - Date.now();
    const label = predictionLockDateLabel(windowState.lockAt);
    if (elements.kickoffLockTime && !windowState.devNflUnlocked) {
      elements.kickoffLockTime.dateTime = windowState.lockAt;
      elements.kickoffLockTime.textContent = `Deadline: ${label}`;
    }
    setPredictionEditingLocked(
      Boolean(windowState.locked),
      windowState.devNflUnlocked
        ? "NFL brackets are open for testing on dev. Production remains locked."
        : windowState.locked
        ? `The ${SPORT.toUpperCase()} regular season has started. Saved brackets are read-only.`
        : `Create or change your bracket until ${label}.`,
    );
    renderPredictionCountdown();
    clearInterval(predictionCountdownTimer);
    if (!windowState.devNflUnlocked) {
      predictionCountdownTimer = setInterval(renderPredictionCountdown, 1000);
    }
  } catch (error) {
    if (elements.countdownStatus) {
      elements.countdownStatus.textContent = "The season countdown is temporarily unavailable.";
      elements.countdownStatus.title = error.message;
    }
    if (!LOCAL_PREVIEW) {
      setPredictionEditingLocked(
        true,
        "We could not verify whether picks are still open. Refresh before editing your bracket.",
      );
    }
  }
}

const scoringTabs = Array.from(document.querySelectorAll('[role="tablist"][aria-label="Scoring option"] [role="tab"]'));

function selectScoringTab(selectedTab) {
  scoringTabs.forEach((tab) => {
    const selected = tab === selectedTab;
    tab.classList.toggle("active", selected);
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
    const panel = document.getElementById(tab.getAttribute("aria-controls"));
    panel.hidden = !selected;
    panel.classList.toggle("hidden", !selected);
  });
}

scoringTabs.forEach((tab, index) => {
  tab.addEventListener("click", () => selectScoringTab(tab));
  tab.addEventListener("keydown", (event) => {
    let nextIndex;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % scoringTabs.length;
    else if (event.key === "ArrowLeft") nextIndex = (index - 1 + scoringTabs.length) % scoringTabs.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = scoringTabs.length - 1;
    else return;
    event.preventDefault();
    selectScoringTab(scoringTabs[nextIndex]);
    scoringTabs[nextIndex].focus();
  });
});

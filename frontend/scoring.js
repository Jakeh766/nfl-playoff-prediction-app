const scoringTabs = Array.from(document.querySelectorAll('[role="tablist"][aria-label="Scoring option"] [role="tab"]'));

if (IS_NBA) {
  const classic = document.querySelector('#classic-scoring-panel tbody');
  classic.innerHTML = `
    <tr><td>Correct playoff team</td><td>5</td><td>80</td></tr>
    <tr><td>Exact playoff seed bonus</td><td><ul class="seed-point-tiers" aria-label="Exact playoff seed bonus points"><li><span>#1 seed</span><strong>+6</strong></li><li><span>#2–#4 seeds</span><strong>+4</strong></li><li><span>#5–#8 seeds</span><strong>+3</strong></li></ul></td><td>60</td></tr>
    <tr><td>Correct first-round series winner</td><td>5</td><td>40</td></tr>
    <tr><td>Correct conference semifinal winner</td><td>10</td><td>40</td></tr>
    <tr><td>Correct conference champion</td><td>20</td><td>40</td></tr>
    <tr><td>Correct NBA Finals champion</td><td>40</td><td>40</td></tr>`;
  document.querySelector('#classic-scoring-panel .scoring-note').innerHTML = `
    <h3>Later picks stay alive.</h3>
    <p>Points follow the team advancing, even when its opponent differs from your prediction.</p>
    <p>Exact-seed points are a bonus on top of the 5 points for a correct playoff team. A correctly predicted #1 seed earns 11 points total: 5 for making the playoffs and 6 for its seed.</p>
    <p>Predict the final eight playoff teams per conference after the Play-In. Division winners and Play-In games are not scored. Each series is one pick; individual games and series lengths are not scored.</p>`;
  document.querySelector('#vegas-scoring-panel tbody').innerHTML = `
    <tr><td>Playoff team</td><td>5 × multiplier</td></tr>
    <tr><td>Exact #1 seed bonus</td><td>6 × multiplier</td></tr>
    <tr><td>Exact #2–#4 seed bonus</td><td>4 × multiplier</td></tr>
    <tr><td>Exact #5–#8 seed bonus</td><td>3 × multiplier</td></tr>
    <tr><td>First-round winner</td><td>5 × multiplier</td></tr>
    <tr><td>Conference semifinal winner</td><td>10 × multiplier</td></tr>
    <tr><td>Conference champion</td><td>20 × multiplier</td></tr>
    <tr><td>NBA Finals champion</td><td>40 × multiplier</td></tr>`;
  document.querySelector('#vegas-scoring-panel .scoring-note').innerHTML = `
    <h3>Win totals set the weight.</h3>
    <div class="scoring-formula"><strong>1 + 0.02 × (41 − win total)</strong></div>
    <p id="vegas-weight-explanation">Multiply each Classic award by this value. A 41-win team is neutral. Each win below 41 adds 0.02; each win above subtracts 0.02.</p>
    <p>Exact-seed bonuses are separate awards added to the playoff-team points. Both are multiplied by the predicted team’s weight.</p>
    <p>For example, a hypothetical 31-win team earns 1.20× its Classic points. Each award is rounded to hundredths before adding. Incorrect picks earn zero.</p>
    <p>Values use our frozen 2026–27 <a href="${NBA_SEASON.sourceUrl}">BetMGM snapshot</a>, captured September 22, 2026. Live projections never change scoring values.</p>`;
}

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

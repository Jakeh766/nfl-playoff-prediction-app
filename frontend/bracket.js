function buildConferenceGames(seeds, picksByConference, conference) {
  const picks = picksByConference?.[conference] || {};
  const seed = (number) => {
    const name = seeds?.[conference]?.[number - 1];
    return name ? { name, seed: number } : null;
  };
  if (typeof IS_NBA !== "undefined" && IS_NBA) {
    const wildCard = [[1, 8], [4, 5], [2, 7], [3, 6]].map(([a, b]) => ({
      id: `r1-${a}-${b}`, title: `First Round · ${a} vs ${b}`, teams: [seed(a), seed(b)],
    }));
    const winner = game => game.teams.every(Boolean)
      ? game.teams.find(team => team.name === picks[game.id]) || null : null;
    const divisional = [0, 2].map((offset, index) => ({
      id: `div-${index + 1}`, title: "Conference Semifinal",
      teams: [winner(wildCard[offset]), winner(wildCard[offset + 1])],
    }));
    return { wildCard, divisional, championship: [{
      id: "conf", title: `${conference} Finals`, teams: divisional.map(winner),
    }] };
  }
  const wildCard = [
    { id: "wc-2-7", title: "Wild Card · 2 vs 7", teams: [seed(2), seed(7)] },
    { id: "wc-3-6", title: "Wild Card · 3 vs 6", teams: [seed(3), seed(6)] },
    { id: "wc-4-5", title: "Wild Card · 4 vs 5", teams: [seed(4), seed(5)] },
  ];
  const wildCardWinners = wildCard.map((game) =>
    game.teams.find((team) => team?.name === picks[game.id]) || null,
  );
  const remaining = [seed(1), ...wildCardWinners]
    .filter(Boolean)
    .sort((a, b) => a.seed - b.seed);
  const divisional = remaining.length === 4
    ? [
        {
          id: "div-1",
          title: "Divisional · High vs Low",
          teams: [remaining[0], remaining[3]],
        },
        {
          id: "div-2",
          title: "Divisional",
          teams: [remaining[1], remaining[2]],
        },
      ]
    : [
        { id: "div-1", title: "Divisional · High vs Low", teams: [seed(1), null] },
        { id: "div-2", title: "Divisional", teams: [null, null] },
      ];
  const divisionalWinners = divisional.map((game) =>
    game.teams.find((team) => team?.name === picks[game.id]) || null,
  );
  const championship = [
    {
      id: "conf",
      title: `${conference} Championship`,
      teams: divisionalWinners,
    },
  ];
  return { wildCard, divisional, championship };
}

function teamsInBracketDisplayOrder(teams) {
  if (typeof IS_NBA === "undefined" || !IS_NBA) return teams;
  return [...teams].sort((first, second) =>
    (first?.seed ?? Infinity) - (second?.seed ?? Infinity),
  );
}

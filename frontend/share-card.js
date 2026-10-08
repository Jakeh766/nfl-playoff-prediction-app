// Full bracket export using the site's typography, colors, and trophy asset.
// Only the existing public ESPN logo paths are eligible for export.
export async function loadShareLogos(model, logoUrl, { timeoutMs = 4000 } = {}) {
  const logos = new Map();
  if (typeof logoUrl !== "function") return logos;
  const names = new Set(model.conferences.flatMap(c => c.seeds.filter(Boolean).map(t => t.name)));
  const allowed = new RegExp(`^https://a\\.espncdn\\.com/i/teamlogos/${model.sport.toLowerCase()}/500/[a-z0-9]{2,4}\\.png$`);
  await Promise.all([...names].map(async name => {
    let url;
    try { url = logoUrl(name); } catch (_error) { return; }
    if (typeof url !== "string" || !allowed.test(url)) return;
    const logo = new Image();
    // Anonymous CORS prevents external images from tainting the PNG canvas.
    logo.crossOrigin = "anonymous";
    logo.referrerPolicy = "no-referrer";
    const loaded = await new Promise(resolve => {
      const finish = value => {
        clearTimeout(timer);
        logo.onload = logo.onerror = null;
        resolve(value);
      };
      const timer = setTimeout(() => { finish(false); logo.src = ""; }, timeoutMs);
      logo.onload = () => finish(Boolean(logo.naturalWidth && logo.naturalHeight));
      logo.onerror = () => finish(false);
      logo.src = url;
    });
    if (loaded) logos.set(name, logo);
  }));
  return logos;
}

export function shareTeamName(name) {
  if (!name) return "TBD";
  return name.endsWith("Trail Blazers") ? "Trail Blazers" : name.split(" ").at(-1);
}

export async function renderShareCard(model, { logoUrl } = {}) {
  const logoPromise = loadShareLogos(model, logoUrl);
  await Promise.all([
    document.fonts?.load('500 60px "Oswald"'),
    document.fonts?.load('700 32px "DM Sans"'),
  ]);
  const mark = new Image();
  mark.src = "/assets/predict-playoffs-mark.svg";
  await mark.decode().catch(() => {});
  const logos = await logoPromise;
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 630;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Your browser could not generate an image. Please try again.");
  const ink = "#10223a", muted = "#566479", accent = "#e33b3f", line = "#dcd9d1";
  ctx.fillStyle = "#f5f3ee";
  ctx.fillRect(0, 0, 1200, 630);
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, 1200, 8);
  function text(value, x, y, size, color = ink, maxWidth = 1136, display = false) {
    ctx.fillStyle = color;
    let fitted = size;
    do {
      ctx.font = display ? `500 ${fitted}px "Oswald", sans-serif` : `700 ${fitted}px "DM Sans", sans-serif`;
      if (ctx.measureText(value).width <= maxWidth || fitted <= 10) break;
      fitted -= 1;
    } while (true);
    ctx.fillText(value, x, y, maxWidth);
  }
  function wrapped(value, x, y, width, size = 14, color = ink, display = false, align = "left") {
    ctx.font = display ? `500 ${size}px "Oswald", sans-serif` : `700 ${size}px "DM Sans", sans-serif`;
    const words = value.split(" ");
    let first = words.shift() || "";
    while (words.length && ctx.measureText(`${first} ${words[0]}`).width <= width) first += ` ${words.shift()}`;
    const second = words.join(" ");
    ctx.textAlign = align;
    text(first, x, second ? y - 7 : y, size, color, width, display);
    if (second) text(second, x, y + 10, size, color, width, display);
    ctx.textAlign = "left";
  }
  function box(x, y, width, height, fill = "#fffefa") {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, width, height, 6);
    else ctx.rect(x, y, width, height);
    ctx.fillStyle = fill;
    ctx.fill();
  }
  text(model.player, 32, 49, 27, ink, 600);
  ctx.textAlign = "right";
  text(`${model.sport} · ${model.season}`, 1168, 52, 25, ink, 400);
  ctx.textAlign = "left";
  text("My playoff bracket", 32, 91, 33, ink, 400, true);
  if (model.kind === "results") {
    ctx.textAlign = "right";
    const total = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(model.total);
    text(`${model.rank ? `#${model.rank} overall · ` : ""}${total} points · ${model.mode}`, 1168, 87, 22, ink, 720);
    ctx.textAlign = "left";
  }
  ctx.fillStyle = line;
  ctx.fillRect(32, 108, 1136, 1);

  const width = 144, height = 72;
  const columns = [[32, 196, 360], [1024, 860, 696]];
  const roundCenters = [[224, 312, 400, 488], [268, 444], [356]];
  const positioned = model.conferences.map((conference, side) => {
    const first = conference.rounds[0].games;
    const bye = model.sport === "NFL" ? { id: "bye", teams: [null, conference.seeds[0]],
      selected: conference.seeds[0]?.name || "", bye: true } : null;
    return [bye ? [bye, ...first] : first, conference.rounds[1].games, conference.rounds[2].games]
      .map((games, round) => games.map((game, index) => ({ ...game, x: columns[side][round],
        y: roundCenters[round][index] - height / 2, side, width })));
  });
  const finalTeams = model.matchup.map((name, side) =>
    model.conferences[side].seeds.find(t => t?.name === name) || (name ? { name, seed: null } : null));
  const final = { teams: finalTeams, selected: model.champion, x: 522, y: 320, width: 156 };
  const selectedRow = game => game.teams.findIndex(t => t?.name === game.selected);
  const rowY = (game, row) => game.y + row * 36 + 18;
  function connect(source, target, targetRow, side) {
    const row = selectedRow(source);
    if (row < 0) return;
    const fromX = side === 0 ? source.x + source.width : source.x;
    const toX = side === 0 ? target.x : target.x + target.width;
    const middle = (fromX + toX) / 2;
    ctx.beginPath();
    ctx.moveTo(fromX, rowY(source, row));
    ctx.lineTo(middle, rowY(source, row));
    ctx.lineTo(middle, rowY(target, targetRow));
    ctx.lineTo(toX, rowY(target, targetRow));
    ctx.strokeStyle = "#536a84";
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  positioned.forEach((rounds, side) => {
    rounds.slice(1).forEach((targets, index) => targets.forEach(target => target.teams.forEach((team, row) => {
      if (!team) return;
      const source = rounds[index].find(game => game.selected === team.name);
      if (source) connect(source, target, row, side);
    })));
    const source = rounds[2][0];
    if (source && finalTeams[side]?.name === source.selected) connect(source, final, side, side);
  });

  function drawLogo(name, x, y, size) {
    const logo = logos.get(name);
    if (!logo) return false;
    // A pale plate keeps every team's logo visible on selected navy rows.
    box(x, y, size, size, "#fffefa");
    const inset = 2;
    const scale = Math.min((size - inset * 2) / logo.naturalWidth, (size - inset * 2) / logo.naturalHeight);
    const w = logo.naturalWidth * scale, h = logo.naturalHeight * scale;
    ctx.drawImage(logo, x + (size - w) / 2, y + (size - h) / 2, w, h);
    return true;
  }

  function drawGame(game) {
    box(game.x, game.y, game.width, height);
    ctx.save();
    ctx.clip();
    game.teams.forEach((team, row) => {
      const top = game.y + row * 36;
      const selected = Boolean(team && team.name === game.selected);
      if (selected) {
        ctx.fillStyle = ink;
        ctx.fillRect(game.x, top, game.width, 36);
      }
      if (game.bye && row === 0) {
        text("First-round bye", game.x + 10, top + 23, 13, muted, game.width - 20);
        return;
      }
      text(String(team?.seed || "—"), game.x + 7, top + 24, 14, selected ? "#dbe7f6" : muted, 14);
      const hasLogo = drawLogo(team?.name, game.x + 23, top + 5, 26);
      const nameX = game.x + (hasLogo ? 55 : 25);
      text(shareTeamName(team?.name), nameX, top + 24, 16,
        selected ? "#fffefa" : muted, game.x + game.width - nameX - 7);
    });
    ctx.restore();
    ctx.beginPath();
    ctx.moveTo(game.x, game.y + 36);
    ctx.lineTo(game.x + game.width, game.y + 36);
    ctx.strokeStyle = line;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  model.conferences.forEach((conference, side) => {
    const color = side === 0 ? "#e33b3f" : "#1859a9";
    text(conference.name, side === 0 ? 32 : 1024, 143, 27, color, width, true);
    const labels = model.sport === "NBA" ? ["First Round", "Semifinals", `${conference.name} Finals`]
      : ["Wild Card", "Divisional", `${conference.name} Championship`];
    labels.forEach((label, round) => text(label, columns[side][round], 171, 14, muted, width));
    positioned[side].flat().forEach(drawGame);
  });
  if (mark.naturalWidth) ctx.drawImage(mark, 580, 218, 40, 40);
  ctx.textAlign = "center";
  text(model.final, 600, 294, 29, ink, 156, true);
  ctx.textAlign = "left";
  drawGame(final);
  ctx.textAlign = "center";
  text("Champion pick", 600, 421, 16, ink, 156, true);
  const championLogo = drawLogo(model.champion, 576, 433, 48);
  wrapped(shareTeamName(model.champion), 600, championLogo ? 510 : 466, 156, 29, ink, true, "center");
  const statuses = { alive: "Still in contention", eliminated: "Eliminated", won: "Champion confirmed" };
  if (model.kind === "results" && model.championStatus) {
    ctx.textAlign = "center";
    text(statuses[model.championStatus], 600, championLogo ? 536 : 500, 13,
      model.championStatus === "eliminated" ? "#b7202d" : "#0d3972", 156);
  }
  ctx.textAlign = "left";
  ctx.fillStyle = line;
  ctx.fillRect(32, 556, 1136, 1);
  if (mark.naturalWidth) ctx.drawImage(mark, 32, 575, 32, 32);
  text("PREDICT PLAYOFFS", mark.naturalWidth ? 76 : 32, 602, 25, ink, 350, true);
  ctx.textAlign = "right";
  text("predictplayoffs.com", 1168, 601, 20, ink, 245);
  ctx.textAlign = "left";
  canvas.setAttribute("role", "img");
  const description = model.conferences.map(c => `${c.name}: ${c.seeds.filter(Boolean).map(t => `seed ${t.seed} ${t.name}`).join(", ")}. ${c.rounds.map(round => `${round.key}: ${round.games.map(g => `${g.teams.map(t => t?.name || "TBD").join(" versus ")}, pick ${g.selected || "TBD"}`).join("; ")}`).join(". ")}`).join(". ");
  canvas.setAttribute("aria-label", `${model.player}, ${model.sport} ${model.season}. Full playoff bracket. ${model.kind === "results" ? `${model.rank ? `Rank ${model.rank} overall. ` : ""}${model.total} points, ${model.mode}. ` : ""}${description}. ${model.final} champion pick: ${model.champion}. ${model.championStatus || ""} Predict Playoffs.`);
  return canvas;
}

export function canvasPng(canvas) {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Image generation failed. Please try again.")), "image/png"));
}

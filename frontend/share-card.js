// Canvas uses the site's own font families, colors, and same-origin trophy asset.
// Team names are drawn as text: remote team logos cannot taint PNG export.
export async function renderShareCard(model) {
  await Promise.all([
    document.fonts?.load('500 60px "Oswald"'),
    document.fonts?.load('700 32px "DM Sans"'),
  ]);
  const mark = new Image();
  mark.src = "/assets/predict-playoffs-mark.svg";
  await mark.decode().catch(() => {});
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 630;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Your browser could not generate an image. Copy the public link instead.");
  const ink = "#10223a", muted = "#647084", accent = "#e33b3f";
  ctx.fillStyle = "#f5f3ee";
  ctx.fillRect(0, 0, 1200, 630);
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, 1200, 8);
  function text(value, x, y, size, color = ink, maxWidth = 1072, display = false) {
    ctx.fillStyle = color;
    let fitted = size;
    do {
      ctx.font = display ? `500 ${fitted}px "Oswald", sans-serif` : `700 ${fitted}px "DM Sans", sans-serif`;
      if (ctx.measureText(value).width <= maxWidth || fitted <= 18) break;
      fitted -= 1;
    } while (true);
    ctx.fillText(value, x, y, maxWidth);
  }
  text(model.player, 64, 92, 40, ink, 750);
  ctx.textAlign = "right";
  text(`${model.sport} · ${model.season}`, 1136, 89, 28, muted, 310);
  ctx.textAlign = "left";
  if (model.kind === "results") {
    text(model.rank ? `#${model.rank} overall` : "Overall standings", 64, 194, 62, ink, 1072, true);
    text(`${new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(model.total)} points`, 64, 301, 86, ink, 1072, true);
    text(`${model.mode} scoring · Current results`, 66, 343, 24, muted);
    text(`Champion pick: ${model.champion || "TBD"}`, 64, 422, 34, ink, 1072);
    const statuses = { alive: "Still in contention", eliminated: "Eliminated", won: "Champion confirmed" };
    if (model.championStatus) text(statuses[model.championStatus], 64, 464, 24, model.championStatus === "eliminated" ? "#b7202d" : "#0d3972");
  } else {
    text(`My ${model.final} champion`, 64, 163, 27, muted);
    text(model.champion || "Champion to be decided", 64, 245, 68, ink, 1072, true);
    if (model.matchup.every(Boolean)) {
      text(`${model.final} matchup`, 64, 298, 22, muted);
      text(model.matchup.join(" vs. "), 64, 342, 32, ink, 1072);
    }
    model.seeds.forEach((seed, index) => {
      const x = 64 + index * 560;
      text(`${seed.conference} #1 seed`, x, 420, 22, muted, 510);
      text(seed.team || "TBD", x, 465, 34, ink, 510, true);
    });
  }
  ctx.fillStyle = "#dcd9d1";
  ctx.fillRect(64, 512, 1072, 1);
  if (mark.naturalWidth) ctx.drawImage(mark, 64, 543, 48, 48);
  text("PREDICT PLAYOFFS", mark.naturalWidth ? 128 : 64, 579, 30, ink, 650, true);
  ctx.textAlign = "right";
  text("predictplayoffs.com", 1136, 579, 25, ink, 400);
  ctx.textAlign = "left";
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", `${model.player}, ${model.sport} ${model.season}. ${model.kind === "results" ? `${model.rank ? `Rank ${model.rank} overall. ` : ""}${model.total} points, ${model.mode}. ` : ""}${model.final} champion pick: ${model.champion}. ${model.kind === "picks" ? `${model.matchup.join(" versus ")}. ${model.seeds.map(s => `${s.conference} number one seed: ${s.team}`).join(". ")}.` : model.championStatus || ""} Predict Playoffs.`);
  return canvas;
}

export function canvasPng(canvas) {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Image generation failed. Copy the public link instead.")), "image/png"));
}

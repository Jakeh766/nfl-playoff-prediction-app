// Legacy extraction tests read the relocated responsibilities as one source.
// Page-loading tests separately verify the actual script order and dependencies.
const fs = require("node:fs");
const path = require("node:path");
const read = name => fs.readFileSync(path.join(__dirname, "../frontend", name), "utf8");
const files = {
  "app.js": ["teams.js", "app.js", "ui.js", "auth.js", "group-navigation.js", "api.js", "prediction-window.js"],
  "leaderboard.js": ["bracket.js", "public-bracket.js", "standings.js", "leaderboard-table.js", "leaderboard.js"],
  "groups.js": ["group-actions.js", "groups.js"],
  "bootstrap.js": ["ui.js", "bootstrap.js"],
};
module.exports = name => (files[name] || [name]).map(read).join("\n");

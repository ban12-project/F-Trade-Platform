const { readFileSync } = require("node:fs");
const { join } = require("node:path");

// Fixed local assets only. Never accept a path or page program from a task.
module.exports = {
  inbox: readFileSync(join(__dirname, "facebook-inbox-page.js"), "utf8"),
  publication: readFileSync(join(__dirname, "facebook-publication-page.js"), "utf8"),
};

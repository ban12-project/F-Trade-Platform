const { readFileSync } = require("node:fs");
const { join } = require("node:path");
module.exports = readFileSync(join(__dirname, "login-page.js"), "utf8");

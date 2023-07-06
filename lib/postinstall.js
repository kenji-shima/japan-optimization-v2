const fs = require("fs");
const package = JSON.parse(fs.readFileSync("./package.json", "utf-8"));
package.scripts.preinstall = 'node lib/postconfig.js'
fs.writeFileSync("./package.json", JSON.stringify(package, null, 2));
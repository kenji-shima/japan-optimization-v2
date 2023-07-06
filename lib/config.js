const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const dir = path.resolve(__dirname);
const pathName = dir.split("/");
const publicURL = pathName[pathName.length - 2];

const package = JSON.parse(fs.readFileSync("./package.json", "utf-8"));
package.scripts.build = `vite build --outDir build --base=/${publicURL}`;
fs.writeFileSync("./package.json", JSON.stringify(package, null, 2));

const bind = 'source "$(npm root -g)/@mapbox/mbxcli/bin/mapbox.sh"';
const command = `mbx github-app register -g mbx-publisher -r ${publicURL}`;

const fileText = `${bind}\n${command}`;
fs.writeFileSync("./bind.sh", fileText);
fs.chmodSync("./bind.sh", "755");
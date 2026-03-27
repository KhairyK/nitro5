import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pkgPath = path.join(__dirname, "../package.json");

const data= JSON.parse(readFileSync(pkgPath, "utf-8"));
const msg = {
  info: `Nitro 5 Web Server v${data.version}, Running on Node.js ${process.version}.\n\n`,
  noConfigFound: `[NITRO 5 ERROR]: No config file are found in ${process.cwd()}.\n\nHint: you are no nitro5.config.js file, create the file and see https://nitro5.opendnf.cloud/config-file#example`
}

export default msg;

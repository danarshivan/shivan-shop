import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const output = resolve(root, "dist");
await mkdir(output, { recursive: true });
const qrOutput = resolve(output, "qr-vendor");
await mkdir(qrOutput, { recursive: true });
const source = await readFile(resolve(root, "index.html"), "utf8");
const deployable = source.replace(/const OWNER_PASSWORD = "[^"]*";/, 'const OWNER_PASSWORD = "";');
if (deployable.includes('const OWNER_PASSWORD = "dddddddd";')) {
  throw new Error("The legacy owner password was not removed from the deploy build.");
}
await writeFile(resolve(output, "index.html"), deployable);
for (const file of ["qrcode-generator.js", "qrcode-generator-LICENSE.txt", "jsQR.js", "jsQR-LICENSE.txt"]) {
  await copyFile(resolve(root, "vendor", "qr", file), resolve(qrOutput, file));
}
console.log("Built Shivan Shop into dist/ with local QR tools.");

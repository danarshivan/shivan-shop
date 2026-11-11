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
for (const file of ["service-worker.js", "manifest.webmanifest", "push-icon.svg", "luxury-theme.css", "ios-app-theme.css"]) {
  await copyFile(resolve(root, file), resolve(output, file));
}
const brandOutput=resolve(output,"assets","branding");
await mkdir(brandOutput,{recursive:true});
await copyFile(resolve(root,"assets","branding","shivan-shop-splash.jpg"),resolve(brandOutput,"shivan-shop-splash.jpg"));
await copyFile(resolve(root,"assets","branding","shivan-shop-launch.jpg"),resolve(brandOutput,"shivan-shop-launch.jpg"));
await copyFile(resolve(root,"assets","branding","shivan-shop-ring-patch.png"),resolve(brandOutput,"shivan-shop-ring-patch.png"));
for (const file of ["shivan-shop-cinematic-original.jpg", "shivan-shop-cinematic-base.png", "shivan-shop-cinematic-mark.png", "shivan-shop-cinematic-wordmark.png", "shivan-shop-cinematic-wave.png"]) {
  await copyFile(resolve(root,"assets","branding",file),resolve(brandOutput,file));
}
console.log("Built Shivan Shop into dist/ with local QR tools and splash artwork.");

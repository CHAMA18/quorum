import { mkdir, readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";

const output = "build/desktop";
await mkdir(output, { recursive: true });
const source = await readFile("public/logo.svg");

const pngAt = async (size) =>
  sharp(source).resize(size, size).png().toBuffer();

const png256 = await pngAt(256);
const icoHeader = Buffer.from([0, 0, 1, 0, 1, 0]);
const icoEntry = Buffer.alloc(16);
icoEntry[0] = 0; // 256px is encoded as zero in the ICO directory.
icoEntry[1] = 0;
icoEntry[2] = 0;
icoEntry[3] = 0;
icoEntry.writeUInt16LE(1, 4);
icoEntry.writeUInt16LE(32, 6);
icoEntry.writeUInt32LE(png256.length, 8);
icoEntry.writeUInt32LE(22, 12);
await writeFile(`${output}/icon.ico`, Buffer.concat([icoHeader, icoEntry, png256]));
await writeFile(`${output}/icon.png`, await pngAt(1024));

const icnsTypes = new Map([
  [16, "icp4"],
  [32, "icp5"],
  [128, "ic07"],
  [256, "ic08"],
  [512, "ic09"],
  [1024, "ic10"],
]);
const chunks = [];
for (const [size, type] of icnsTypes) {
  const data = await pngAt(size);
  const header = Buffer.alloc(8);
  header.write(type, 0, 4, "ascii");
  header.writeUInt32BE(data.length + 8, 4);
  chunks.push(header, data);
}
const body = Buffer.concat(chunks);
const icnsHeader = Buffer.alloc(8);
icnsHeader.write("icns", 0, 4, "ascii");
icnsHeader.writeUInt32BE(body.length + 8, 4);
await writeFile(`${output}/icon.icns`, Buffer.concat([icnsHeader, body]));

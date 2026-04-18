import { randomBytes } from "crypto";

const key = [
  randomBytes(4).toString("hex").toUpperCase(),
  randomBytes(4).toString("hex").toUpperCase(),
  randomBytes(4).toString("hex").toUpperCase(),
  randomBytes(4).toString("hex").toUpperCase(),
].join("-");

console.log("License key:", key);
// Example: A1B2C3D4-E5F6A7B8-C9D0E1F2-A3B4C5D6
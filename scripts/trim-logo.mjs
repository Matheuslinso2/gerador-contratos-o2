import sharp from "sharp";

await sharp("scripts/o2-src-color.jpeg").trim({ threshold: 10 }).png().toFile("public/o2-logo-color.png");
await sharp("scripts/o2-src-white.jpeg").trim({ threshold: 10 }).png().toFile("public/o2-logo-white.png");
console.log("done");

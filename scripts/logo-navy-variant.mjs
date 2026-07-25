import sharp from "sharp";

const img = sharp("public/o2-logo-color.png").ensureAlpha();
const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
const { width, height, channels } = info;

const out = Buffer.alloc(width * height * 4);

for (let i = 0; i < width * height; i++) {
  const r = data[i * channels];
  const g = data[i * channels + 1];
  const b = data[i * channels + 2];

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const spread = max - min; // high for orange, ~0 for grayscale

  let outR, outG, outB, outA;

  if (spread > 40) {
    // Orange-ish pixel: keep the brand color, alpha scales with how saturated/dark it is
    outR = r;
    outG = g;
    outB = b;
    outA = 255;
  } else {
    // Grayscale pixel (text or background): convert dark "ink" to white ink on transparent bg.
    // Steep curve so dark-gray text reaches near-full opacity instead of looking washed out.
    const lightness = (r + g + b) / 3;
    const rawAlpha = (255 - lightness) * 1.8;
    outA = Math.max(0, Math.min(255, rawAlpha));
    outR = 255;
    outG = 255;
    outB = 255;
  }

  out[i * 4] = outR;
  out[i * 4 + 1] = outG;
  out[i * 4 + 2] = outB;
  out[i * 4 + 3] = outA;
}

await sharp(out, { raw: { width, height, channels: 4 } })
  .png()
  .toFile("public/o2-logo-navy.png");

console.log("done", width, height);

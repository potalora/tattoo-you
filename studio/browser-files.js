import {preflightRaster} from './workspace-validation.js';
import {STORAGE_LIMITS} from './storage-limits.js';

async function raster(file, strict = true) {
  if (file.size > STORAGE_LIMITS.maxImageBytes) throw Error("Images must be smaller than 20 MB.");
  if (strict && !["image/png", "image/webp"].includes(file.type)) throw Error("Use a transparent PNG or WebP with one isolated design.");
  const {mime} = await preflightRaster(file);
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    // Preserve source detail for the focused skin atlas while bounding decoded
    // artwork to the existing 16-megapixel storage contract. Never upscale.
    const f = Math.min(1, 4096 / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(img.width * f));
    c.height = Math.max(1, Math.round(img.height * f));
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, c.width, c.height);
    if (strict) {
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      let transparent = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] < 240) transparent++;
      if (transparent < d.length / 4 * 2e-3) throw Error("This image has no transparent background. Export an isolated PNG/WebP first; this app does not remove backgrounds.");
    }
    // Keep accepted PNG/WebP bytes when no resizing is needed: converting
    // compressed WebP into PNG can exceed the storage budget and alter detail.
    const preserve = f === 1 && ["image/png", "image/webp"].includes(mime);
    const output = preserve ? (file.type === mime ? file : file.slice(0, file.size, mime)) :
      await new Promise(resolve => c.toBlob(resolve, "image/png"));
    if (!output) throw Error("Image encoding failed. Try another PNG or WebP.");
    if (output.size > STORAGE_LIMITS.maxImageBytes) throw Error("Processed image exceeds 20 MiB. Use a smaller source image or a more compact transparent PNG/WebP.");
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error || Error("Image could not be read."));
      reader.readAsDataURL(output);
    });
    return { dataUrl, width: c.width, height: c.height };
  } finally {
    URL.revokeObjectURL(url);
  }
}
function download(name, blob) {
  const url = URL.createObjectURL(blob), a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2500);
}
export {
  download,
  raster
};

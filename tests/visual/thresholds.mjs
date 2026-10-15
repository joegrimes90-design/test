// Pass/fail limits for the visual quality tests (see tests/helpers/image-compare.mjs
// for the metrics).
//
// Calibrated on this machine (README "Testing" has the table). The current code
// renders bit-identically run to run (PSNR ∞), so the limits sit between
// changes nobody can see on a high-DPI screen (sprites re-rasterised as bitmaps
// at the displayed resolution, compositor layers: global sharpness >= 0.91,
// worst tile >= 0.79, worst sprite >= 0.85, colour shift <= 0.4 levels) and
// visible ones (1x bitmaps upscaled: global 0.82-0.87, tiles/sprites <= 0.62;
// 0.5 px blur: <= 0.76; 2x bitmaps of a sprite shown at 2.6x: tile 0.59;
// brightness +2%, saturation +10%, hue 4 degrees: shifts of 2.3-9 levels).
export const THRESHOLDS = {
  // whole frame / whole gallery page
  global: { psnr: 32, ssim: 0.97, sharpMin: 0.89, sharpMax: 1.1, shift: 1.5 },
  // every 256x256 device-pixel tile (sharpness judged where the baseline has detail)
  tile: { psnr: 28, ssim: 0.93, sharpMin: 0.7, minDetail: 100, shift: 3 },
  // every sprite cell in the gallery
  region: { psnr: 30, ssim: 0.95, sharpMin: 0.78, sharpMax: 1.2, minDetail: 20, shift: 2 },
};

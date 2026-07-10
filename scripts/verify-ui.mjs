import { chromium } from "playwright";
import fs from "node:fs";

const SCRATCH = "/tmp/claude-0/-home-user-designs/556d11b8-2e23-552d-bb6c-2ba8901f1632/scratchpad";
const REF = "/root/.claude/uploads/556d11b8-2e23-552d-bb6c-2ba8901f1632/23566df5-1000008883.png";

// Mock layout mimicking what Claude should return for the boat painting,
// including the label_grid for mosaic mode.
function buildLabelGrid() {
  const COLS = 40, ROWS = 24, rows = [];
  for (let r = 0; r < ROWS; r++) {
    let row = "";
    const y = r / (ROWS - 1);
    for (let c = 0; c < COLS; c++) {
      const x = c / (COLS - 1);
      const inBoat = y > 0.3 && y < 0.72 && x > 0.5 && x < 0.85 && Math.abs(x - 0.67) < (y - 0.25) * 0.45;
      if (inBoat) row += "1";
      else if (y < 0.55) row += "0";
      else row += "2";
    }
    rows.push(row);
  }
  return rows;
}

const mockLayout = {
  background_color: "#efe9df",
  text_color: "#2a2118",
  font_family: "Roboto Slab",
  fields: [
    { word: "CLOUDS", axis: "vertical", opacity_curve: [[0, 0.95], [0.25, 0.6], [0.45, 0.2], [0.55, 0.03]] },
    { word: "OCEAN", axis: "vertical", opacity_curve: [[0, 0.05], [0.45, 0.05], [0.7, 0.45], [1, 1]] },
  ],
  subjects: [
    {
      word: "BOAT",
      bbox: { x: 0.45, y: 0.25, w: 0.4, h: 0.5 },
      density_grid: [
        "00000009000000000000", "00000009900000000000", "00000009990000000000",
        "00000009999000000000", "00000009999900000000", "00000009999990000000",
        "00000009999999000000", "00000009999999900000", "00000009999999990000",
        "00000009999999999000", "00000009999999999900", "00000009999999999990",
        "00000009999999999999", "00000009999999999999", "00099999999999999999",
        "00999999999999999990", "09999999999999999900", "09999999999999999000",
        "00999999999999990000", "00099999999999900000",
      ],
      z: 10,
      opacity: 1,
    },
  ],
  label_grid: { words: ["CLOUDS", "BOAT", "OCEAN"], rows: buildLabelGrid() },
};

// In the remote environment Chromium is pre-installed at a pinned path; local
// runs fall back to Playwright's own download.
const executablePath = fs.existsSync("/opt/pw-browsers/chromium")
  ? "/opt/pw-browsers/chromium"
  : undefined;
const browser = await chromium.launch({ executablePath });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });

// Intercept the generate API with the mock layout.
await page.route("**/api/generate", (route) =>
  route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ layout: mockLayout, degraded: false }) }),
);

await page.goto("http://localhost:3000", { waitUntil: "networkidle" });

// Crop the left half (the original painting) of the reference image in-browser.
const croppedB64 = await page.evaluate(async (refB64) => {
  const img = new Image();
  img.src = "data:image/png;base64," + refB64;
  await new Promise((res) => (img.onload = res));
  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(img.width / 2) - 10;
  canvas.height = img.height;
  canvas.getContext("2d").drawImage(img, 0, 0);
  return canvas.toDataURL("image/png").split(",")[1];
}, fs.readFileSync(REF).toString("base64"));
fs.writeFileSync(`${SCRATCH}/boat-original.png`, Buffer.from(croppedB64, "base64"));

// Upload it.
const fileInput = page.locator('input[type="file"]');
await fileInput.setInputFiles(`${SCRATCH}/boat-original.png`);
await page.getByRole("button", { name: /generate word art/i }).click();

// Wait for the poster render.
await page.waitForSelector("svg", { timeout: 15000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${SCRATCH}/01-poster.png`, fullPage: true });

// Switch to mosaic mode.
await page.getByRole("button", { name: /mosaic/i }).click();
await page.waitForTimeout(2500);
await page.screenshot({ path: `${SCRATCH}/02-mosaic.png`, fullPage: true });

// Slide letter size smaller (more detail).
const slider = page.locator('input[type="range"]').first();
await slider.fill("8");
await page.waitForTimeout(2000);
await page.screenshot({ path: `${SCRATCH}/03-mosaic-small.png`, fullPage: true });

// Word override: change OCEAN -> SEA and confirm mosaic + poster follow.
const oceanInput = page.locator('input[type="text"]').nth(1);
await oceanInput.fill("SEA");
await page.waitForTimeout(1500);
await page.screenshot({ path: `${SCRATCH}/04-mosaic-override.png`, fullPage: true });

// Check the export SVG serializes non-trivially.
const svgLen = await page.evaluate(() => document.querySelector("main svg")?.outerHTML.length ?? 0);
console.log("svg length:", svgLen);
console.log("errors:", errors.length ? errors.join("\n") : "none");
await browser.close();

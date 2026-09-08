import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";
import sharp from "sharp";

const argv = process.argv.slice(2);
if (argv[0] === "--") argv.shift();
const [command = "help", ...rawArgs] = argv;
const args = parseArgs(rawArgs);
const root = process.cwd();
const artifactsRoot = path.join(root, ".artifacts", "ui-review");

if (!["before", "after", "report"].includes(command)) {
  printUsage();
  process.exit(command === "help" ? 0 : 1);
}

const name = normalizeName(args.name || "default");
const outputDir = path.join(artifactsRoot, name);
const beforePath = path.join(outputDir, "before.png");
const afterPath = path.join(outputDir, "after.png");
const diffPath = path.join(outputDir, "diff.png");
const metadataPath = path.join(outputDir, "metadata.json");
const reportPath = path.join(outputDir, "report.md");

await fs.mkdir(outputDir, { recursive: true });

if (command === "report") {
  try {
    await fs.access(reportPath);
    console.log(reportPath);
  } catch {
    console.error(`No report found for '${name}'. Capture before and after first.`);
    process.exit(1);
  }
  process.exit(0);
}

if (!args.url) {
  console.error("Missing required --url for before/after capture.");
  printUsage();
  process.exit(1);
}

const viewport = parseViewport(args.viewport || "1440x1000");
const waitMs = Number(args.wait || 700);
const selector = args.selector || null;
const fullPage = Boolean(args["full-page"]);

if (!Number.isFinite(waitMs) || waitMs < 0) {
  console.error("--wait must be a non-negative number of milliseconds.");
  process.exit(1);
}

const capture = await capturePage({
  url: args.url,
  viewport,
  waitMs,
  selector,
  fullPage,
});

if (command === "before") {
  await fs.writeFile(beforePath, capture.image);
  await fs.writeFile(
    metadataPath,
    JSON.stringify(
      {
        name,
        url: args.url,
        viewport,
        selector,
        fullPage,
        waitMs,
        before: capture.meta,
      },
      null,
      2,
    ),
  );
  await fs.writeFile(reportPath, renderReport({ name, before: capture.meta }));
  console.log(`Before screenshot: ${beforePath}`);
  console.log(`Report: ${reportPath}`);
} else {
  try {
    await fs.access(beforePath);
  } catch {
    console.error(`Missing baseline at ${beforePath}. Run the before command first.`);
    process.exit(1);
  }

  const metadata = await readJson(metadataPath);
  const comparison = await compareImages(beforePath, capture.image, diffPath);
  const nextMetadata = {
    ...metadata,
    url: args.url,
    viewport,
    selector,
    fullPage,
    waitMs,
    after: capture.meta,
    comparison,
  };
  await fs.writeFile(metadataPath, JSON.stringify(nextMetadata, null, 2));
  await fs.writeFile(
    afterPath,
    capture.image,
  );
  await fs.writeFile(reportPath, renderReport(nextMetadata));
  console.log(`After screenshot: ${afterPath}`);
  console.log(`Diff image: ${diffPath}`);
  console.log(`Report: ${reportPath}`);
}

async function capturePage({ url, viewport, waitMs, selector, fullPage }) {
  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    });
  } catch {
    browser = await chromium.launch({ headless: true, channel: "chrome" });
  }

  try {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("requestfailed", (request) => {
      failedRequests.push(`${request.method()} ${request.url()} — ${request.failure()?.errorText || "failed"}`);
    });

    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForTimeout(waitMs);

    let image;
    if (selector) {
      const element = page.locator(selector).first();
      await element.waitFor({ state: "visible", timeout: 10_000 });
      image = await element.screenshot({ type: "png" });
    } else {
      image = await page.screenshot({ type: "png", fullPage });
    }

    return {
      image,
      meta: {
        capturedAt: new Date().toISOString(),
        url,
        title: await page.title(),
        status: response?.status() ?? null,
        viewport,
        selector,
        fullPage,
        consoleErrors,
        pageErrors,
        failedRequests,
      },
    };
  } finally {
    await browser.close();
  }
}

async function compareImages(beforeFile, afterBuffer, diffFile) {
  const before = await sharp(beforeFile).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const after = await sharp(afterBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const width = Math.min(before.info.width, after.info.width);
  const height = Math.min(before.info.height, after.info.height);
  const channels = 4;
  const diff = Buffer.alloc(width * height * channels);
  let changedPixels = 0;
  let totalDelta = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sourceIndex = (y * before.info.width + x) * channels;
      const targetIndex = (y * after.info.width + x) * channels;
      const diffIndex = (y * width + x) * channels;
      const delta = Math.abs(before.data[sourceIndex] - after.data[targetIndex])
        + Math.abs(before.data[sourceIndex + 1] - after.data[targetIndex + 1])
        + Math.abs(before.data[sourceIndex + 2] - after.data[targetIndex + 2]);
      const changed = delta > 12;
      if (changed) changedPixels += 1;
      totalDelta += delta;
      diff[diffIndex] = changed ? 255 : 0;
      diff[diffIndex + 1] = changed ? Math.max(35, 190 - Math.min(150, delta)) : 0;
      diff[diffIndex + 2] = 0;
      diff[diffIndex + 3] = changed ? 220 : 0;
    }
  }

  await sharp(diff, { raw: { width, height, channels } }).png().toFile(diffFile);
  const comparedPixels = width * height;
  return {
    beforeSize: { width: before.info.width, height: before.info.height },
    afterSize: { width: after.info.width, height: after.info.height },
    comparedPixels,
    changedPixels,
    changedPercent: comparedPixels ? Number(((changedPixels / comparedPixels) * 100).toFixed(3)) : 0,
    averageRgbDelta: comparedPixels ? Number((totalDelta / comparedPixels).toFixed(3)) : 0,
  };
}

function renderReport(data) {
  const before = data.before;
  const after = data.after;
  const comparison = data.comparison;
  const errors = [
    ...(before?.consoleErrors || []).map((item) => `- before console: ${item}`),
    ...(before?.pageErrors || []).map((item) => `- before page: ${item}`),
    ...(after?.consoleErrors || []).map((item) => `- after console: ${item}`),
    ...(after?.pageErrors || []).map((item) => `- after page: ${item}`),
  ];
  const status = errors.length === 0 ? "PASS — no browser console/page errors captured" : "REVIEW — browser errors captured";

  return `# Folio UI review: ${data.name}

| Field | Value |
| --- | --- |
| Route | ${data.url || before?.url || "unknown"} |
| Viewport | ${data.viewport?.width || before?.viewport?.width} × ${data.viewport?.height || before?.viewport?.height} |
| Capture mode | ${data.selector ? `selector \`${data.selector}\`` : data.fullPage ? "full page" : "viewport"} |
| Before captured | ${before?.capturedAt || "not captured"} |
| After captured | ${after?.capturedAt || "not captured"} |
| Browser check | ${status} |

## Artifacts

- Before: \`before.png\`
- After: \`after.png\`
- Diff: \`diff.png\`
- Metadata: \`metadata.json\`

## Comparison

${comparison ? `Compared area: ${comparison.comparedPixels.toLocaleString()} pixels. Changed pixels: ${comparison.changedPixels.toLocaleString()} (${comparison.changedPercent}%). Average RGB delta: ${comparison.averageRgbDelta}.` : "Capture the after state to generate the before/after comparison."}

## Browser diagnostics

${errors.length ? errors.join("\n") : "No console or page errors were captured."}

> Review both screenshots manually before reporting completion. A low pixel difference does not prove that the intended interaction or content is correct.
`;
}

function parseArgs(values) {
  const result = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) continue;
    const key = value.slice(2);
    const next = values[index + 1];
    if (!next || next.startsWith("--")) result[key] = true;
    else {
      result[key] = next;
      index += 1;
    }
  }
  return result;
}

function parseViewport(value) {
  const match = String(value).match(/^(\d+)x(\d+)$/);
  if (!match) throw new Error(`Invalid viewport '${value}'. Use WIDTHxHEIGHT, e.g. 1440x1000.`);
  return { width: Number(match[1]), height: Number(match[2]) };
}

function normalizeName(value) {
  return String(value).trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "default";
}

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return {};
  }
}

function printUsage() {
  console.log(`Usage:
  pnpm ui:review -- before --url <url> --name <slug> [--viewport 1440x1000] [--selector <css>] [--full-page] [--wait 700]
  pnpm ui:review -- after  --url <url> --name <slug> [same options]
  pnpm ui:review -- report --name <slug>`);
}

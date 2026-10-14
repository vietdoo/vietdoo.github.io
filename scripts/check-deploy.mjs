#!/usr/bin/env node
import { execSync } from "node:child_process";

const REPO = "vietdoo/vietdoo.github.io";
const args = process.argv.slice(2);
const shouldWait = args.includes("--wait") || args.includes("-w");
const shaArgIdx = args.indexOf("--sha");
const targetSha = shaArgIdx !== -1 && args[shaArgIdx + 1]
  ? args[shaArgIdx + 1]
  : execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();

const timeoutSeconds = 300; // 5 phút
const pollIntervalMs = 10000; // 10 giây

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "vietdoo-folio-checker",
      Accept: "application/vnd.github.v3+json",
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub API request failed: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

async function getDeployStatus(sha) {
  const [statuses, checkRunsData] = await Promise.all([
    fetchJson(`https://api.github.com/repos/${REPO}/commits/${sha}/statuses`),
    fetchJson(`https://api.github.com/repos/${REPO}/commits/${sha}/check-runs`),
  ]);

  const vercelStatus = statuses.find((s) => s.context === "Vercel" || s.creator?.login === "vercel[bot]");
  const checkRuns = checkRunsData.check_runs || [];

  return { vercelStatus, checkRuns };
}

function printReport(sha, { vercelStatus, checkRuns }) {
  console.log(`\n======================================================`);
  console.log(`📌 Commit: ${sha.slice(0, 7)} (${sha})`);
  console.log(`======================================================`);

  console.log(`\n▲ VERCEL DEPLOYMENT:`);
  if (!vercelStatus) {
    console.log(`   Trạng thái: Chưa có tín hiệu từ Vercel (Pending nhận diện)...`);
  } else {
    const icon = vercelStatus.state === "success" ? "✅" : vercelStatus.state === "pending" ? "⏳" : "❌";
    console.log(`   Trạng thái: ${icon} ${vercelStatus.state.toUpperCase()}`);
    console.log(`   Mô tả:      ${vercelStatus.description || "N/A"}`);
    if (vercelStatus.target_url) {
      console.log(`   URL:        ${vercelStatus.target_url}`);
    }
    console.log(`   Cập nhật:   ${vercelStatus.updated_at || vercelStatus.created_at}`);
  }

  if (checkRuns.length > 0) {
    console.log(`\n⚙️ GITHUB ACTIONS CI:`);
    for (const run of checkRuns) {
      const icon = run.conclusion === "success" ? "✅" : run.status === "in_progress" ? "⏳" : run.conclusion ? "❌" : "⏱️";
      console.log(`   - ${icon} ${run.name}: ${run.conclusion || run.status}`);
    }
  }
  console.log(`======================================================\n`);
}

async function main() {
  console.log(`🔍 Đang kiểm tra trạng thái deploy cho commit ${targetSha.slice(0, 7)}...`);
  const startTime = Date.now();

  while (true) {
    try {
      const statusData = await getDeployStatus(targetSha);
      const isVercelFinal = statusData.vercelStatus && statusData.vercelStatus.state !== "pending";

      if (!shouldWait || isVercelFinal) {
        printReport(targetSha, statusData);
        if (statusData.vercelStatus?.state === "failure" || statusData.vercelStatus?.state === "error") {
          process.exit(1);
        }
        return;
      }

      console.log(`⏳ Vercel đang xử lý... Đang chờ thêm 10s (đã đợi: ${Math.round((Date.now() - startTime) / 1000)}s)...`);
    } catch (err) {
      console.error(`⚠️ Lỗi kiểm tra: ${err.message}`);
      if (!shouldWait) {
        process.exit(1);
      }
    }

    if ((Date.now() - startTime) / 1000 > timeoutSeconds) {
      console.error(`❌ Hết thời gian chờ (${timeoutSeconds}s).`);
      process.exit(1);
    }

    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
}

main();

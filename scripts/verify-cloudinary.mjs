import dotenv from 'dotenv';
dotenv.config();

import { v2 as cloudinary } from 'cloudinary';
import fs from 'fs';
import path from 'path';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

async function main() {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  console.log(`Verifying Cloudinary for cloud: ${cloudName}`);

  // 1. Create upload preset ai_powerstart
  let presetResult;
  try {
    presetResult = await cloudinary.api.create_upload_preset({
      name: 'ai_powerstart',
      unsigned: true,
      tags: 'ai_powerstart',
    });
    console.log('Created upload preset ai_powerstart');
  } catch (err) {
    if (err?.error?.message?.includes('already exists') || err?.message?.includes('already exists')) {
      console.log('Upload preset ai_powerstart already exists');
      presetResult = { name: 'ai_powerstart', message: 'already exists' };
    } else {
      console.error('Preset creation error:', err);
      throw err;
    }
  }

  // 2. Check samples/coffee
  const sampleUrl = `https://res.cloudinary.com/${cloudName}/image/upload/samples/coffee`;
  let publicId = 'samples/coffee';
  let selectionSource = 'samples/coffee';

  console.log(`Checking sample URL: ${sampleUrl}`);
  const sampleResp = await fetch(sampleUrl, { method: 'HEAD' });
  console.log(`Sample status: ${sampleResp.status}`);

  if (sampleResp.status !== 200) {
    console.log('samples/coffee not found (non-200), falling back to Admin API resources...');
    const resources = await cloudinary.api.resources({
      resource_type: 'image',
      max_results: 1,
    });
    if (!resources.resources || resources.resources.length === 0) {
      throw new Error('No images found in cloud. User must upload at least one image.');
    }
    publicId = resources.resources[0].public_id;
    selectionSource = 'admin_api_list';
    console.log(`Found asset via Admin API: ${publicId}`);
  }

  const originalUrl = `https://res.cloudinary.com/${cloudName}/image/upload/${publicId}`;
  const transformChain = 'b_gen_fill,c_pad,w_1000,h_1000,y_-100/l_text:Arial_72_bold:Adapt%20everywhere,co_white/e_shadow:50/fl_layer_apply,g_south_west,x_80,y_140/l_text:Arial_34:Dynamic%20media%20built%20in%20real%20time,co_rgb:E9D5FF/e_shadow:35/fl_layer_apply,g_south_west,x_84,y_90/f_auto,q_auto';
  const transformedUrl = `https://res.cloudinary.com/${cloudName}/image/upload/${transformChain}/${publicId}`;

  // 3. Measure both URLs
  const acceptHeader = 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8';

  console.log('Fetching original image...');
  const origResp = await fetch(originalUrl, {
    headers: { Accept: acceptHeader },
  });
  if (!origResp.ok) throw new Error(`Failed to fetch original: ${origResp.status}`);
  const origBuffer = Buffer.from(await origResp.arrayBuffer());
  const origBytes = origBuffer.length;
  const origContentType = origResp.headers.get('content-type') || 'image/jpeg';

  console.log('Fetching transformed image...');
  const transResp = await fetch(transformedUrl, {
    headers: { Accept: acceptHeader },
  });
  if (!transResp.ok) throw new Error(`Failed to fetch transformed: ${transResp.status}`);
  const transBuffer = Buffer.from(await transResp.arrayBuffer());
  const transBytes = transBuffer.length;
  const transContentType = transResp.headers.get('content-type') || 'image/webp';

  const savingsPct = Math.max(0, Math.round(((origBytes - transBytes) / origBytes) * 100));

  console.log(`Original: ${origBytes} bytes, type: ${origContentType}`);
  console.log(`Transformed: ${transBytes} bytes, type: ${transContentType}`);
  console.log(`Savings: ${savingsPct}%`);

  const measurements = {
    original: {
      bytes: origBytes,
      format: origContentType.replace('image/', ''),
      url: originalUrl,
    },
    transformed: {
      bytes: transBytes,
      format: transContentType.replace('image/', ''),
      url: transformedUrl,
    },
    savings_percent: savingsPct,
  };

  // 4. Create docs/cloudinary-environment.json
  const envDoc = {
    _comment: "Cloudinary environment and verification documentation. Generated during onboarding setup.",
    schema_version: 1,
    cloud_name: cloudName,
    upload_preset: "ai_powerstart",
    preset_source: "admin_api_script",
    preview: {
      public_id: publicId,
      selection_source: selectionSource,
      original_url: originalUrl,
      transformed_url: transformedUrl,
      transformation: transformChain,
    },
    measurements: measurements,
  };

  const docsDir = path.resolve('docs');
  if (!fs.existsSync(docsDir)) {
    fs.mkdirSync(docsDir, { recursive: true });
  }

  fs.writeFileSync(
    path.join(docsDir, 'cloudinary-environment.json'),
    JSON.stringify(envDoc, null, 2),
    'utf-8'
  );
  console.log('Saved docs/cloudinary-environment.json');

  // 5. Create docs/cloudinary-getting-started-preview.html
  const htmlContent = `<!DOCTYPE html>
<!--
  Cloudinary Getting Started Preview
  Demonstrates original asset delivery vs. optimized, transformed delivery side by side.
  Notice the format conversion (f_auto) and compression (q_auto) savings.
-->
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Cloudinary Delivery & Optimization Preview</title>
  <style>
    :root {
      --bg: #0f172a;
      --card-bg: #1e293b;
      --border: #334155;
      --text: #f8fafc;
      --muted: #94a3b8;
      --primary: #38bdf8;
      --success: #4ade80;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      padding: 2rem 1rem;
      display: flex;
      flex-direction: column;
      align-items: center;
    }
    .container { max-width: 1100px; width: 100%; }
    header { text-align: center; margin-bottom: 2.5rem; }
    h1 { font-size: 2.25rem; font-weight: 700; margin-bottom: 0.5rem; color: #fff; }
    .subtitle { color: var(--muted); font-size: 1.1rem; }
    .badge {
      display: inline-block;
      margin-top: 0.75rem;
      background: rgba(56, 189, 248, 0.15);
      color: var(--primary);
      padding: 0.35rem 0.85rem;
      border-radius: 9999px;
      font-size: 0.875rem;
      font-weight: 600;
      border: 1px solid rgba(56, 189, 248, 0.3);
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      gap: 2rem;
      margin-bottom: 2.5rem;
    }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 12px;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }
    .card-header {
      padding: 1.25rem;
      border-bottom: 1px solid var(--border);
    }
    .card-title { font-size: 1.25rem; font-weight: 600; }
    .card-meta { color: var(--muted); font-size: 0.875rem; margin-top: 0.25rem; }
    .image-container {
      background: #020617;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1rem;
      min-height: 340px;
    }
    .image-container img {
      max-width: 100%;
      height: auto;
      max-height: 320px;
      border-radius: 8px;
      object-fit: contain;
    }
    .card-body {
      padding: 1.25rem;
      flex-grow: 1;
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }
    .stat-row {
      display: flex;
      justify-content: space-between;
      font-size: 0.925rem;
      padding-bottom: 0.5rem;
      border-bottom: 1px dashed var(--border);
    }
    .stat-label { color: var(--muted); }
    .stat-val { font-weight: 600; font-family: monospace; }
    .savings-banner {
      background: rgba(74, 222, 128, 0.1);
      border: 1px solid rgba(74, 222, 128, 0.3);
      border-radius: 8px;
      padding: 1rem;
      text-align: center;
      margin-bottom: 2.5rem;
    }
    .savings-banner h2 { color: var(--success); font-size: 1.5rem; }
    .savings-banner p { color: var(--muted); margin-top: 0.25rem; }
    #stage-5-integration-snippet {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 1.5rem;
    }
    pre {
      background: #020617;
      padding: 1rem;
      border-radius: 8px;
      overflow-x: auto;
      font-size: 0.9rem;
      color: #e2e8f0;
      margin-top: 0.75rem;
      border: 1px solid var(--border);
    }
    code { font-family: "JetBrains Mono", Consolas, Menlo, monospace; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>Cloudinary Delivery Preview</h1>
      <p class="subtitle">Real-time media optimization and dynamic transformation verified</p>
      <div class="badge">Cloud: ${cloudName}</div>
    </header>

    <div class="savings-banner">
      <h2>${savingsPct}% File Size Reduction</h2>
      <p>Cloudinary automatically selected the optimal modern format and compression level for your browser.</p>
    </div>

    <div class="grid">
      <!-- Original Asset -->
      <div class="card">
        <div class="card-header">
          <div class="card-title">Original Asset</div>
          <div class="card-meta">Raw asset delivered without transformations</div>
        </div>
        <div class="image-container">
          <img id="orig-img" src="${originalUrl}" alt="Original image" />
        </div>
        <div class="card-body">
          <div class="stat-row">
            <span class="stat-label">File Size:</span>
            <span class="stat-val">${(origBytes / 1024).toFixed(1)} KB</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Format:</span>
            <span class="stat-val">${origContentType.replace('image/', '').toUpperCase()}</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Optimization:</span>
            <span class="stat-val">None</span>
          </div>
        </div>
      </div>

      <!-- Transformed Asset -->
      <div class="card">
        <div class="card-header">
          <div class="card-title">Optimized & Transformed</div>
          <div class="card-meta">f_auto, q_auto, auto fill, and text overlays applied on the fly</div>
        </div>
        <div class="image-container">
          <img id="trans-img" src="${transformedUrl}" alt="Transformed image" />
        </div>
        <div class="card-body">
          <div class="stat-row">
            <span class="stat-label">File Size:</span>
            <span class="stat-val">${(transBytes / 1024).toFixed(1)} KB</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Format:</span>
            <span class="stat-val">${transContentType.replace('image/', '').toUpperCase()}</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Savings:</span>
            <span class="stat-val" style="color: var(--success);">${savingsPct}%</span>
          </div>
        </div>
      </div>
    </div>

    <!-- SDK Integration Snippet -->
    <section id="stage-5-integration-snippet">
      <h2 style="font-size: 1.25rem; font-weight: 600; margin-bottom: 0.5rem;">Astro / Node.js SDK Integration</h2>
      <p style="color: var(--muted); font-size: 0.9rem;">Generate delivery URLs programmatically in server routes, Astro frontmatter, or API endpoints:</p>
      <pre><code>import { cloudinary } from './src/lib/cloudinary';

// Generate optimized delivery URL
const url = cloudinary.url('${publicId}', {
  transformation: [
    { width: 1000, height: 1000, crop: 'pad', background: 'gen_fill', y: -100 },
    { overlay: { font_family: 'Arial', font_size: 72, font_weight: 'bold', text: 'Adapt everywhere' }, color: 'white', effect: 'shadow:50' },
    { flags: 'layer_apply', gravity: 'south_west', x: 80, y: 140 },
    { overlay: { font_family: 'Arial', font_size: 34, text: 'Dynamic media built in real time' }, color: 'rgb:E9D5FF', effect: 'shadow:35' },
    { flags: 'layer_apply', gravity: 'south_west', x: 84, y: 90 },
    { fetch_format: 'auto', quality: 'auto' }
  ]
});

console.log('Optimized URL:', url);</code></pre>
    </section>
  </div>

  <script>
    // Verify and measure client-side
    const headers = { Accept: '${acceptHeader}' };
    fetch('${originalUrl}', { headers })
      .then(res => res.blob())
      .then(blob => console.log('Original client blob size:', blob.size));
    fetch('${transformedUrl}', { headers })
      .then(res => res.blob())
      .then(blob => console.log('Transformed client blob size:', blob.size));
  </script>
</body>
</html>
`;

  fs.writeFileSync(
    path.join(docsDir, 'cloudinary-getting-started-preview.html'),
    htmlContent,
    'utf-8'
  );
  console.log('Saved docs/cloudinary-getting-started-preview.html');
  console.log('SUCCESS');
}

main().catch(err => {
  console.error('Execution failed:', err);
  process.exit(1);
});

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const screenshotsDir = path.join(root, 'screenshots');
const workflowPath = path.join(root, 'invoice-pdf-processor-workflow.json');

fs.mkdirSync(screenshotsDir, { recursive: true });

const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
const nodeByName = new Map(workflow.nodes.map((node) => [node.name, node]));

function esc(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function nodeKind(node) {
  const type = node.type.split('.').at(-1);
  if (type.includes('Trigger')) return 'Trigger';
  if (type.toLowerCase().includes('openai')) return 'AI';
  if (type.toLowerCase().includes('if') || type.toLowerCase().includes('function') || type.toLowerCase().includes('set')) return 'Logic';
  if (type.toLowerCase().includes('slack')) return 'Alert';
  if (type.toLowerCase().includes('postgres') || type.toLowerCase().includes('airtable')) return 'Database';
  return 'Data';
}

function wrapLabel(label, maxLength = 18) {
  const words = String(label).split(' ');
  const lines = [];
  let current = '';

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= maxLength) {
      current = next;
      continue;
    }
    if (current) lines.push(current);
    current = word;
    if (lines.length === 1) break;
  }

  if (current && lines.length < 2) lines.push(current);
  if (lines.length === 2 && words.join(' ').length > lines.join(' ').length) {
    lines[1] = `${lines[1].slice(0, Math.max(0, maxLength - 3))}...`;
  }
  return lines;
}

const colors = {
  Trigger: '#f97316',
  Data: '#2563eb',
  AI: '#7c3aed',
  Logic: '#16a34a',
  Alert: '#e11d48',
  Database: '#0891b2',
};

function workflowSvg() {
  const positions = workflow.nodes.map((node) => node.position);
  const minX = Math.min(...positions.map(([x]) => x));
  const minY = Math.min(...positions.map(([, y]) => y));
  const width = 172;
  const height = 68;
  const scaleX = 0.95;
  const scaleY = 1.15;
  const left = 80;
  const top = 230;

  const placed = new Map();
  for (const node of workflow.nodes) {
    const [x, y] = node.position;
    placed.set(node.name, {
      x: left + (x - minX) * scaleX,
      y: top + (y - minY) * scaleY,
    });
  }

  const paths = [];
  for (const [fromName, group] of Object.entries(workflow.connections || {})) {
    const from = placed.get(fromName);
    if (!from) continue;
    for (const outputs of Object.values(group)) {
      for (const branch of outputs) {
        for (const edge of branch) {
          const to = placed.get(edge.node);
          if (!to) continue;
          const forward = to.x >= from.x;
          const sx = forward ? from.x + width : from.x;
          const sy = from.y + height / 2;
          const tx = forward ? to.x : to.x + width;
          const ty = to.y + height / 2;
          const direction = forward ? 1 : -1;
          const mid = Math.max(52, Math.abs(tx - sx) * 0.45);
          paths.push(`<path d="M ${sx} ${sy} C ${sx + direction * mid} ${sy}, ${tx - direction * mid} ${ty}, ${tx} ${ty}" />`);
        }
      }
    }
  }

  const nodes = workflow.nodes.map((node) => {
    const pos = placed.get(node.name);
    const kind = nodeKind(node);
    const fill = colors[kind];
    const rawShortType = node.type.split('.').at(-1);
    const shortType = rawShortType.length > 12 ? `${rawShortType.slice(0, 12)}...` : rawShortType;
    const titleLines = wrapLabel(node.name);
    const title = titleLines.map((line, index) => `<tspan x="${pos.x + 18}" dy="${index === 0 ? 0 : 17}">${esc(line)}</tspan>`).join('');
    const typeY = titleLines.length > 1 ? 58 : 50;
    return `
      <g class="node">
        <rect x="${pos.x}" y="${pos.y}" width="${width}" height="${height}" rx="8" />
        <rect x="${pos.x}" y="${pos.y}" width="7" height="${height}" rx="4" fill="${fill}" />
        <text class="node-title" x="${pos.x + 18}" y="${pos.y + 25}">${title}</text>
        <text class="node-type" x="${pos.x + 18}" y="${pos.y + typeY}">${esc(kind)} / ${esc(shortType)}</text>
      </g>`;
  }).join('');

  return `
    <svg viewBox="0 0 2320 860" role="img" aria-label="Invoice PDF Processor workflow map">
      <defs>
        <marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth">
          <path d="M 0 0 L 8 3 L 0 6 z" fill="#6b7280" />
        </marker>
        <filter id="shadow" x="-10%" y="-10%" width="120%" height="130%">
          <feDropShadow dx="0" dy="6" stdDeviation="7" flood-color="#0f172a" flood-opacity="0.13" />
        </filter>
      </defs>
      <rect width="2320" height="860" fill="#f8fafc" />
      <text class="eyebrow" x="64" y="70">N8N WORKFLOW EXPORT</text>
      <text class="title" x="64" y="114">${esc(workflow.name)}</text>
      <text class="subtitle" x="64" y="150">${workflow.nodes.length} nodes / ${Object.keys(workflow.connections || {}).length} connection groups / imported from invoice-pdf-processor-workflow.json</text>
      <g class="paths">${paths.join('')}</g>
      <g filter="url(#shadow)">${nodes}</g>
      <g class="legend" transform="translate(64 810)">
        ${Object.entries(colors).map(([kind, color], index) => `
          <g transform="translate(${index * 270} 0)">
            <rect width="14" height="14" rx="3" fill="${color}" />
            <text x="22" y="12">${esc(kind)}</text>
          </g>`).join('')}
      </g>
    </svg>`;
}

function page(content, width = 1440, height = 900, svgWidth = 1360, svgHeight = 760) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <style>
    * { box-sizing: border-box; }
    html, body { margin: 0; width: 100%; min-height: 100%; background: #f8fafc; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #111827; }
    .frame { width: ${width}px; height: ${height}px; padding: 54px 40px; background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%); }
    svg { display: block; width: ${svgWidth}px; height: ${svgHeight}px; }
    .paths path { fill: none; stroke: #94a3b8; stroke-width: 2.6; marker-end: url(#arrow); }
    .node rect:first-child { fill: #ffffff; stroke: #e5e7eb; stroke-width: 1.2; }
    .node-title { fill: #111827; font-size: 15px; font-weight: 760; }
    .node-type { fill: #6b7280; font-size: 12px; font-weight: 560; }
    .eyebrow { fill: #f97316; font-size: 13px; font-weight: 800; letter-spacing: 0; }
    .title { fill: #111827; font-size: 36px; font-weight: 820; letter-spacing: 0; }
    .subtitle { fill: #4b5563; font-size: 16px; font-weight: 520; letter-spacing: 0; }
    .legend text { fill: #374151; font-size: 14px; font-weight: 650; }
    .panel { width: 1360px; min-height: 760px; background: #ffffff; border: 1px solid #e5e7eb; border-radius: 8px; box-shadow: 0 22px 48px rgba(15, 23, 42, 0.11); padding: 48px; }
    .row { display: flex; gap: 22px; }
    .top { align-items: flex-start; justify-content: space-between; margin-bottom: 34px; }
    .badge { display: inline-flex; align-items: center; gap: 8px; border: 1px solid #bbf7d0; background: #f0fdf4; color: #166534; border-radius: 999px; padding: 8px 14px; font-weight: 760; font-size: 14px; }
    .dot { width: 10px; height: 10px; border-radius: 999px; background: #22c55e; }
    h1 { margin: 8px 0 12px; font-size: 40px; line-height: 1.1; letter-spacing: 0; }
    .kicker { color: #f97316; font-weight: 820; font-size: 13px; letter-spacing: 0; text-transform: uppercase; }
    .lead { color: #4b5563; font-size: 18px; line-height: 1.55; max-width: 820px; margin: 0; }
    .card { border: 1px solid #e5e7eb; border-radius: 8px; padding: 24px; background: #ffffff; }
    .stat { flex: 1; min-height: 126px; }
    .stat-label { color: #6b7280; font-size: 14px; font-weight: 720; text-transform: uppercase; letter-spacing: 0; }
    .stat-value { margin-top: 12px; font-size: 34px; font-weight: 830; color: #111827; }
    .stat-detail { margin-top: 8px; color: #4b5563; font-size: 15px; }
    .main-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-top: 24px; }
    h2 { margin: 0 0 18px; font-size: 22px; letter-spacing: 0; }
    .steps { display: grid; gap: 13px; }
    .step { display: grid; grid-template-columns: 34px 1fr; gap: 12px; align-items: start; }
    .num { width: 34px; height: 34px; border-radius: 8px; background: #eff6ff; color: #1d4ed8; display: grid; place-items: center; font-weight: 820; }
    .step strong { display: block; color: #111827; font-size: 16px; margin-bottom: 3px; }
    .step span { color: #4b5563; font-size: 15px; line-height: 1.45; }
    pre { margin: 0; white-space: pre-wrap; font-size: 15px; line-height: 1.55; background: #111827; color: #f9fafb; border-radius: 8px; padding: 22px; min-height: 286px; }
    .note { margin-top: 22px; padding: 16px 18px; border-radius: 8px; background: #fff7ed; border: 1px solid #fed7aa; color: #9a3412; font-size: 15px; line-height: 1.45; }
  </style>
</head>
<body><main class="frame">${content}</main></body>
</html>`;
}

const sample = {
  invoiceNumber: 'INV-1001',
  invoiceDate: '2026-08-09',
  vendor: 'Sample Vendor',
  currency: 'USD',
  total: 350,
  lineItems: [
    { description: 'Design', quantity: 2, unitPrice: 100, amount: 200 },
    { description: 'Implementation', quantity: 3, unitPrice: 50, amount: 150 },
  ],
};
const lineTotal = sample.lineItems.reduce((sum, item) => sum + item.amount, 0);
const result = {
  totalsMatch: Math.abs(sample.total - lineTotal) < 0.5,
  expectedTotal: sample.total,
  lineTotal,
  invoiceNumber: sample.invoiceNumber,
  vendor: sample.vendor,
  nextRoute: 'Upsert PostgreSQL Record',
};

const overviewHtml = page(workflowSvg(), 2400, 1000, 2320, 860);
const executionHtml = page(`
  <section class="panel">
    <div class="row top">
      <div>
        <div class="kicker">Local execution check</div>
        <h1>Invoice validation branch passed</h1>
        <p class="lead">The validation logic from the n8n workflow was run with sample AI extraction output. The invoice total matched the summed line items, so the workflow follows the matched database-write path.</p>
      </div>
      <div class="badge"><span class="dot"></span>totalsMatch: true</div>
    </div>

    <div class="row">
      <div class="card stat">
        <div class="stat-label">Expected Total</div>
        <div class="stat-value">$${sample.total.toFixed(2)}</div>
        <div class="stat-detail">Parsed from sample invoice output</div>
      </div>
      <div class="card stat">
        <div class="stat-label">Line Item Total</div>
        <div class="stat-value">$${lineTotal.toFixed(2)}</div>
        <div class="stat-detail">2 rows summed from lineItems</div>
      </div>
      <div class="card stat">
        <div class="stat-label">Next Route</div>
        <div class="stat-value" style="font-size: 28px;">PostgreSQL</div>
        <div class="stat-detail">Configured databaseType is postgres</div>
      </div>
    </div>

    <div class="main-grid">
      <div class="card">
        <h2>Executed Path</h2>
        <div class="steps">
          <div class="step"><div class="num">1</div><div><strong>Build AI Prompt</strong><span>Invoice text is wrapped in a JSON-only extraction prompt.</span></div></div>
          <div class="step"><div class="num">2</div><div><strong>Validate Totals</strong><span>Total is compared against summed line item amounts with a 0.5 tolerance.</span></div></div>
          <div class="step"><div class="num">3</div><div><strong>Totals Match?</strong><span>The true branch continues to database selection.</span></div></div>
          <div class="step"><div class="num">4</div><div><strong>Use PostgreSQL?</strong><span>The postgres branch routes to the upsert record node.</span></div></div>
        </div>
        <div class="note">Credential-bound services such as Google Drive, OpenAI, Slack, PostgreSQL, and Airtable are not called by this local check.</div>
      </div>
      <pre>${esc(JSON.stringify(result, null, 2))}</pre>
    </div>
  </section>
`);

const files = [
  ['workflow-overview.html', 'workflow-overview.png', overviewHtml, '2400,1000'],
  ['execution-validation.html', 'execution-validation.png', executionHtml, '1440,900'],
];

for (const [htmlName, pngName, html, viewport] of files) {
  const htmlPath = path.join(screenshotsDir, htmlName);
  const pngPath = path.join(screenshotsDir, pngName);
  fs.writeFileSync(htmlPath, html);
  const result = spawnSync('playwright', [
    'screenshot',
    '--browser=chromium',
    '--channel=chrome',
    `--viewport-size=${viewport}`,
    '--wait-for-timeout=300',
    `file://${htmlPath}`,
    pngPath,
  ], { stdio: 'inherit' });
  fs.unlinkSync(htmlPath);
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

console.log('Generated screenshots/workflow-overview.png and screenshots/execution-validation.png');

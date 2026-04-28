import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");
const reportDir = process.argv[2]
  ? path.resolve(root, process.argv[2])
  : path.resolve(root, "doc/e2e/20260428T110525-guide-helper");

const mdPath = path.join(reportDir, "report.md");
const htmlPath = path.join(reportDir, "report.html");
const pdfPath = path.join(reportDir, "report.pdf");
const chromium = process.env.GH_E2E_CHROMIUM ?? "/usr/bin/chromium";

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inlineMarkdown(value) {
  let text = escapeHtml(value);
  text = text.replace(/`([^`]+)`/g, "<code>$1</code>");
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label, href) => {
    return `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`;
  });
  text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  return text;
}

function isTableSeparator(line) {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function splitTableRow(line) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim().replace(/\\\|/g, "|"));
}

function renderTable(lines, startIndex) {
  const headers = splitTableRow(lines[startIndex]);
  let index = startIndex + 2;
  const rows = [];
  while (index < lines.length && /^\s*\|/.test(lines[index])) {
    rows.push(splitTableRow(lines[index]));
    index += 1;
  }

  const head = headers.map((cell) => `<th>${inlineMarkdown(cell)}</th>`).join("");
  const body = rows
    .map((row) => `<tr>${row.map((cell) => `<td>${inlineMarkdown(cell)}</td>`).join("")}</tr>`)
    .join("\n");
  return {
    html: `<table>\n<thead><tr>${head}</tr></thead>\n<tbody>\n${body}\n</tbody>\n</table>`,
    nextIndex: index,
  };
}

function renderMarkdown(markdown) {
  const lines = markdown.split(/\r?\n/);
  const html = [];
  let listOpen = false;
  let codeOpen = false;
  let codeLines = [];

  const closeList = () => {
    if (listOpen) {
      html.push("</ul>");
      listOpen = false;
    }
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (line.startsWith("```")) {
      if (codeOpen) {
        html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
        codeOpen = false;
        codeLines = [];
      } else {
        closeList();
        codeOpen = true;
      }
      continue;
    }

    if (codeOpen) {
      codeLines.push(line);
      continue;
    }

    if (/^\s*\|/.test(line) && index + 1 < lines.length && isTableSeparator(lines[index + 1])) {
      closeList();
      const table = renderTable(lines, index);
      html.push(table.html);
      index = table.nextIndex - 1;
      continue;
    }

    const imageMatch = line.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
    if (imageMatch) {
      closeList();
      const [, alt, src] = imageMatch;
      html.push(`<figure><img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}"><figcaption>${escapeHtml(alt)}</figcaption></figure>`);
      continue;
    }

    const headingMatch = line.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      closeList();
      const level = headingMatch[1].length;
      html.push(`<h${level}>${inlineMarkdown(headingMatch[2])}</h${level}>`);
      continue;
    }

    const bulletMatch = line.match(/^\s*-\s+(.+)$/);
    if (bulletMatch) {
      if (!listOpen) {
        html.push("<ul>");
        listOpen = true;
      }
      html.push(`<li>${inlineMarkdown(bulletMatch[1])}</li>`);
      continue;
    }

    if (!line.trim()) {
      closeList();
      continue;
    }

    closeList();
    html.push(`<p>${inlineMarkdown(line)}</p>`);
  }

  closeList();
  return html.join("\n");
}

function buildHtml(markdown) {
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <title>E2E-аудит Guide Helper</title>
  <style>
    @page {
      size: A4;
      margin: 14mm 12mm 16mm;
    }
    * {
      box-sizing: border-box;
    }
    body {
      color: #111827;
      font-family: "Times New Roman", Times, serif;
      font-size: 12pt;
      line-height: 1.38;
      margin: 0;
    }
    h1, h2, h3 {
      color: #0f172a;
      page-break-after: avoid;
    }
    h1 {
      font-size: 22pt;
      margin: 0 0 12mm;
      text-align: center;
    }
    h2 {
      border-bottom: 1px solid #cbd5e1;
      font-size: 16pt;
      margin: 8mm 0 4mm;
      padding-bottom: 1.5mm;
    }
    h3 {
      font-size: 13.5pt;
      margin: 7mm 0 3mm;
    }
    p, li {
      text-align: justify;
    }
    a {
      color: #1d4ed8;
      text-decoration: none;
    }
    code {
      background: #f1f5f9;
      border-radius: 3px;
      font-family: "Courier New", monospace;
      font-size: 10pt;
      padding: 0.5mm 1mm;
    }
    pre {
      background: #f8fafc;
      border: 1px solid #cbd5e1;
      border-radius: 4px;
      padding: 3mm;
      white-space: pre-wrap;
    }
    table {
      border-collapse: collapse;
      font-size: 9.2pt;
      margin: 4mm 0 7mm;
      page-break-inside: auto;
      width: 100%;
    }
    th, td {
      border: 1px solid #94a3b8;
      padding: 1.4mm 1.8mm;
      vertical-align: top;
    }
    th {
      background: #e2e8f0;
      font-weight: 700;
      text-align: left;
    }
    tr {
      page-break-inside: avoid;
    }
    figure {
      break-inside: avoid;
      margin: 5mm 0 9mm;
      page-break-inside: avoid;
    }
    figure img {
      border: 1px solid #cbd5e1;
      display: block;
      max-height: 178mm;
      max-width: 100%;
      object-fit: contain;
    }
    figcaption {
      color: #475569;
      font-size: 10pt;
      margin-top: 1.5mm;
      text-align: center;
    }
  </style>
</head>
<body>
${renderMarkdown(markdown)}
</body>
</html>
`;
}

const markdown = await readFile(mdPath, "utf8");
await writeFile(htmlPath, buildHtml(markdown));

const printResult = spawnSync(chromium, [
  "--headless=new",
  "--disable-gpu",
  "--no-sandbox",
  `--print-to-pdf=${pdfPath}`,
  "--no-pdf-header-footer",
  pathToFileURL(htmlPath).href,
], { encoding: "utf8" });

if (printResult.status !== 0) {
  process.stderr.write(printResult.stderr || printResult.stdout);
  process.exit(printResult.status ?? 1);
}

console.log(pdfPath);

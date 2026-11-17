'use strict';
// 发布前校验：标签、package.json、src/config.js 与 CHANGELOG.md 中的版本号一致。
// 用法：node scripts/release-check.js v1.7.0 [--notes 输出文件]
// 通过时退出码 0；--notes 时把 CHANGELOG 中该版本的段落写入指定文件，作为 Release 说明。
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const tag = args[0] || '';
const notesIdx = args.indexOf('--notes');
const notesFile = notesIdx > -1 ? args[notesIdx + 1] : null;

const fail = msg => { console.error(`release-check: ${msg}`); process.exit(1); };

const m = /^v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(tag);
if (!m) fail(`标签格式应为 vX.Y.Z 或 vX.Y.Z-rc.N，实际为 "${tag}"`);
const version = m[1];

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
if (pkg.version !== version) fail(`package.json 版本为 ${pkg.version}，与标签 ${tag} 不一致`);

const cfg = fs.readFileSync(path.join(ROOT, 'src/config.js'), 'utf8');
const cfgVersion = (/const VERSION = '([^']+)'/.exec(cfg) || [])[1];
if (cfgVersion !== version) fail(`src/config.js 中 VERSION 为 ${cfgVersion}，与标签 ${tag} 不一致`);

const log = fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8');
const esc = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const section = new RegExp(`^## \\[${esc}\\][^\\n]*\\n([\\s\\S]*?)(?=^## \\[|^\\[[^\\]]+\\]: |(?![\\s\\S]))`, 'm').exec(log);
if (!section) fail(`CHANGELOG.md 中没有 "## [${version}]" 段落`);
const notes = section[1].trim();
if (!notes) fail(`CHANGELOG.md 中 ${version} 段落为空`);

if (notesFile) fs.writeFileSync(notesFile, notes + '\n');
console.log(`release-check: ${tag} 校验通过`);

#!/usr/bin/env node
'use strict';

// Minimal, dependency-light VSIX packager.
//
// `vsce package` is the normal tool, but it needs a newer Node than some
// sandboxes provide. A .vsix is just an OPC ZIP (the same format vsce emits), so
// this script assembles one directly with yazl. Run: `npm run pack:vsix`.

const fs = require('fs');
const path = require('path');
const yazl = require('yazl');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

// Files to ship, mirroring .vscodeignore (out/*.js without maps, media, docs).
function walk(dir, pred, acc = []) {
  for (const name of fs.readdirSync(dir)) {
    const abs = path.join(dir, name);
    const st = fs.statSync(abs);
    if (st.isDirectory()) {
      walk(abs, pred, acc);
    } else if (pred(abs)) {
      acc.push(abs);
    }
  }
  return acc;
}

const files = [
  path.join(root, 'package.json'),
  path.join(root, 'README.md'),
  path.join(root, 'LICENSE'),
  ...walk(path.join(root, 'out'), (f) => f.endsWith('.js')),
  ...walk(path.join(root, 'media'), (f) => f.endsWith('.js') || f.endsWith('.css')),
].filter((f) => fs.existsSync(f));

const xmlEscape = (s) => String(s).replace(/[<>&"']/g, (c) =>
  ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));

const EXT_TO_CT = {
  '.json': 'application/json',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.md': 'text/markdown',
  '.txt': 'text/plain',
  '.vsixmanifest': 'text/xml',
};

const extensions = new Set(['.vsixmanifest']);
for (const f of files) {
  extensions.add(path.extname(f).toLowerCase());
}
const contentTypes = `<?xml version="1.0" encoding="utf-8"?>\n`
  + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n`
  + [...extensions]
    .map((e) => `  <Default Extension="${e.replace(/^\./, '')}" ContentType="${EXT_TO_CT[e] || 'application/octet-stream'}"/>`)
    .join('\n')
  + `\n</Types>\n`;

const manifest = `<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">
  <Metadata>
    <Identity Language="en-US" Id="${pkg.name}" Version="${pkg.version}" Publisher="${pkg.publisher}" />
    <DisplayName>${xmlEscape(pkg.displayName || pkg.name)}</DisplayName>
    <Description xml:space="preserve">${xmlEscape(pkg.description || '')}</Description>
    <Tags>${xmlEscape((pkg.keywords || []).join(','))}</Tags>
    <Categories>${xmlEscape((pkg.categories || []).join(','))}</Categories>
    <GalleryFlags>Public</GalleryFlags>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="${xmlEscape(pkg.engines.vscode)}" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionDependencies" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionPack" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value="workspace,ui" />
    </Properties>
  </Metadata>
  <Installation>
    <InstallationTarget Id="Microsoft.VisualStudio.Code" />
  </Installation>
  <Dependencies />
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.License" Path="extension/LICENSE" Addressable="true" />
  </Assets>
</PackageManifest>
`;

const zip = new yazl.ZipFile();
zip.addBuffer(Buffer.from(contentTypes, 'utf8'), '[Content_Types].xml');
zip.addBuffer(Buffer.from(manifest, 'utf8'), 'extension.vsixmanifest');
for (const abs of files) {
  const rel = 'extension/' + path.relative(root, abs).split(path.sep).join('/');
  zip.addFile(abs, rel);
}

const out = path.join(root, `${pkg.name}-${pkg.version}.vsix`);
zip.outputStream.pipe(fs.createWriteStream(out)).on('close', () => {
  const kb = (fs.statSync(out).size / 1024).toFixed(1);
  console.log(`Packaged: ${out} (${files.length + 2} files, ${kb} KB)`);
});
zip.end();

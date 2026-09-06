'use strict';

const yaml = require('yaml');

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

/**
 * Split a `agent.md` file into its YAML frontmatter object and markdown body.
 *
 * @param {string} raw - full file contents
 * @returns {{ meta: object, body: string }}
 */
function parseFrontmatter(raw) {
  const match = FRONTMATTER_RE.exec(raw);
  if (!match) return { meta: {}, body: raw };
  const meta = yaml.parse(match[1]) || {};
  return { meta, body: match[2].replace(/^\n+/, '') };
}

/**
 * Serialize a meta object + body back into a `---\n<yaml>\n---\n<body>` file.
 *
 * @param {object} meta
 * @param {string} body
 * @returns {string}
 */
function stringifyFrontmatter(meta, body) {
  const yamlBlock = yaml.stringify(meta, { lineWidth: 0 }).trimEnd();
  return `---\n${yamlBlock}\n---\n\n${body.trimEnd()}\n`;
}

/**
 * Rewrite `scripts/<file>` references in an agent body to point at the
 * shared companion-script location, `.amlog/scripts/<agentName>/<file>`.
 *
 * @param {string} body
 * @param {string} agentName
 * @returns {string}
 */
function rewriteScriptPaths(body, agentName) {
  return body.replace(/(^|[\s`'"])scripts\/([\w.-]+)/g, (m, pre, file) => `${pre}.amlog/scripts/${agentName}/${file}`);
}

module.exports = { parseFrontmatter, stringifyFrontmatter, rewriteScriptPaths };

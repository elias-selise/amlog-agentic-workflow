'use strict';

const path = require('path');
const fs = require('fs-extra');

const START_MARKER = '<!-- amlog:start -->';
const END_MARKER = '<!-- amlog:end -->';

/**
 * Detect which agent instruction file exists in the workspace.
 * Priority: AGENTS.md > CLAUDE.md > GEMINI.md > CURSOR.md
 *
 * @param {string} workspaceDir
 * @returns {string|null} absolute path to the detected file, or null
 */
function detectAgentInstructionFile(workspaceDir) {
  const candidates = ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md', 'CURSOR.md'];
  for (const name of candidates) {
    const p = path.join(workspaceDir, name);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/**
 * Remove a legacy amlog-managed `<!-- amlog:start --> ... <!-- amlog:end -->`
 * section from one instruction file, if present. Leaves the rest of the
 * file untouched. Returns true if the file was modified.
 *
 * @param {string} filePath
 * @returns {boolean}
 */
function stripAmlogSection(filePath) {
  if (!fs.existsSync(filePath)) return false;

  const content = fs.readFileSync(filePath, 'utf8');
  const startIdx = content.indexOf(START_MARKER);
  if (startIdx === -1) return false;
  const endIdx = content.indexOf(END_MARKER);
  const sliceEnd = endIdx === -1 ? content.length : endIdx + END_MARKER.length;

  const cleaned = (content.slice(0, startIdx) + content.slice(sliceEnd))
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd();

  if (cleaned.length === 0) {
    fs.removeSync(filePath);
  } else {
    fs.outputFileSync(filePath, `${cleaned}\n`, 'utf8');
  }
  return true;
}

module.exports = { detectAgentInstructionFile, stripAmlogSection };

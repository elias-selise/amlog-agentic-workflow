'use strict';

const prompts = require('prompts');

/**
 * Whether it's safe to show an interactive prompt: not suppressed via --yes
 * and running in a real TTY (not CI/scripted/piped).
 *
 * @param {object} opts - CLI options (checks opts.yes)
 * @returns {boolean}
 */
function canPrompt(opts = {}) {
  return !opts.yes && !!process.stdout.isTTY;
}

/**
 * Ask a yes/no confirmation, but only when canPrompt(opts) is true.
 * Otherwise resolves to `initial` immediately (today's non-interactive default).
 *
 * @param {object} opts
 * @param {string} message
 * @param {boolean} [initial=true]
 * @returns {Promise<boolean>}
 */
async function confirm(opts, message, initial = true) {
  if (!canPrompt(opts)) return initial;
  const { ok } = await prompts({ type: 'confirm', name: 'ok', message, initial });
  return !!ok;
}

module.exports = { canPrompt, confirm };

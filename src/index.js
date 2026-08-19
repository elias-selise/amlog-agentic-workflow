'use strict';

// Public API surface for programmatic use
module.exports = {
  install:  require('./commands/install'),
  update:   require('./commands/update'),
  uninstall: require('./commands/uninstall'),
  upgrade:  require('./commands/upgrade'),
  list:     require('./commands/list'),
  status:   require('./commands/status'),
  manifest: require('./lib/manifest'),
  copyAgents: require('./lib/copy-agents'),
  detectAgentCli: require('./lib/detect-agent-cli'),
  knowledgeBase: require('./lib/knowledge-base'),
};

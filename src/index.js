'use strict';

// Public API surface for programmatic use
module.exports = {
  install:  require('./commands/install'),
  update:   require('./commands/update'),
  uninstall: require('./commands/uninstall'),
  upgrade:  require('./commands/upgrade'),
  list:     require('./commands/list'),
  status:   require('./commands/status'),
  doctor:   require('./commands/doctor'),
  handoff:  require('./commands/handoff'),
  manifest: require('./lib/manifest'),
  copyAgents: require('./lib/copy-agents'),
  detectAgentCli: require('./lib/detect-agent-cli'),
  knowledgeBase: require('./lib/knowledge-base'),
  handoffLog: require('./lib/handoff-log'),
  router: require('./lib/router'),
  workflowConfig: require('./lib/workflow-config'),
};

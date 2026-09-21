Please read @[./AGENTS.md]

## AMLOG Workflow Improvements based on FEEDBACK

- Always add an Implementation Plan as a comment on the relevant card, issue, or bug after implementation.
### Agent Execution Metrics
 - Track and log the following metrics for every agent execution:
    - Token Usage
    - Model Used
    - Time Taken
 - Generic Agent Through Skills
 - Integrate Skills into our workflow to make the Agent more generic, reusable, and adaptable across different framework and language.
    - BMAD, Anthropic and Google's skill integration
### Agent Self-Improvement
 - Self improvement of the planner and implementor agent. It should analyze the codebase and improve itself and also follow codebase pattern.
 - Introduce mechanisms that allow the Agent to learn from previous executions, identify weaknesses, and continuously improve its performance.
### QA Agent Improvements
- Enhance the QA Agent to improve test coverage, validation quality, issue detection, and overall reliability.

### Antigravity Compatibility improvement
    - Agents are not  recognized automatically by agy cli. We need to follow the `agents/agents/<agent-name>/AGENT.md` rule.

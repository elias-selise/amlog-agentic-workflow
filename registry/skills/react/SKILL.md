---
name: react
description: React/frontend conventions for planning and implementing changes in a React codebase — component/hook structure, state management, data-fetching patterns, and build/lint verification.
---

# React Skill

Framework-specific guidance for any agent working against a React frontend. Load this after `codegraph_explore`-ing the target codebase, and apply it in place of any framework knowledge you'd otherwise have to hardcode.

## Planning guidance
- Identify which existing components, hooks, and context/store slices will be affected or extended.
- List new files to create — components, hooks, contexts, or utility modules — with their proposed paths, following the project's existing folder convention (feature-based, atomic, or type-based).
- Define the data flow: which API endpoints will be consumed, via which data-fetching layer already in use (React Query/TanStack Query, SWR, RTK Query, or a plain fetch/axios service), and the expected request/response shapes.
- Identify any shared state changes required (Redux/RTK, Zustand, Context API, Jotai, or whatever store is already established) — do not introduce a new state-management library when one is already in use.

## Implementation guidance
- Use function components and hooks; do not introduce class components unless the codebase already relies on them.
- Follow the project's existing naming conventions, folder structure, and import/export patterns (barrel files, path aliases, co-located styles/tests).
- Wire up API calls using the project's existing data-fetching hook/service layer and HTTP client — do not introduce a new HTTP client or fetching pattern.
- Respect the existing hook conventions: keep side effects in `useEffect`, memoize only where the codebase already does (`useMemo`/`useCallback`), and extract shared logic into custom hooks matching the existing naming (`useX`).
- Match the codebase's existing styling approach (CSS Modules, styled-components, Tailwind, etc.) rather than introducing a new one.
- Write unit tests for every new component and hook, following the existing test patterns (Jest or Vitest + React Testing Library) in the codebase.

## Verification commands
Check `package.json` `scripts` first, since names vary by project (CRA, Vite, Next.js). Typically:
- `npm run build` (or `vite build` / `next build`) — must pass with no errors.
- `npm run lint` — fix any lint issues before handing off.
- `npm test -- --watchAll=false` (or `vitest run`) — all tests must pass before handing off.

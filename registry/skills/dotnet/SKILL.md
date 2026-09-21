---
name: dotnet
description: .NET/backend conventions for planning and implementing changes in a .NET codebase — layered architecture, validation, DI, and build/test verification.
---

# .NET Skill

Framework-specific guidance for any agent working against a .NET backend. Load this after `codegraph_explore`-ing the target codebase, and apply it in place of any framework knowledge you'd otherwise have to hardcode.

## Planning guidance
- Understand the project's layered architecture (Controllers, Services, Repositories, DTOs).
- Identify which existing controllers, services, and repositories will be affected or extended.
- List new files to create — controllers, services, repositories, DTOs, validators — with their proposed namespaces and paths.
- Define the API contract: HTTP method, route, request DTO, response DTO, and HTTP status codes.
- Identify any new database migrations required and describe the schema change.

## Implementation guidance
- Follow the project's existing naming conventions, namespace structure, and dependency-injection patterns.
- Add FluentValidation rules for any new request DTOs; do not leave input validation to the controller.
- Write xUnit unit tests for every new service method, following the existing test patterns (Arrange/Act/Assert, mocked dependencies).

## Verification commands
- `dotnet build` — must compile with no errors or warnings.
- `dotnet test` — all tests must pass before handing off.

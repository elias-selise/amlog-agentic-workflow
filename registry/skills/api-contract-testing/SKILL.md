---
name: api-contract-testing
description: How to verify an HTTP API honours its contract — finding the contract, the checklist of what to assert per endpoint, how to write contract tests that follow the codebase's existing test patterns, and how to detect breaking changes against the base branch.
---

# API Contract Testing

A contract test checks the **shape and rules of an API's promise** (status codes, schemas, auth, validation errors), not the business logic behind it. Unit tests prove the code does what the developer meant; contract tests prove the consumers (the front end, other services) can still rely on what was promised.

Follow the codebase. Before writing anything, look at how the existing integration/API tests are built (via `codegraph_explore` on the test projects) and copy that style: the test base class, the `WebApplicationFactory` or fixture, auth helpers, naming. These notes say what to check, not how your repo spells it.

## 1. Find the contract (in this order)

1. **The OpenAPI/Swagger spec**: a checked-in `swagger.json` / `openapi.(json|yaml)`, or the one the running API serves (`/swagger/v1/swagger.json`). It is the source of truth when it exists.
2. **The code**: controllers/endpoints, request and response DTOs, validators (`FluentValidation`, data annotations), `[Authorize]` attributes, `[ProducesResponseType]`. Use `codegraph_explore` on the changed controllers to read them and their callers.
3. **The consumer**: the front end's API client/service for these endpoints (`codegraph_explore` for the Angular/React service). What the UI actually reads is the contract that matters most; a field the UI reads that the API stops sending is a breaking change even if the spec still lists it.
4. **The story AC** (`docs/<issue-number>/instructions.md`): every AC that mentions an endpoint, status, field or error message becomes at least one test.

If the spec and the code disagree, that is itself a finding (`category: contract`). Report it; don't paper over it by fixing one side.

## 2. Checklist per changed endpoint

| Area | Assert |
|---|---|
| **Success path** | Documented status code (200/201/204), `Content-Type`, response matches the schema: required fields present, types right, enums in range, no undocumented extra fields leaking (internal ids, hashes, audit columns) |
| **Create semantics** | `201` + `Location` header; the created resource is retrievable; response echoes the persisted values |
| **Validation (400)** | Missing required field, wrong type, too long/short, out-of-range, malformed JSON → `400` with the project's error shape (`ProblemDetails`/validation errors naming the field), never a `500` |
| **Auth** | No token → `401`; valid token without the permission/role → `403`; another user's resource → `403`/`404` (IDOR); expired/garbled token → `401` |
| **Not found / conflict** | Unknown id → `404`; duplicate unique value → `409` (or the project's convention) |
| **Boundaries** | Empty collection → `[]` not `null`/`404`; page size 0, 1, max, max+1; `null` vs omitted vs empty string; unicode and very long strings |
| **Pagination / filtering / sorting** | Stable shape (`items`, `total`, `page`...), deterministic order, invalid sort/filter field → `400` |
| **Idempotency** | Repeated `PUT`/`DELETE` give the same result; a repeated `POST` doesn't silently create a duplicate when it shouldn't |
| **Errors** | No stack traces, SQL, internal paths or server versions in any error body |
| **Compatibility** | Existing fields keep name, type, nullability; new required request fields are breaking; removed/renamed response fields are breaking (section 4) |
| **Headers / CORS** | Required headers; CORS only for allowed origins on the changed route |

Only assert what the contract promises. Don't assert incidental behaviour (field order, exact message wording unless the AC fixes it); over-specified tests become flaky and block harmless changes.

## 3. Writing the tests (.NET)

- xUnit, in the existing integration/API test project, using the project's existing `WebApplicationFactory<Program>` (or equivalent) fixture, with an in-memory or test database as the repo already does. Never point tests at a shared/real environment.
- Tag every test so the runner can find it: `[Trait("Category", "Contract")]`. Add `[Trait("Category", "Security")]` as well for auth/IDOR/injection checks so `test-executor-amlog` counts them in its security coverage.
- Name tests `Endpoint_Scenario_ExpectedStatus` and put the AC id in the name when there is one (`Orders_Post_MissingCustomer_Returns400_AC2`).
- One behaviour per test. Arrange data inside the test (or a builder); no ordering dependencies, no shared mutable state, no `Thread.Sleep`, no wall-clock or random values without a seed.
- Schema checks: deserialize into the DTO and assert required members, or validate the raw JSON against the spec's schema if the repo already has a validator. Don't just assert `IsSuccessStatusCode`.
- Don't modify production code to make a contract test pass. If the API is wrong, that's a bug: report it.

## 4. Breaking-change detection

Compare the current spec with the base branch's spec (`oasdiff breaking <base> <current>` in `run-contract-tests.sh`). Treat these as **breaking** unless the AC explicitly asks for them and a version bump or deprecation exists:

- Removed endpoint, method, or parameter; a path or method renamed
- New required request parameter or request body property
- Response property removed, renamed, or made nullable; type or format changed; enum value removed
- Status code the client handles removed; stricter validation on an existing input
- Auth requirement added to a previously open endpoint

Additive changes (new optional field, new endpoint) are fine, but note them so the front-end plan stays in sync.

## 5. Fuzzing (optional depth)

With a running API and a spec, `schemathesis run <spec> --url <base-url> --checks all` generates inputs from the schema and flags 5xx responses, schema violations and wrong status codes. Treat any 5xx from generated input as a real finding (unhandled input), and keep the failing example in the report as the repro.

## 6. Depth

`smoke` (back end changed, but not the API surface): run the existing contract tests for the touched endpoints plus the breaking-change diff. `full` (controllers, DTOs, validators, or OpenAPI changed): the whole checklist above for every changed endpoint, plus fuzzing if a running API is available.

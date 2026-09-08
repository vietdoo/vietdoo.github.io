---
title: "Token-Optimized Spring Boot Codebase Architecture"
description: "A guide to structuring source code to help AI understand faster, generate accurately, and reduce token costs throughout the product development lifecycle with Java 21 & Spring Boot 3.x."
pubDate: 2026-03-06
category: "architecture"
image: "/blog/spring-boot-ai-code-structure/springboot-ai-cover.webp"
lang: "en"
translationKey: "spring-boot-ai-code-structure"
draft: false
---

![Token-Optimized Spring Boot Codebase Architecture](/blog/spring-boot-ai-code-structure/springboot-ai-cover.webp)

* **Audience**: Developers & Tech Leads
* **Tech Stack**: Java 21 · Spring Boot 3.x

---

## PART 01 · CONTEXT

### THE PROBLEM: Tokens are the new cost of the development lifecycle

Traditional codebases force AI to read too many files just to understand a minor change.

* **Context Window**: Every prompt has a limit. Scattered files = more files to load = less room for reasoning.
* **Repetition Cost**: AI generates errors → prompt repeated → token cost doubled. Clear architecture eliminates this loop.
* **Accuracy**: When context is diluted, AI guesses more. Better structure = more reliable output.
* **AI Onboarding**: Fresh AI every session. The codebase must self-describe so you don't re-explain every time.

---

### PHILOSOPHY: AI-First Code Organization

Organize source code so AI only needs to read a small, precise region to make correct modifications.

> **LOCALITY**: Everything related to a feature stays together.

1. **01 Self-describing**: File, package, and class names declare their function — no external context needed.
2. **02 Bounded context**: Each feature has explicit boundaries; AI knows exactly what to read.
3. **03 Stable contracts**: Stable entry points; internal implementation changes do not leak out.

---

## PART 02 · PRINCIPLES

### 06 CORE PRINCIPLES

Rules for organizing source code for AI. Apply simultaneously. Each principle reduces the tokens AI requires for a task.

1. **Feature-based, not Layer-based**: Group by business domain, not by file type.
2. **One file, one responsibility**: Short files, clear names — AI can digest completely.
3. **Explicit Public API**: A single `api/` folder describing everything accessible externally.
4. **Strict Collocation**: DTOs, mappers, exceptions, and tests sit alongside the logic using them.
5. **Colocated Documentation**: Short README inside each feature serving as context anchors.
6. **Convention over Configuration**: Predictable naming; eliminate manual wiring where possible.

---

### PATTERN 01: Vertical Slice — Grouping by Feature

Each feature is a self-contained vertical slice: `controller` → `service` → `repository` → `DTO` → `test`.

#### FIG. 02 — Feature slice (`features/billing/`)
* `BillingController`
* `BillingService`
* `BillingRepository`
* `Invoice`, `Payment` (DTO + Entity)
* `BillingMapper` · `BillingException`
* `BillingServiceTest`

#### WHY DOES IT SAVE TOKENS?
* AI only needs to load a single folder to understand the full domain logic.
* No hunting for DTOs in `dto/` or exceptions in `exception/`.
* Modifying business logic in a feature doesn't pull external files into the prompt.
* Tests sit next to code → AI generates tests closely tied to current behavior.

> *"Read one folder — fix one feature."*

---

### COMPARISON: Layered (Traditional) vs Feature-based

![Layered Architecture vs Feature-based AI-Friendly Architecture](/blog/spring-boot-ai-code-structure/layered-vs-feature.webp)

For the same business change — the number of files AI must load is vastly different.

| Layered Architecture (Traditional) | Feature-based Architecture (AI-Friendly) |
| :--- | :--- |
| **`src/`**<br>• `controller/` ← 1 file here<br>• `service/` ← 1 file here<br>• `repository/` ← 1 file here<br>• `dto/` ← 2 files here<br>• `mapper/` ← 1 file here<br>• `exception/` ← 1 file here | **`features/billing/`**<br>• `BillingController.java`<br>• `BillingService.java`<br>• `BillingRepository.java`<br>• `dto/` `Invoice.java`, `Payment.java`<br>• `BillingMapper.java`<br>• `BillingException.java` |
| ⚠️ **Tokens to understand 1 feature**: ~ 7 files scattered across 6 folders | ✅ **Tokens to understand 1 feature**: 1 single folder |

---

## PART 03 · STRUCTURE

### PROPOSED DIRECTORY STRUCTURE: Spring Boot project layout

Three clean zones: `app` (startup), `features` (domain), `shared` (cross-cutting utilities).

```text
FIG. 03 — src/main/java/com/company/app

app/
  Application.java           · main + @SpringBootApplication
  config/                    · 1 file per concern
features/
  billing/                   · 1 bounded context = 1 folder
    api/                     · public DTO + internal gateway
    web/                     · Controller, request/response
    domain/                  · Service, Entity, business rules
    data/                    · Repository, JPA mappings
    BillingModule.java       · public Spring config
  auth/                      · ...
shared/
  error/ result/ time/       · domain-free utilities
```

#### NAMING CONVENTIONS
* 1 feature directory = 1 domain noun.
* Mandatory suffixes: `Controller`, `Service`, `Repository`.
* Module class exports public beans externally.
* `shared/` contains only domain-agnostic utilities.

> 💡 **PROMPT TIP**:  
> *"Modify logic in `features/billing/domain` — do not touch `api/`."*

---

### NAMING CONVENTIONS: Names are the cheapest documentation for AI

Every name provides semantic hints, helping AI pinpoint the right file without reading contents.

| FILE / CLASS | PURPOSE | METHOD | PURPOSE |
| :--- | :--- | :--- | :--- |
| `InvoiceController` | HTTP Endpoint for invoices | `createInvoice(...)` | Action + primary noun |
| `InvoiceService` | Use-case logic | `findInvoiceById(...)` | Prefixed with `find` / `get` / `list` |
| `InvoiceRepository` | Data access | `assertPaid(...)` | Checks domain invariants |
| `InvoiceCreateRequest` | Specific input DTO | `toResponse(...)` | Clear mapper direction |
| `InvoiceMapper` | Entity ↔ DTO conversion | `onPaymentReceived(...)` | Event handler prefixed with `on` |

---

### GRANULARITY: One file — One job

Smaller files loaded into prompts are cheaper; massive files force AI to skip or skim.

* **≤ 200 lines/file**: Fits local context perfectly; avoids over-fragmentation.
* **≤ 7 methods/class**: Classes with > 7 methods signal a need to split responsibilities.
* **1 reason to change**: Original SRP: a file changes for one business reason.
* **0 external feature dependencies**: Feature logic does not call another feature directly — always via `api/`.

---

## PART 04 · DOCUMENTATION

### CONTEXT ANCHORS: Living documentation beside code

Short Markdown files — AI reads once, grasps the entire module without scanning the repo.

```text
FIG. 04 — features/billing/

README.md              · 1 paragraph purpose + list of use-cases.
ARCHITECTURE.md        · Data flow diagram, boundaries with other features.
DECISIONS.md           · Short ADR — why this approach was chosen.
api/package-info.java  · Public contract documented via Javadoc.
CHANGELOG.md           · Public API change history.
```

#### ROLE OF EACH FILE
* `README.md` is the anchor: 5 lines to prime AI context quickly.
* `ARCHITECTURE.md` holds ASCII diagrams — machine-readable without images.
* `DECISIONS.md` prevents AI from re-proposing rejected options.
* Javadoc in `api/` acts as a strict contract AI must honor.

---

### BOUNDARY CONTRACT: Single gateway per module

External code only sees `api/` — the rest is a black box for both developers and AI.

![Module Boundary Contract Architecture Diagram](/blog/spring-boot-ai-code-structure/module-boundary-contract.webp)

```text
OrderModule ──> billing/api ──> [ billing (internal) ]
                                ├── domain/
                                ├── data/
                                ├── web/
                                └── mapper/
```

> **AI only reads `api/` to invoke correctly — avoiding loading 20 internal files.**

#### GATEWAY RULES
* Only immutable interfaces + DTOs reside in `api/`.
* Never leak JPA Entities outside the feature.
* Cross-feature calls go through Module beans, never injecting internal Services.
* ArchUnit tests strictly enforce boundaries.

---

## PART 05 · CODE PATTERNS

### PATTERNS: Token-saving structure tips

Applied at the class level — helps AI output correctly with minimal tokens.

* **Self-contained DTO**: Request/Response defined right next to Controller (`record`). AI sees I/O right at the endpoint.
* **Explicit Result types**: Return `Result<T,Error>` or `sealed class` — AI understands all possible outcomes.
* **Static factories**: `Invoice.draft(...)`, `Invoice.finalize(...)` — explicit use-case names without parsing constructors.
* **Minimal Annotations**: Use `@RestController`, `@Transactional` at top level; avoid stacking 5 annotations per method.
* **Inline test data builder**: Builders at the end of test files — AI generates new tests without searching `fixtures/`.
* **Comment 'WHY', not 'WHAT'**: Code expresses WHAT. Comments only record business decisions AI cannot infer.

---

### ANTI-PATTERNS: Practices that force AI to waste tokens

Each anti-pattern below pulls excessive files into context.

| ANTI-PATTERN | WHY IT WASTES TOKENS |
| :--- | :--- |
| **God Service** | Service > 1000 lines — AI constantly loads full file to modify one line. |
| **Global DTOs** | Shared `dto/` folder with 200 cross-used records — AI can't tell which fits. |
| **Vague Common Utils** | `StringUtils`, `CommonUtils` — AI guesses methods and duplicates logic. |
| **Reflection / Magic** | Logic relies on runtime field names — AI cannot infer behavior. |
| **Scattered XML Configs** | Wiring detached from classes — AI must read multiple locations for beans. |
| **Circular Feature Dependencies** | Requires recursive module loading — context explodes. |

---

## PART 06 · OPERATIONS

### WORKFLOW: Prompting process on the new structure

Leverage feature folders to save tokens at every step.

![5-Step AI Prompting Workflow Diagram](/blog/spring-boot-ai-code-structure/ai-prompting-workflow.webp)

1. **Locate**: Target only the specific feature folder — don't paste the whole repo.
2. **Anchor**: Attach `README.md` + `ARCHITECTURE.md` of that feature.
3. **Constrain**: List permitted `api/` and `shared/` usage. Forbid other areas.
4. **Generate**: Request outputs using absolute file paths within the feature.
5. **Verify**: Run ArchUnit + tests beside code. AI fixes loops inside the same folder.

> 🚀 **TYPICAL RESULTS**: Reduces **40–70% tokens** per prompt once structured.

---

### CHECKLIST & CONCLUSION: Audit and Apply

Ten actionable steps to transition your Spring Boot codebase into an AI-friendly state:

- [ ] **1.** Refactor current project into feature folders.
- [ ] **2.** Add `api/` for each feature, hiding internals.
- [ ] **3.** Write concise `README.md` ≤ 10 lines per feature.
- [ ] **4.** Set up ArchUnit to enforce architectural boundaries.
- [ ] **5.** Standardize suffixes: `Controller`/`Service`/`Repository`.
- [ ] **6.** Colocate DTOs per feature, delete global `dto/`.
- [ ] **7.** Replace global utils with feature-local helpers.
- [ ] **8.** Add `ARCHITECTURE.md` with ASCII diagrams.
- [ ] **9.** Update prompt templates to point directly to feature paths.
- [ ] **10.** Track average tokens per PR — target continuous reduction.

> ### *"Good architecture is the best prompt."*

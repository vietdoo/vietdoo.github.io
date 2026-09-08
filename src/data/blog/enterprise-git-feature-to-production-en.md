---
title: "From Feature Branch to Production: How My Company Ships a Public-Service Feature Safely"
description: "A practical enterprise Git and release playbook, illustrated by an iGate step-3 feature that lets an officer send a status email to a citizen without bypassing authorization, audit, or deployment controls."
pubDate: 2026-08-26
category: "architecture"
image: "/blog/enterprise-git-feature-to-production/branch-flow.webp"
lang: "en"
translationKey: "enterprise-git-feature-to-production"
draft: false
---

![An enterprise Git workflow moves an iGate step-3 citizen email feature from a short-lived feature branch through review, integration, release, and verified production](/blog/enterprise-git-feature-to-production/branch-flow.webp)

At my company, a feature request can look deceptively small.

“Add a button so the officer can send the citizen an email while the application is being processed.”

The button may take an afternoon. The production feature does not. In a public-service workflow, the important questions are not only whether the button looks right or whether the email provider accepts a request. We also need to know who is allowed to send it, whether the application is really at step 3, whether the message is sent once, whether the action is auditable, whether the change is compatible with the current database, and whether we can disable it without taking the whole service offline.

That is why source control is not merely a place to store code. It is part of the operating model for trust.

> **The thesis:** A feature branch is safe only when the entire path from branch creation to production is controlled: small change set, explicit review, automated evidence, immutable artifact, environment-specific promotion, reversible release, and a clear owner for rollback.

This article uses a fictionalized iGate workflow. It does not describe any private organization, production topology, citizen data, or internal policy. The names and identifiers in the examples are deliberately synthetic. The practices are general engineering guidance, not a substitute for the security, privacy, records-management, or change-management rules that apply to a particular public-service system.

## Start with one canonical production branch

Large organizations often inherit a mixture of names: `dev`, `develop`, `staging`, `release/*`, `main`, and `master`. The problem is not that every repository has the same number of branches. The problem is ambiguity. If two branches are described as “production,” engineers eventually ask which one is authoritative, which one receives hotfixes, and which one the deployment pipeline trusts.

Our rule is simple: choose one canonical production branch. In a newer repository it may be `main`; in a legacy repository it may still be `master`. The name is less important than the contract. The production branch is protected, reviewed, continuously validated, and the only branch from which a production release can be promoted. If both `main` and `master` exist during a migration, one is canonical and the other is explicitly transitional. They are not two independent production truths.

A short-lived feature branch still gives developers isolation and a review surface. It should not become a private development environment that diverges from the product for weeks. DORA describes trunk-based development as frequent integration of small batches into a shared trunk and connects it to continuous integration; its guidance emphasizes keeping trunk green and avoiding large integration phases.[1] That does not mean every regulated organization must deploy directly from trunk. It means the distance between a change and the shared truth should stay small.

| Branch or environment | Purpose | Who can change it | What it must never become |
|---|---|---|---|
| `feature/*` | One coherent change, bug fix, or experiment | Feature owner and collaborators | A long-lived copy of the product |
| `dev` | Shared integration and contract testing | Merged through PR | A permanent substitute for production validation |
| `staging` / UAT | Production-like verification with safe external dependencies | Pipeline and approved operators | A manually patched server |
| `main` or `master` | Canonical production source and release record | Protected PR or merge queue | A branch anyone can push to |
| `release/*` | Optional stabilization snapshot for a specific release train | Release team under policy | A second place where new features are invented |

This model is compatible with both short-lived feature branches and a legacy promotion flow. The branch names are not the safety mechanism. The safety mechanism is the evidence required to move between them.

## The example feature is a workflow change, not a button

Consider a citizen application moving through a defined procedure. At step 3, an officer is reviewing and processing the application. The product request is to add a button named **Send status email** so the officer can notify the citizen that processing is underway or that additional information is required.

The first design is tempting and unsafe:

```text
Browser button -> POST /send-email -> mail provider
```

The browser should not decide whether an email is permitted, which application is in scope, or whether the current workflow step is 3. A safer design makes the browser a request surface and keeps authority in the backend:

![The step-3 email feature validates the officer, application scope, workflow state, outbox event, idempotency, provider delivery, and audit trail](/blog/enterprise-git-feature-to-production/email-feature-flow.webp)

```text
Officer clicks button
        |
        v
Backend command validates identity, role, application scope, and step = 3
        |
        v
Transactional outbox records email_requested
        |
        v
Worker sends through a provider with an idempotency key
        |
        v
Delivery status and audit event are recorded
```

The feature contract should be written before the branch is created. A useful contract might say:

| Contract | Decision for this feature |
|---|---|
| Actor | An authenticated officer assigned to the application or an explicitly authorized supervisory role |
| Scope | One application, one citizen recipient, one workflow instance |
| State precondition | The application is at step 3 and is not closed, cancelled, or already escalated beyond the permitted action |
| Message | A versioned template with an approved subject and safe variables; no arbitrary HTML from the browser |
| Side effect | At most one accepted request for the same application, template, and business event unless a deliberate resend policy exists |
| Audit | Actor, application reference, step, template version, request ID, result, and timestamps; never log the full citizen message body by default |
| Recovery | Retry transient provider failures, surface permanent failures, and allow an authorized resend without hiding the first attempt |

This small table prevents a common failure mode: a developer implements the visible interaction while the system quietly lacks a definition of “allowed to send.”

## Create a branch that tells the truth

A branch name is a routing hint for humans and automation. It should identify the change without embedding a ticket’s private citizen information:

```bash
git switch main
git pull --ff-only origin main
git switch -c feature/igate-step3-citizen-email
```

A reasonable naming convention is:

```text
feature/<bounded-change>
fix/<bounded-defect>
chore/<maintenance>
release/<version-or-train>
hotfix/<production-defect>
```

Avoid names such as `feature/new-button-final-final`, `john-test`, or a branch containing a citizen’s name or application number. Source-control metadata is searchable, mirrored, and often retained longer than the feature itself.

The first commit should not contain unrelated formatting changes. A clean sequence might be:

```text
feat(workflow): add step-3 email command contract
feat(workflow): authorize citizen status email action
feat(notification): persist email request in outbox
feat(notification): send idempotent status email
feat(ui): expose email action for eligible step-3 cases
test(notification): cover duplicate and retry paths
```

These commits are not a ceremony requirement. They make the change reviewable. A reviewer can understand the contract, authorization, side effect, UI condition, and negative tests without reconstructing one giant diff.

If the feature is too large to review in one coherent PR, split it into backward-compatible increments. For example, merge the backend command and feature flag first, then the worker, then the UI exposure. The incomplete increments must be harmless when disabled. A feature flag is useful only when the old path remains safe and supported; it is not permission to merge broken code into the shared branch.

## Local validation is part of the branch contract

Before opening a pull request, the feature owner should run the same high-value checks that CI will run. The exact command depends on the repository, but the sequence should cover at least:

```bash
pnpm lint
pnpm test
pnpm check
pnpm build
```

For a Java/Spring service, the equivalent may be:

```bash
./mvnw verify
./mvnw test -Dtest=CitizenEmailCommandTest
./mvnw spring-javaformat:validate
```

The important part is not the package manager. It is that the feature owner can reproduce the quality gate locally and attach meaningful evidence to the PR.

For the iGate feature, the test matrix should include more than “the button appears.” It should verify authorization, state, side effects, and failure recovery:

| Test slice | Expected result |
|---|---|
| Authorized officer, application at step 3 | Command accepted and one outbox event created |
| Officer without assignment or permission | `403` or domain denial; no outbox row and no email attempt |
| Application at step 2 or step 4 | Domain rejection; the UI cannot bypass the backend rule |
| Closed or cancelled application | No send; a truthful reason is returned to the operator |
| Duplicate request ID | Existing result is returned; no second provider request |
| Worker timeout after provider acceptance | Reconciliation prevents an accidental duplicate send |
| Invalid template variable | Build/test or command validation rejects the request before delivery |
| Mail provider temporary outage | Bounded retry and visible pending/failed status; no infinite loop |
| Cross-tenant application reference | Request is denied even if the officer guesses the ID |
| Audit persistence failure | The system follows its declared policy; it must not claim a successful send without evidence |

The code review should ask whether each row is represented in code or an explicit test. “The happy path works” is not a release argument for a public-service side effect.

## The backend must own authorization and idempotency

A minimal command can express the business boundary more clearly than a controller that mixes authorization, state checks, database writes, and provider calls:

```ts
type SendCitizenStatusEmail = {
  requestId: string;
  applicationId: string;
  template: "processing_started" | "additional_information_required";
  actorId: string;
};

async function requestCitizenEmail(command: SendCitizenStatusEmail) {
  const actor = await identity.requireAuthenticated(command.actorId);
  const application = await applications.getForActor(
    command.applicationId,
    actor,
  );

  if (application.workflowStep !== 3) {
    throw new DomainError("EMAIL_ACTION_REQUIRES_STEP_3");
  }

  await policy.require(actor, "send_citizen_status_email", application);

  return db.transaction(async (tx) => {
    const existing = await tx.outbox.findByRequestId(command.requestId);
    if (existing) return existing.result;

    const event = await tx.outbox.insert({
      requestId: command.requestId,
      type: "citizen_status_email_requested",
      aggregateId: application.id,
      template: command.template,
      templateVersion: await templates.currentVersion(command.template),
      actorId: actor.id,
    });

    await tx.audit.append({
      action: "citizen_status_email_requested",
      actorId: actor.id,
      applicationId: application.id,
      workflowStep: application.workflowStep,
      requestId: command.requestId,
    });

    return event;
  });
}
```

The browser may hide the button for an ineligible application, but that is a usability optimization, not an authorization boundary. The API repeats the check because clients, URLs, and cached screens cannot be trusted to represent current workflow state.

The email worker should not treat a network timeout as proof that no email was sent. It needs a provider request identifier, a bounded retry policy, delivery status, and a reconciliation path. The worker may use a per-business-event idempotency key such as:

```text
igate:<application-id>:<workflow-step>:<template-version>:<business-event-id>
```

Do not derive the key from mutable display text. If the officer changes the message template later, the event identity should still be understandable and auditable.

## Pull request review is a control, not a popularity contest

When the branch is ready, open a PR into `dev` if `dev` is the integration branch. The PR description should make the change executable for a reviewer:

```markdown
## What changed
Adds the step-3 citizen status email command, outbox event, worker handling,
and a feature-flagged action in the processing screen.

## Invariants
- Backend requires authorized actor and workflowStep = 3.
- Browser visibility is not used as authorization.
- Duplicate requestId does not create a second outbox event.
- No citizen message body is written to ordinary application logs.

## Validation
- Unit tests: passed
- Integration tests: passed
- Contract tests: passed
- Build image digest: sha256:...

## Rollback
Disable `igate.step3.citizen_email` first; then roll back the image if needed.

## Risk / data change
No destructive schema change. Adds an outbox index and a nullable delivery-status field.
```

For important branches, GitHub supports protection settings such as required pull-request reviews, required status checks, conversation resolution, signed commits, linear history, merge queue, successful deployments, and restricted pushes.[2] The exact configuration is a repository governance decision, but the principle is universal: a protected production branch should not depend on personal memory or the goodwill of the person holding an admin token.

Code owners should review authorization, data handling, and external side effects. A UI reviewer should check the operator experience. A service owner should check compatibility and operational load. The number of approvals should reflect risk rather than become a ritual that makes small changes wait for days.

## Merge into `dev`: integration, not production

The first merge target is usually the shared integration branch:

```bash
git fetch origin
git rebase origin/dev
git push --force-with-lease origin feature/igate-step3-citizen-email
```

The PR should merge only after the required checks pass on the current base. If the repository is busy, a merge queue is safer than a race between several green PRs. GitHub describes a merge queue as a way to validate a change on the latest target branch together with changes already queued, using temporary merge-group branches and required checks.[3]

That distinction matters. A feature can be green on its own branch and fail when combined with another change that touches the workflow transition, notification template, or database index. The integration branch is where contract tests, service-to-service tests, and realistic fixture flows should expose that incompatibility.

After the merge into `dev`, the pipeline should publish an immutable build artifact. Do not rebuild from the same Git commit separately for staging and production. Build once, record the commit SHA and image digest, and promote that same artifact:

```text
source commit -> build once -> image digest -> staging -> UAT -> production
```

A different artifact from the same source is not the same release. Dependencies, timestamps, build flags, or generated files may differ. The digest gives the release a concrete identity.

## Promote through staging and UAT with safe dependencies

The staging environment should resemble production in the ways that affect the feature: authentication claims, workflow state transitions, database compatibility, queue behavior, template rendering, audit permissions, and timeout handling. The mail provider should be sandboxed or routed to a controlled sink. No test should send a real message to a real citizen.

UAT should follow the citizen and officer journey, not just invoke an endpoint:

1. Create a synthetic application that is explicitly at workflow step 3.
2. Sign in as an authorized officer and verify the action is visible.
3. Send the notification through a mail sandbox and inspect the rendered template.
4. Repeat the request and confirm the user sees a truthful duplicate or already-sent state.
5. Change the workflow step and confirm the backend rejects the action.
6. Review audit evidence without exposing unnecessary personal content.
7. Disable the feature flag and confirm the rest of processing still works.

If a database change is required, make it compatible with both the old and new application versions. An additive outbox index or nullable delivery field can be deployed before the new code. A destructive column removal should wait for a later contract phase after all old pods and workers are gone. Kubernetes supports gradual `RollingUpdate` replacement and keeps revision history for rollback, but the deployment controller cannot tell whether the citizen workflow is semantically correct.[5]

## Promote to `main` or `master`, not around it

Once `dev`, staging, and UAT have produced evidence, promote the same reviewed change to the canonical production branch. There are two safe patterns:

| Pattern | When it fits | Risk control |
|---|---|---|
| PR from `dev` to `main`/`master` | The integration branch represents a release candidate | Review the complete diff and rerun required checks on the production base |
| Release branch from a known commit | Several changes are being stabilized for a release train | Only approved fixes enter the branch; changes are merged back to the canonical branch |

Do not solve a failed production release by pushing directly to `main` or `master`. A hotfix should still have a branch, a PR, checks, an incident or change reference, and a follow-up merge back into the normal line. Emergency speed should reduce ceremony, not remove traceability.

A repository with both `main` and `master` needs a migration rule. For example:

```text
Before migration: master is canonical production; main is read-only transition.
After migration: main is canonical production; master is protected and points to the final legacy release.
```

The worst state is two branches both receiving manual fixes and both being candidates for deployment.

## Merge is not deploy, and deploy is not release

These words describe different events:

| Event | What happened | What has not happened yet |
|---|---|---|
| Commit | A source snapshot exists | It has not been reviewed or built |
| Merge | The change entered a target branch | It has not necessarily reached an environment |
| Build | An artifact was produced | It has not been proven in production |
| Deploy | An artifact was placed in an environment | Users may still be behind a flag or traffic split |
| Release | The capability is intentionally available to users | Monitoring and rollback ownership still matter |

The production pipeline should make these boundaries visible. A typical sequence is:

![The deployment pipeline gates source changes with CI, immutable artifacts, staging/UAT, approval, canary or rolling rollout, smoke tests, metrics, and rollback](/blog/enterprise-git-feature-to-production/deploy-gates.webp)

```text
PR checks
  -> build and scan
  -> immutable artifact
  -> deploy staging
  -> UAT and smoke tests
  -> change approval
  -> canary or rolling production
  -> readiness and smoke checks
  -> business and technical metrics
  -> promote or abort
```

GitHub environments can attach protection rules to deployment targets; a job referencing an environment must satisfy those rules before it can run or access that environment’s secrets.[4] The equivalent control in another CI/CD platform may be called an approval gate, protected environment, change window, or deployment policy. The name is less important than the separation between build credentials, staging credentials, and production credentials.

For the email feature, the production gate should answer:

- Is the artifact built from the reviewed commit?
- Did authorization and duplicate-event tests pass?
- Is the template version approved and present in the production configuration?
- Is the mail provider sandbox disabled only for the intended production environment?
- Are queue depth, provider error rate, delivery latency, and audit-write failures observable?
- Is the feature flag default still off until smoke verification is complete?
- Who owns the decision to promote, pause, or roll back?

## Use a flag to reduce blast radius, not to hide unfinished work

A production deploy can contain code that is not yet enabled for every operator. That is useful when the disabled code is backward compatible and tested. A rollout might proceed as:

```text
0% enabled -> internal test account -> one office or cohort -> 5% -> 25% -> 100%
```

The flag should be scoped, audited, and reversible. It should not be a permanent condition that makes the system impossible to reason about. Give it an owner, an expiry or cleanup issue, a default value, and a kill-switch procedure.

For a public-service email action, a cohort can be safer than a random percentage. Start with a synthetic or internal account, then a small operational unit that has agreed to observe the workflow. Avoid enabling the feature for cases that require special templates or legal wording until those variants have passed UAT.

## Rolling update, canary, and rollback are different controls

A rolling update changes instances gradually. A canary exposes a smaller traffic or user cohort to the new version. A feature flag controls capability exposure independently of process rollout. They can be combined, but none is a substitute for the others.

Kubernetes documents `RollingUpdate`, readiness, rollout status, revision history, and rollback to a previous revision.[5] Those primitives answer whether pods can be replaced and whether a deployment is progressing. They do not prove that the right citizen received the right message. Business metrics are part of the release signal.

For the feature, define abort thresholds before deployment:

| Signal | Example interpretation | Action |
|---|---|---|
| Authorization-denied rate | Unexpected increase may indicate policy or claim regression | Pause and inspect; do not widen cohort |
| Duplicate provider request rate | Idempotency or retry regression | Disable flag and stop worker promotion |
| Mail provider 4xx/5xx | Template, credentials, quota, or provider issue | Route to pending/failed state; apply bounded retry |
| Outbox-to-delivery latency | Queue or worker saturation | Hold rollout; scale or fix before expanding |
| Audit write failure | Evidence boundary is degraded | Block the side effect or follow an explicit fail-safe policy |
| Citizen support complaints | Semantic or template problem invisible to infrastructure metrics | Stop feature and review message/content path |

Rollback has layers:

1. **Disable the feature flag** so new operators cannot create the side effect.
2. **Stop or drain the worker** if queued events are unsafe to process.
3. **Roll back the application artifact** if the code itself is defective.
4. **Reconcile accepted events** with the provider and audit store.
5. **Communicate honestly** about notifications already accepted or delivered.

A code rollback cannot unsend an email. That is why the business event, delivery status, and audit trail are designed before the button is merged.

## The enterprise checklist

| Gate | Evidence required | Anti-pattern |
|---|---|---|
| Branch creation | Short-lived branch with bounded scope | One branch for several unrelated features |
| Design | Contract for actor, state, side effect, audit, and recovery | UI-first implementation with implicit authorization |
| Local validation | Reproducible lint, tests, type check, and build | “CI will catch it” after a huge diff |
| Review | Domain, security, operations, and code-owner review as needed | Approval without reading negative paths |
| Integration | PR into `dev`, current-base checks, contract tests | Merge a green branch without rebasing or queue validation |
| Artifact | Commit SHA, image digest, dependency/security evidence | Rebuilding independently per environment |
| Staging/UAT | Synthetic citizen data, mail sandbox, operator journey | Sending test notifications to real recipients |
| Production promotion | Protected `main`/`master`, approval, change record | Direct push around branch protection |
| Rollout | Flag, canary/rolling strategy, readiness and smoke checks | 100% enablement immediately after deploy |
| Verification | Technical, business, delivery, and audit metrics | Only watching HTTP 200 and CPU |
| Recovery | Flag-off, worker control, artifact rollback, reconciliation | Assuming rollback reverses external side effects |

The goal is not to make every small change slow. The goal is to make risk visible before it becomes an incident. Small branches, fast tests, protected branches, immutable artifacts, and reversible exposure let a team move quickly without pretending that a public-service workflow is just another CRUD screen.

At my company, “done” means more than the button being visible. It means the right actor can use it only in the right workflow state, the event can be retried without creating a duplicate side effect, the release can be traced to an approved source snapshot, and the team knows exactly how to stop it when reality disagrees with the plan.

That is the real path from feature branch to production: not a chain of Git commands, but a chain of accountable decisions.

## References

[1]: https://dora.dev/capabilities/trunk-based-development/ "DORA — Trunk-based development"
[2]: https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches "GitHub Docs — About protected branches"
[3]: https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue "GitHub Docs — Managing a merge queue"
[4]: https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments "GitHub Docs — Managing environments for deployment"
[5]: https://kubernetes.io/docs/concepts/workloads/controllers/deployment/ "Kubernetes Documentation — Deployments"

## Related reading

- [Zero-Downtime Deployment: Kubernetes Canary Release & Safe DB Migration Techniques](/blog/zero-downtime-canary-db-migration)
- [Schema Evolution in Event-Driven Systems: Compatibility, Rollback, and Data Contracts](/blog/schema-evolution-event-driven-compatibility-rollback)
- [Idempotent AI Actions: Making Tool Calls Safe to Retry](/blog/idempotent-ai-actions)
- [AI Agent Incident Response: Kill Switches, Evidence Packs, and Safe Degradation](/blog/ai-agent-incident-response)

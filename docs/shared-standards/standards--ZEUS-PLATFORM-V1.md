# Zeus Platform v1

Status: **foundation contract — isolated implementation branch**

Schema: `zeus.platform/v1`

## 1. Purpose

Zeus standardizes commodity infrastructure across the portfolio without turning
Zeus into every product's data plane. Products own business logic and product data.
Zeus owns the golden path, security contracts, lifecycle rules, observability and
selected shared runtime primitives.

The governing rule is:

> Centralize contracts, security and reusable machinery. Centralize runtime state
> only where shared state is necessary and the blast radius is explicitly bounded.

## 2. Non-negotiable boundaries

1. **Control plane != product data plane.** Ordinary product requests must continue
   without routing through the Zeus management/control plane.
2. **Product data remains product-owned.** No global Zeus application database and
   no cross-product database foreign keys.
3. **Authentication implementation is replaceable.** Better Auth or any successor
   is an adapter behind Zeus identity contracts, never the permanent identity key.
4. **No universal product-visible subject.** Internal identity may correlate a
   person where legitimately required; products receive sector/realm-scoped subject
   identifiers by default.
5. **Organization, workspace, resource owner, legal entity and billing account are
   different concepts.** No schema may silently collapse them into a single tenant.
6. **Actor != subject.** Agents/workloads acting for a human or organization carry
   explicit, narrower delegation rather than inheriting a human's full authority.
7. **Authority can only stay equal or decrease across a boundary.** Any privilege
   increase requires a fresh, explicit authorization decision.
8. **Isolation is multi-dimensional.** Environment, region, security realm, cell,
   resource owner and data classification remain available as independent axes.
9. **Logical IDs are location-independent.** Region, database, shard and cell are
   placement metadata and never encoded into durable public identifiers.
10. **Zeus outage behavior is risk-tiered.** Low-risk operations may use bounded
    cached authorization; sensitive/admin operations fail closed when freshness
    cannot be proven.
11. **Shared code has shared-compromise controls.** Zeus packages require staged
    rollout, provenance, dependency visibility and rollback; no blind fleet-wide
    auto-upgrade.
12. **Deletion follows derived data.** OCR, thumbnails, embeddings, search entries,
    caches and other derivations participate in deletion/retention lineage.
13. **Production is isolated from preview/staging.** Credentials, tokens, OAuth
    clients and data access do not cross environment boundaries by default.
14. **Zeus must be recoverable without Zeus.** Operator break-glass, external
    monitoring, backup protection and cryptographic recovery cannot depend solely
    on the same control plane they repair.
15. **Every shared primitive has an exit contract.** A product can migrate away
    without changing its business identifiers or reconstructing opaque data.

## 3. Four-layer architecture

```text
ZEUS CONTROL PLANE
inventory / releases / AfterCI / backup / incidents / cost / posture
                     |
ZEUS PLATFORM CONTRACT
identity / tenancy / delegation / tokens / events / errors / data classes
                     |
SHARED RUNTIME PRIMITIVES (selective)
identity realms / jobs-events / credential custody / commerce / notifications /
AI-browser runtime / external connections
                     |
PRODUCT DATA PLANES
FetchPaperwork / Comandero / games / future products
```

The platform contract is more stable than any implementation. Shared runtime
services may begin as modules in a modular monolith and be extracted only for
security, availability, residency, scaling or independent lifecycle reasons.

## 4. Identity and security realms

Zeus defines a private identity contract and may maintain a federation graph for
explicitly approved product groups. The default runtime remains product-local:
each application keeps its own account records, sessions and durable IDs, and it
must continue working when a central Identity service is unavailable. Applications
receive realm/sector-scoped subjects when federation is explicitly enabled. A
product must not infer that two app-scoped subjects represent the same person
unless an explicit, authorized federation/link operation permits it.

A security realm groups applications that intentionally share one privacy/trust
boundary (for example a web app, mobile app and API for the same product). Realm
membership is explicit; it is not inferred from repository ownership.

Social/OIDC provider credentials are centrally governed but product/realm scoped.
Branding, redirect URIs, scopes and legal consent remain product-owned.

## 5. Resource ownership, workspaces and delegation

The minimum conceptual model is:

```text
principal        who/what can authenticate
auth identity    Google/Apple/passkey/password/workload binding
security realm   intended trust/privacy sector
workspace        collaboration container
resource owner   entity whose data/resource is being acted upon
membership       relationship between principal and workspace
delegation       bounded authority to act for another subject/owner
legal entity     contracting/legal identity
billing account  commerce relationship
```

FetchPaperwork example: an accounting firm can be delegated authority over a
client company's resources without becoming the owner of those resources. Changing
accounting firms changes delegation, not ownership or physical data identity.

## 6. Trusted execution context

Sensitive operations carry enough trusted context to authorize and audit the
operation across synchronous and asynchronous boundaries:

```text
app
environment
securityRealm
region
cell
resourceOwner
workspace
subject
actor
delegation
authorizationVersion
dataClassification
requestId
traceId
```

Not every field belongs in every token. The semantic envelope is the contract.
Queues/jobs must persist the minimum trusted subset and re-authorize when delayed
execution can make membership or delegation stale.

## 7. Authorization freshness and failure policy

There is no global `fail-open` or `fail-closed` setting.

- low-risk UX/read paths may continue using bounded cached authorization;
- confidential reads use a short, policy-defined freshness window;
- exports, credential changes, MFA changes, admin, impersonation, cross-owner and
  destructive operations require current authorization and fail closed;
- revocation/security events invalidate or reduce cached authority inside a stated
  SLA.

Feature/config outages use last-known-safe or explicit safe defaults. Event and
notification outages buffer/queue durably where semantics allow it.

## 8. Workload identity and agents

Workloads authenticate as workloads using short-lived platform-native identity
where possible. Long-lived human API keys are not workload identity.

When Hermes, a browser worker or an AI agent acts for a human, both identities are
preserved: the human/organization is the subject/resource authority and the agent
is the actor. Delegation must be scoped, time-bounded, auditable and incapable of
silently granting more authority than the delegator possesses.

## 9. Placement, cells and mobility

Zeus keeps logical identity separate from physical placement. `region` and `cell`
are placement metadata even if every project starts in one EU cell.

The contract permits future moves between shared/dedicated databases, cells or
regions without changing public product IDs. Placement migrations use prepare ->
copy -> catch-up -> validate -> switch -> verify -> retire with a rollback window.

## 10. Data classification, AI and deletion lineage

Shared telemetry accepts only fields permitted by classification policy. Raw
credentials, customer documents and unnecessary PII must not enter general Zeus
analytics/logging.

AI/RAG retrieval enforces resource-owner/tenant authorization before results are
returned. Vector/search namespaces are partitioned or equivalently isolated; a
post-retrieval filter alone is not considered an adequate isolation boundary.

Derived artifacts retain lineage to their source and retention policy. Erasure
must be able to enumerate OCR/extracted text, thumbnails, embeddings, search
indexes and caches subject to valid retention exceptions.

## 11. Events and asynchronous work

Events are not transactional truth. Critical state transitions use a durable
outbox (or equivalent atomic mechanism); consumers are idempotent and tolerate
at-least-once delivery. Queue messages include trusted ownership/authorization
context and delayed operations recheck stale authority when required.

Canonical event envelopes are versioned and classified. Schema changes follow
compatibility rules rather than free-form naming.

## 12. Commerce and entitlement separation

Zeus normalizes commerce events from providers (Stripe, app stores and future
sources) into product-defined entitlements. Payment-provider objects are not the
authorization model. Provider accounts, legal entities, currencies, brands and
reputation remain scoped rather than silently global.

## 13. Supply chain and rollout

Shared Zeus packages are crown-jewel dependencies. Required controls include:

- dependency lock/visibility and SBOM/provenance where supported;
- protected publishing;
- contract and consumer tests;
- internal/canary cohort before wider adoption;
- bounded rollback/revocation;
- architectural exception path instead of a rigid `reuse or fail` rule.

## 14. Configuration and cryptography

Configuration, secrets, third-party connections, encryption keys, signing keys and
root-of-trust material are separate concepts with separate lifecycle controls.
Dangerous fleet-wide configuration changes require staged rollout and stronger
approval than project-local changes.

Identity signing/encryption key rotation, overlap, recovery and revocation are
explicitly tested. Backup success is not declared until required cryptographic and
provider configuration can also be recovered.

## 15. Migrations and exit contracts

Database evolution defaults to expand -> migrate/backfill -> switch -> contract.
AfterCI records whether a release is reversible, conditionally reversible or
irreversible and raises the bar for irreversible transitions.

Every platform primitive documents how a product exits: identity mapping export,
portable event schemas, ordinary object formats, commerce reconciliation, safe
feature defaults and portable job/API contracts.

## 16. AfterCI properties

Future product adoption is judged by properties, not by merely importing a Zeus
package. Relevant gates include:

- cross-app token rejection and realm isolation;
- product-owned lifecycle coverage (registration, verification, recovery, session revocation and deletion) with provider credentials scoped to the product and environment;
- an identity maintenance record naming the pinned package version, adapter, configured providers, verification evidence and pending security updates;
- a shared UI maintenance record naming the pinned UI package version, product theme, adopted primitives and provenance evidence;
- cross-owner/tenant API, cache, file, queue and AI isolation;
- revocation freshness for sensitive actions;
- preview/staging rejection from production resources;
- delegation never broadens authority;
- derived-data deletion coverage;
- supply-chain provenance and staged rollout evidence;
- event schema/classification validity;
- entitlement reconciliation;
- declared safe degradation during Zeus outages;
- capability-level restore, including key/config recovery;
- protected audit evidence for sensitive actions.

## 17. Initial implementation sequence

**Phase 0 — contract first (this branch).** Freeze terminology, machine-readable
policy, validator and adversarial tests. No production/auth migration.

**Phase 1 — identity foundation.** Product-local auth adapter, session/token
profiles, account lifecycle, provider isolation and workload/delegation primitives;
optional realm/sector federation is piloted only behind an explicit product-group
boundary.

**Phase 2 — shared operational primitives.** External connections/credential
custody, events/jobs, notifications, entitlements and metering with isolation and
failure contracts.

**Phase 3 — adoption tooling.** SDKs, scaffolding, manifest projection, dependency
registry, contract tests and AfterCI evidence.

**Phase 4 — risk-ordered migration.** Migrate products in cohorts. Preserve local
IDs and rollback. No big-bang fleet migration.

## 18. Explicit non-goals for v1

- no universal Zeus customer database;
- no mandatory request proxy through Zeus OS;
- no thirty-service microservice decomposition;
- no automatic account merging by email/domain;
- no automatic global SSO across unrelated products;
- no shared Stripe/email/storage account merely for convenience;
- no provider/framework internal ID as a permanent product identity;
- no production migration until pilot contracts and rollback evidence exist.

# Design governance and implementation context v1

Scope: CJ-D00 and the schema/agent-context part of CJ-D01. This standard extends
`zeus.design-spec/v1`; it does not certify implementation, qualify a release,
install a scheduler, or replace AfterCI. The Crown roadmap remains authoritative.

## Authority, implementation and uncertainty

Every canonical project has one durable record in
`standards/manifests/design-adoption-inventory.json`. Its design owner is the
existing product-owner role, not a newly invented approver. A missing named
human/delegation is explicitly unresolved. Design documents, theme files,
component manifests and assets discovered in source are pinned candidates, not
approved references. Catalogue logos have only catalogue-display provenance.

Maintain three separate sections: `approvedIntent`, `currentImplementation`, and
`knownDesignDebt`. A staged draft is not adopted canonical intent. A test report,
"acceptance" filename, deployed UI or an agent-authored assertion is not an
owner's approval. No inspection result authorizes a redesign or customer action.

The ledger retains known conflicts, historical surface IDs and source snapshots.
A missing later observation does not remove a conflict, retire a surface or close
debt. Resolve conflicts in place with the owning decision reference. Keep retired
IDs in history and distinguish them from the active approved specification.
Discovery caps, unavailable repositories and historical denominators remain
visible gaps. The maintained ledger is not regenerated from a heuristic scan.

## Machine-readable contract

The product-owned `zeus.project.json.designSpec` references the human prose at
`specPath`, its `version` and exact UTF-8 file SHA-256 `contentSha256`, an `owner`,
`approval`, `surfaceIds`, `dependencies`, `requirements`, and `evidencePlan`.
Existing legacy v1 declarations remain structurally readable for historical
consumers. **Legacy structural APPROVED is not agent admission or conformance.**
New implementation tasks require the additive `governance` profile validated by
`validate_governed_design_spec`, not only `assess_design_spec`.

Each requirement has a permanent `DESIGN-<GROUP>-<NUMBER>` ID, a `specAnchor`,
mandatory/advisory level, covered surface IDs, accepted evidence media and a
concrete violation condition. IDs survive wording and implementation changes.
Every active surface needs mapped paths and at least one requirement. The JSON
references the prose; it is not a duplicate generated design document.

`governance` has schema `zeus.design-governance/v1` and includes:

| Field | Meaning |
| --- | --- |
| `projectId`, `manifestPath` | Canonical product and its source-owned manifest. |
| `authorityRef` | Existing product-owner/delegation policy resolved by the coordinator. |
| `accountIsolation`, `identityOwner` | Product-owned account isolation and canonical visual/design identity; not a new authentication realm. |
| `surfaces` | Stable IDs and repository-relative implementation paths/prefixes. |
| `dependencyPins` | Token/component/asset IDs, kind, path, exact digest and version; complete coverage of declared dependencies. |
| `sharedStandards` | Required local, versioned, digest-pinned shared standards, loaded as actual text. |
| `evidencePlanSha256` | Exact reference to the existing product evidence plan; not a new evidence runner. |
| `retiredRequirementIds`, `retiredSurfaceIds` | Permanent tombstones, never silently removed or reused. |
| `sourceConflicts` | Stable unresolved/resolved records retaining all conflicting references and resolution authority. |
| `exceptions` | Attributable reason, scoped requirements/surfaces, authority, exact revision and expiry. Never certification. |

An approved governed declaration binds approval to project ID, spec version,
prose digest and `contractSha256`. `contract_digest` canonically hashes the entire
contract except its approval envelope. Thus changes to requirement strength,
coverage, dependencies, standards, references or exceptions invalidate approval
binding even when the prose bytes are unchanged.

Paths are repository-relative regular files; traversal and parent/leaf symlinks
are refused. Duplicate keys and nonfinite JSON values are refused by the context
loader. Text files are bounded to 512 KiB, combined context to 2 MiB. Assets are
loaded for digest validation, not copied as binary content into an agent prompt.

## Repository and task execution

Before changing a graphical, customer-facing or operator surface, the owning
coordinator supplies a `DesignTask`: canonical project, isolated repository,
trusted full baseline Git revision, implementation actor, intended paths,
surface IDs and routine/material classification. It resolves **existing** owner
or delegated decisions into a `DesignAuthority` and supplies that separately.

Never construct `DesignAuthority` from candidate JSON, a request-controlled
approval file, or an agent's own claim. The coordinator must resolve policy
reference, owner identity, original decision, scope, time and delegation from
its existing trusted authority context. This library consumes that boundary;
it creates no parallel approval registry or identity service. Empty/unresolved
authority fails closed. No real portfolio approvals were created by CJ-D00.
The context also carries the central inventory’s recorded ownership, debt and
conflicts. A known conflict cannot be omitted or resolved without scoped existing
authority, even when a new specification claims to supersede the old sources.

`prepare_design_execution` loads approved prose, prior Git-pinned prose, shared
standards, dependency pins and the evidence plan into `ExecutionSpec.design_context`.
The existing `admit` guard recomputes that context before execution. `run_cycle`
passes the actual loaded text to the existing executor callback. Canonical
product implementation defaults to a hold when design applicability/context is
not provided; omitting project identity in a candidate cannot bypass this path.
Legacy non-canonical fixture tasks preserve their existing interface.

`validate_candidate` rechecks the context and existing write/evaluator boundaries.
A checkbox, forged READY summary or stale previously loaded context cannot admit
a changed source. Agents invoking a different repository workflow must apply this
same preflight under its existing coordinator; the AGENTS rule is mandatory, but
these changes do not install or prove every external executor integration.

Routine corrections under an already approved specification reuse that approval;
no fresh Seb intervention is requested. The trusted coordinator classifies the
work and independent review checks the implementation; the loader does not infer
material visual/interaction intent from source code. Material departures need a
separate `designChangeApprovalRef` resolved for exact baseline and surface scope.

An amendment must preserve the previous reference, increment the spec version,
bind before/after contract digests, and obtain a scoped `amend-design` decision
from the existing owner or a current delegate. Deleted IDs require tombstones.
Mandatory→advisory, required→N/A, coverage narrowing, changed dependencies and
conflict resolution remain independently reviewable changes. N/A additionally
requires an independently resolved applicability decision, not merely a reason.
An implementation actor cannot approve its own changes or replacement baseline.

## Shared standards and identity

Applicable product specifications should pin local adopted copies of the relevant
`standards/ZEUS-PLATFORM-V1.md`, `packages/platform-ui/README.md`,
`packages/product-auth/README.md`, and their own token/component/asset provenance.
A product may use its existing framework and specialist components. Shared
primitives do not erase brand, game interaction, printing, photo or voice behavior.
Shared authentication code does not share customer accounts, sessions, permissions,
workspaces or billing between products. Do not enable social providers or change
credentials as part of design adoption. Preserve existing staff-integrated,
guest-first and other product-owned account modes rather than normalizing them
into mandatory accounts. The context exposes the existing identity contract;
changing that contract is held for the separate product-auth workflow, not
authorized by a design approval.

## Read-only maintenance

```sh
python3 ops/design_context.py check-inventory
python3 ops/design_context.py check-inventory --against <full-previous-commit>
python3 ops/design_context.py scan-proposal --project-id comandero --revision <full-source-commit>
python3 ops/design_context.py inspect-context --project-id zeus-home \
  --repo /path/to/isolated/worktree --baseline <full-approved-baseline> \
  --actor agent:implementation --path assets/workspace.js --surface view:command
```

`scan-proposal` never overwrites the durable ledger. `inspect-context` deliberately
cannot accept an authority file and always exits nonzero: it is unprivileged
inspection, not implementation authorization. The production-capable API is the
existing guard with independently resolved coordinator authority.

## Certification boundary

See `docs/CJ-D02-DESIGN-INTERFACE.md`. Source context READY means approved inputs
were loaded and permitted work was scoped. It does not prove aesthetics, rendered
behavior, accessibility, motion, audio, physical-device behavior or production
conformance. CJ-D02/CJ-D03 own those proofs and existing AfterCI consumption.
No certificate, live release or portfolio-wide design adoption is created here.

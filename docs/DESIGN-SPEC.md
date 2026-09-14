# Till Check — product design specification

Contract: `zeus.design-spec/v1`. Version: `2026-09-14-cjd04-governed-draft3`.
**DRAFT / UNAPPROVED. Source adoption is staged; design conformance is INCOMPLETE.**

This document is the consolidated product design intent for review. Existing implementation and historical acceptance are evidence inputs, not automatic approval. The owner has authorized preserving the specific decisions quoted below, not approved all current pixels, assets, code or this entire specification. No implementer approval, screenshot self-acceptance, production deployment or historical receipt rewrite occurs here.

Product owner: `product:till` (Sebastien Marion). A delegated design reviewer has not been appointed in a verifiable approval record. Approval requires an identified authorized reviewer, date, review reference and exact specification digest; those fields remain absent rather than invented. The source revision inspected for this adoption is `831acb8a25810935f7a3a4604478ac9a9a100bf5`.

## Product intent and provenance

Till Check is the private single-owner cash-drawer ledger on Zeus. It is a separate canonical project (`till`), **not TillProof**, and this adoption does not import TillProof branding, account architecture, pricing or four-locale promises. The actual display language is English; Barcelona business-date semantics and euro money formatting remain explicit. Additional locales require a reviewed extension rather than a claim based on another product.

The current task authorizes adoption work, not blanket visual acceptance. `README.md` records the product's behavior and local safety invariants; `REVIEW.md` records a historical delivered implementation and checks. Neither contains a digest-bound approval of this new design specification. The checked-in screenshots are historical illustrations, not automatically approved visual baselines. Full owner/delegated approval remains open.

## Authority and conflict resolution

| Source | Authority in this draft | Limits / resolution |
| --- | --- | --- |
| `README.md` | Count, money truth, explicit confirmation, date navigation, recovery and private boundary intent | Later Closed-day takings 0.2.1 section governs summary semantics beyond the 0.2.0 review. A historical test count is not a current result. |
| `REVIEW.md` | Audit trail of 0.2.0 UI/data-integrity changes | Retain its original evidence and physical-device limitation; do not copy its rollout claim into the current candidate. |
| `public/index.html`, `public/styles.css`, `public/app.js` | Actual currently shipped page, components and styles at the inspected revision | Implementation inventory, not independent approval. Overrides and compact controls need measured review. |
| `reconcile.mjs`, `takings.mjs`, `server.mjs` | Existing financial semantics rendered by the UI | This design adoption must not alter calculations, saved records or server state. |
| `docs-count.png`, `docs-history.png`, `docs-verdict.png` | Historical illustrations | No approved-reference digest/owner review is available; do not self-baseline against them or today’s render. |
| `zeus-home-index.html` | Historical surrounding hub snapshot | Not this application's current page authority and not a second template to copy back into the app. |

`docs/DESIGN-SPEC.md` consolidates current desired interaction scope; original documents remain intact as history. No runtime CSS, HTML, financial code or assets are changed to make adoption green.

## Visual system and components

Current style inventory: background `#f5f4ee`, paper `#fffefa`, ink `#20332f`, muted `#626f69`, line `#dce2d9`, green `#153c35`, soft `#eaf2eb`, error `#9a302a` and amber `#795019`. Interface typography uses Inter/system sans. Retain a quiet, readable cash ledger: real amounts and discrepancies have higher prominence than supporting explanations. Color cannot be the only signal for pending, unchecked, warning or confirmed state.

Local HTML/CSS/JS owns the brand/checkmark, tabs, denomination/direct-total choice, date control, opening setup, input panels, verdict, review dialog, notifications, history and download link. There is no adopted shared UI package in the inspected manifest; do not invent one or collapse product identity into Zeus styling. The inline checkmark/favicon is bound with its HTML. Historical screenshots are references for inspection only.

Review 320px/390px phones, 768px tablet and 1440px desktop (the existing test widths), portrait/landscape, text zoom and soft keyboard. Critical phone controls retain a 44px target baseline. The amount and primary step remain reachable without horizontal page overflow. The review dialog must remain within the usable viewport, focusable, dismissible without saving, and restore useful focus. Compact rows and links need actual hit-target measurements; a single broad button CSS declaration is not sufficient proof. Respect reduced motion without hiding progress feedback.

## Daily-close journey and trust states

Count the drawer using all 15 euro denominations or a direct total. An empty drawer needs an explicit zero; blank is incomplete. Enter POS cash/card, terminal totals and movements without confusing physical drawer cash, received takings and profit. Keep cash/card variance and unresolved differences visible. A first close with unknown opening establishes a labelled baseline, not verified reconciliation.

Save → inspect the result → explicitly confirm cash left in the drawer. Before-count and after-count withdrawals affect different facts and must remain legible. Drafts are date-local and device/origin-local, restored explicitly; a network failure preserves input and offers retry. A confirmed correction requires review and preserves the audit relationship. Device navigation never silently moves a record: deliberate History → Change date owns that operation.

All displayed business dates use Europe/Madrid, including on a device configured elsewhere. A stale ledger conflict must tell the user to reconcile current state rather than overwrite it. Review/cancel and retry do not duplicate actions. Delete requires review; Undo is available only under the existing no-subsequent-write condition. Confirmed-day summaries disappear while editing unsaved corrections rather than imply the altered draft is already accepted. CSV output is the existing complete ledger, not a successful export before data arrives.

## Surfaces and evidence scope

`page:/` denotes the private application's own root, mounted by the existing proxy at `/till/`; it is not a proposed public route. Explicit daily-count/history/review/export surfaces complement the discovered HTML form. The committed scanner does not discover the private page from `public/index.html`; **this is a source-discovery integration gap**, not proof that the page is absent or exempt. The product index records actual implementation files and state lists. CJ-D02/D03 must bind their executable coverage to these identities through their owned interfaces.

The cash view requires connecting/loading, empty/unknown opening, partial count, pending save, reviewed result, success, validation error, network failure, stale ledger and confirmed/read-only states. History requires initial loading, empty, paged data, correction review, delete review/undo eligible or expired, export ready/failure and disconnected recovery. Applicability is explicit in the index; there is no invented voice, audio-capture or public-login journey. Audio evidence is not applicable because this product contains no auditory interaction; any future audio surface must extend this contract rather than inherit the exclusion.

## Known debt and proof still required

Approved visual references, independent hierarchy review, computed touch/contrast/focus checks, fresh failure-state renders, current behavior/timing proof and physical phone keyboard/touch acceptance are missing. Historical Chromium results do not certify native Safari or a physical iPhone. The inherited UI runner launched raw Chromium with `--no-sandbox`. This adoption replaces only that test adapter with the existing scoped broker connection, rejects missing/owner CDP and retains per-test disposable databases. For managed-CDP reload/reopen cases, the harness explicitly exercises the product pagehide draft-persistence hook, closes the disposable page without beforeunload, and reopens the same origin in the same context; this avoids dual native-dialog controllers without suppressing application errors or changing production code. Fresh full execution is still required.

Source tests and the pure/API suite can run on isolated state. Run the full suite under `zeus-browser-with-session <unique-session> -- npm run test:all`; the test-only adapter fails closed without a scoped broker endpoint. The reload/draft tests retain real local storage, network and startup behavior through pagehide + same-origin reopen. Test output still does not replace approved design references or physical-device acceptance. No new browser service, authentication model, provider, customer records, public exposure, deployment or operational service change is part of this adoption.

## Stable requirement catalogue

Mandatory requirements cannot be downgraded to make a candidate pass. Advisory requirements remain visible but do not certify or repair missing mandatory evidence. Each violation below is an observable failure condition. Surface/state membership and source-byte bindings are indexed in `.quality/design-adoption.json`; `zeus.project.json.designSpec` is the executable declaration, not a second prose specification.

<a id="design-till-001"></a>

### DESIGN-TILL-001 — mandatory

Violation: Blank cash is treated as zero, counted cash is confused with sales/profit, or an unresolved cash/card difference is hidden or counted twice.

Evidence required: source, behavioral, visual, expert-review. Applicable surfaces: `view:daily-count`, `view:history`, `dialog:review`, `output:csv`.

<a id="design-close-001"></a>

### DESIGN-CLOSE-001 — mandatory

Violation: Save, review and confirmation collapse into an implicit money-changing action; failed requests or navigation discard valid input; a stale browser silently overwrites newer ledger values.

Evidence required: source, behavioral, visual, expert-review. Applicable surfaces: `page:/`, `action:form:public/index.html`, `view:daily-count`, `dialog:review`.

<a id="design-date-001"></a>

### DESIGN-DATE-001 — mandatory

Violation: Date arrows move records, a date change bypasses review, or the UI uses the device timezone instead of Barcelona business dates. A future/invalid date is displayed as an accepted close.

Evidence required: source, behavioral, visual. Applicable surfaces: `view:daily-count`, `view:history`, `dialog:review`.

<a id="design-recovery-001"></a>

### DESIGN-RECOVERY-001 — mandatory

Violation: Date-local draft restore, confirmed correction, guarded delete/undo, stale-ledger recovery or retry is ambiguous or loses known amounts. Local drafts are represented as server backups.

Evidence required: source, behavioral, visual, expert-review. Applicable surfaces: `action:form:public/index.html`, `dialog:review`, `output:csv`, `page:/`, `view:daily-count`, `view:history`.

<a id="design-a11y-001"></a>

### DESIGN-A11Y-001 — mandatory

Violation: Critical phone actions are clipped, have less than the 44px target baseline, lose keyboard focus/labels, become unreachable with the soft keyboard or retain nonessential motion under reduced motion.

Evidence required: source, visual, behavioral, physical-device, expert-review. Applicable surfaces: `action:form:public/index.html`, `dialog:review`, `output:csv`, `page:/`, `view:daily-count`, `view:history`.

<a id="design-brand-001"></a>

### DESIGN-BRAND-001 — mandatory

Violation: The private Till Check ledger is presented as the TillProof SaaS or a public multi-tenant app; unclear visual hierarchy hides the amount, discrepancy or next required step. Missing brand/reference approval is treated as accepted current UI.

Evidence required: source, visual, expert-review. Applicable surfaces: `action:form:public/index.html`, `dialog:review`, `output:csv`, `page:/`, `view:daily-count`, `view:history`.

<a id="design-state-001"></a>

### DESIGN-STATE-001 — mandatory

Violation: Loading, empty, pending, disconnected, validation-error, stale, provisional-opening or confirmed/read-only state is absent or falsely presented as a successful independently reconciled close.

Evidence required: source, visual, behavioral, expert-review. Applicable surfaces: `action:form:public/index.html`, `dialog:review`, `output:csv`, `page:/`, `view:daily-count`, `view:history`.

<a id="design-feedback-001"></a>

### DESIGN-FEEDBACK-001 — mandatory

Violation: Pending save feedback appears too late or is replaced by success before the response, repeated clicks duplicate an operation, or a late response overwrites a newer date/form.

Evidence required: behavioral, temporal, expert-review. Applicable surfaces: `view:daily-count`, `view:history`, `dialog:review`.

<a id="design-density-001"></a>

### DESIGN-DENSITY-001 — advisory

Violation: The drawer count, discrepancy and next action compete with secondary explanations, history detail or decorative elements on a small phone.

Evidence required: visual, expert-review. Applicable surfaces: `page:/`, `view:daily-count`.

## Evidence, change control and promotion

The indexed missing cells are a work queue, not acceptance. Source-contract tests prove only that references, surface membership and fingerprints are coherent. They do not prove rendered design, behavior, visual reference approval, subjective quality, physical-device behavior, audible quality or latency. Existing functional/visual reports keep their original revision and limitations; none are relabelled as current-candidate design evidence. Screenshots require an independently approved reference and human design review; current output must never accept itself.

Before changing any scanned UI/component/token/asset/copy/source route, update this specification's applicable requirements and state coverage, then deliberately refresh its source index. A new, removed or changed scanned file fails the local source test. Changing hashes alone is not approval. New surface/state discovery, code review and the committed CJ-D01 context/CJ-D02 evidence/CJ-D03 AfterCI interfaces must additionally enforce semantic coverage; this source check cannot discover every state inside arbitrary code. A semantic change keeps approval pending until authorized review.

The existing `.quality/evidence-plan.json` records source jobs only where they actually exist; missing modality executors/reviewer/device evidence remain missing. The existing AfterCI authority is the only release authority. Candidate qualification, deployment verification and current-production conformance remain separate. No compatibility claim is made beyond the committed Crown interface consumed by this branch. Integration must recheck that interface and these product source hashes before merging.

Rollback is a reviewed revert of this isolated source-adoption commit, not a runtime flag change, data reset, provider change or receipt rewrite. Existing historical receipts remain immutable. Unadopted products remain incomplete. This branch does not update a deployed manifest overlay: only the normal release authority may bind and promote that exact product candidate after its required proof.

## Governed agent context — committed D01 interface

This draft consumes `zeus.design-governance/v1` from Zeus commit `e6ff55a7822521ec9dc704b758a0ba35f43d7116`, within the existing v1 design declaration. Product identity/accounts remain product-owned. Exact dependency bytes, evidence-plan bytes, actual shared-standard text, surface-to-path/state mappings and stable prose anchors are pinned in the existing manifest. Adopted local shared-standard copies are immutable snapshots of the stated upstream path/revision, not a separately authored standard.

The authority reference names the existing product role, not an approval. No candidate-owned file supplies trusted authority. Proposed source precedence resolutions above remain machine-readable unresolved approval obligations until independently ratified by the existing coordinator; no agent resolves its own conflicts or grants an exception. Retired IDs are retained as tombstones and require review, never silent reuse. The complete human spec remains the only consolidated product design prose.

`validate_governed_design_spec` may accept the structure while `build_design_context(..., authority=None)` must remain INCOMPLETE. Research/specification proposals are allowed; this draft does not authorize UI implementation. No approved baseline, READY context, design certification or production permission is invented. D02 `f71c728` still marks every design medium unsupported.

The current D01 loader limits each referenced file to 512 KiB and counts all bytes toward 2 MiB. Any full-sized declared asset beyond those limits remains pinned and recorded as an integration limitation; it must not be omitted/downsampled just to make the context green. D01/D02 own a bounded streaming/content-addressed asset interface. This adoption does not alter their loaders or engines.

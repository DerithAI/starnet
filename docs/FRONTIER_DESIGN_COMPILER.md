# Frontier Design Compiler

**Status:** canonical capability specification  
**Form:** one specialist skill inside StarNet, not a new orchestrator or design platform

## Purpose

Turn product intent and references into a complete, rendered, inspected, and corrected
experience. The compiler succeeds when the artifact reaches a declared perceptual and
functional quality bar. Source code, a mockup, or a successful build alone is not completion.

The word **compiler** is deliberate:

```text
intent + evidence + constraints
        -> design language
        -> executable artifact
        -> observed render
        -> measured correction
```

The capability is expressed through abstractions rather than lists of file types, frameworks,
brands, or fashionable effects. A concrete tool or model is an adapter. The capability survives
when the adapter changes.

## Capability ontology

| Capability | Contract |
| --- | --- |
| `intent-modeling` | Infer the product, audience, primary action, desired perception, constraints, and success evidence. |
| `reference-grounding` | Extract transferable visual and interaction principles from supplied or current references; never copy brand assets or blindly imitate one screenshot. |
| `design-language-synthesis` | Produce one coherent system for type, color, space, shape, imagery, depth, and density. |
| `motion-language-synthesis` | Give motion a narrative or functional job; define timing, easing, continuity, reduced-motion behavior, and performance limits. |
| `artifact-completion` | Build the smallest complete artifact that proves the intended experience, with real content and target interactions. |
| `perceptual-verification` | Render and inspect the actual result across target viewports and states. Code inspection cannot satisfy this capability. |
| `quality-gating` | Score named dimensions, reject generic or incoherent output, and repair the weakest dimension first. |
| `evidence-learning` | Turn explicit verdicts, corrections, and great-rated outputs into versioned skills and goldens. Never learn from self-praise. |
| `frontier-refresh` | Periodically collect current references, cluster patterns, test them in bounded probes, promote proven rules, and expire stale ones. |

## Information compression

Knowledge is stored as decision rules, not prompt fragments or trend inventories.

```yaml
id: cinematic-scroll-reveal
status: verified
revision: 3
observed_at: 2026-11-05
use_when:
  - narrative product introduction
  - one dominant story per viewport
avoid_when:
  - dense utility workflow
  - motion would delay the primary action
implementation_constraints:
  - transform and opacity on the compositor path
  - stable layout before animation
  - reduced-motion equivalent preserves meaning
evidence:
  evaluated_artifacts: 12
  acceptance_rate: 0.83
  golden_ids: [hero-sequence-01, reduced-motion-01]
```

A rule is useful only when it says when to use it, when to reject it, how it is constrained,
when it was observed, and what evidence supports it. Model names, APIs, and framework syntax
belong in replaceable adapter notes.

## Execution loop

1. **Frame** — establish user, job, primary action, desired perception, target surfaces, and
   non-negotiable constraints. Ask only when a wrong assumption would be costly.
2. **Ground** — inspect supplied references and retrieve only relevant, current, trusted
   patterns. Separate durable principles from transient surface treatment.
3. **Direct** — commit to one design thesis and a small set of strong decisions. Define the
   visual and motion language before producing screens.
4. **Build** — create the smallest complete implementation that proves the experience. Use
   realistic content and working primary interactions.
5. **Observe** — render the artifact and inspect target viewports, interaction states, motion,
   overflow, console errors, accessibility, and performance risks.
6. **Judge** — score the quality gate and cite visible evidence. Technical validity does not
   increase the perceptual score by itself.
7. **Repair** — fix the lowest blocking dimension, render again, and repeat. Stop when the gate
   passes or the remaining blocker is external and explicitly reported.
8. **Learn** — attach the user's verdict and correction to the governing rule. A `great` result
   may mint a golden; a `miss` proposes a revision. StarNet's existing approval gate decides
   whether the revision becomes active.

## Quality gate

Score each dimension from 0 to 4 using rendered evidence:

| Dimension | Passing evidence |
| --- | --- |
| Intent fit | The hierarchy and primary action express the intended product and audience. |
| Coherence | Type, color, spacing, shape, imagery, and motion belong to one system. |
| Hierarchy | The eye reaches the right information in the intended order without explanation. |
| Distinctiveness | The result has a defensible thesis rather than default SaaS composition and decoration. |
| Interaction | Primary flows and important states work and communicate consequence. |
| Motion | Motion explains, connects, or emphasizes; it does not merely decorate. |
| Responsiveness | Target viewports preserve hierarchy, usability, and composition. |
| Accessibility | Keyboard, contrast, semantics, focus, and reduced motion preserve the experience. |
| Performance | The chosen visual techniques remain credible on the target device class. |

Pass only when:

- every applicable dimension is at least `3`;
- intent fit, coherence, hierarchy, and interaction are never below `3`;
- no console error, clipped primary content, broken primary interaction, or inaccessible blocker
  remains;
- the final claim cites the inspected artifact and viewports.

If a dimension is not applicable, record why. Never average away a blocking failure.

## Frontier refresh loop

Being current is a separate process from executing a project:

1. Collect dated references from primary releases, working products, and demonstrated
   implementations. Social excitement is a lead, not evidence.
2. Cluster repeated changes in composition, interaction, motion, typography, image treatment,
   production workflow, and model capability.
3. Express each candidate as a falsifiable rule with `use_when`, `avoid_when`, constraints, and
   a freshness date.
4. Reproduce the underlying technique in a bounded probe. Do not promote a screenshot or a
   vendor claim directly into canon.
5. Evaluate the probe for perceptual value, usability, accessibility, responsiveness, and cost.
6. Promote, revise, or reject the candidate. Promotion requires evidence and a golden.
7. Revalidate time-sensitive rules on a cadence appropriate to their volatility. Expired rules
   remain visible as history but are not retrieved as current guidance.

This loop updates knowledge, not the agent's identity or core laws.

## Evidence memory

Store four kinds of records:

- **Pattern:** compressed decision rule with provenance, freshness, constraints, and status.
- **Attempt:** input, chosen rules, adapter versions, artifact reference, and observations.
- **Verdict:** user rating plus their words; never infer satisfaction from silence.
- **Golden:** frozen input, accepted artifact evidence, assertions, and governing skill digest.

Promotion rules:

- self-evaluation can propose a lesson but cannot verify it;
- one success can become a candidate, not a universal rule;
- user correction outranks inferred preference;
- repeated results across distinct tasks raise confidence;
- changed model or adapter behavior invalidates dependent evidence until rechecked;
- every active time-sensitive rule carries `observed_at` and `revalidate_after`.

## Anti-demo laws

- Do not call a static hero, isolated mockup, or component gallery a finished product.
- Do not use gradients, glass, 3D, scroll effects, or oversized type without a job in the
  experience.
- Do not claim a reference match without side-by-side rendered evidence.
- Do not equate more sections or effects with higher quality.
- Do not hide weak hierarchy behind polish.
- Do not accept the first technically valid generation.
- Do not learn from outputs that were not observed and rated.
- Do not preserve a trend after its evidence expires merely because it is in the prompt.

## Integration with existing StarNet machinery

No new memory service or orchestrator is required.

| Need | Existing mechanism |
| --- | --- |
| Specialist procedure | bundled or runtime `SKILL.md` |
| Progressive retrieval | runtime skill index and `skill.view` |
| Safe skill evolution | skill proposal, digest guard, Commander approval |
| Feedback | run verdict plus captured correction |
| Accepted references | per-skill goldens |
| Real execution | existing browser, computer, files, terminal, and image capabilities |
| Capability boundaries | station layout and capability registry |

The first implementation is the bundled `frontier-design-compiler` skill. Later adapter notes
may describe specific frameworks or generators, but they must not enlarge the core prompt.

## Acceptance scenarios

1. **Reference to product:** given a screenshot and product goal, the agent extracts a design
   language, builds a working target, renders it at agreed viewports, and reports the gate with
   evidence.
2. **Generic first result:** when the first render is technically correct but visually generic,
   the agent rejects it, names the weakest dimensions, revises, and rerenders without waiting
   for the user to diagnose it.
3. **Motion site:** motion has a stated narrative or functional role, works under reduced motion,
   and does not break the primary action or target performance class.
4. **Model update:** a new model announcement creates a candidate only. A bounded probe and
   evaluation are required before its capability becomes an active rule.
5. **Feedback leverage:** `miss` plus a concrete correction proposes a skill revision; `great`
   on a governed run can mint a golden; neither silently rewrites active canon.


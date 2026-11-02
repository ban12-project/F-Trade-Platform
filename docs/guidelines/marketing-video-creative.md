---
meta:
  title: Review marketing video creative
  contentType: Reference
  category: Marketing video
---

# Review marketing video creative

Use this reference when you design or review marketing video content in this repository. Apply the creative checks alongside existing evidence and approval requirements. Record decisions so another agent or reviewer can inspect their basis.

The [content plan in issue #808](https://github.com/ban12-project/F-Trade-Platform/issues/808) defines the audience, scope, and acceptance criteria. The goal is to evaluate content decisions against a shared baseline. Platform adaptations and missing creative inputs remain open questions for each task.

## Source and scope

The baseline is Google’s [Understanding the ABCDs of effective creative on YouTube](https://business.google.com/en-all/think/future-of-marketing/youtube-video-ad-creative/). Google published the article in April 2022; this project checked it on November 2, 2026.

The companion [ABCDs playbook](https://www.thinkwithgoogle.com/_qs/documents/15987/ABCDs_PDFPlaybook_April2022_Final.pdf) adds objective-specific guidance. This project checked all 25 pages on November 2, 2026. Page references below use the PDF’s printed page numbers.

The article describes creative execution principles, not a formula for inventing ideas or guaranteeing results. Its reported research outcomes are not forecasts for this project. Recheck the source when revising this baseline; record changes and their implications.

Read this guide for changes to these content surfaces:

- Requirements and creative briefs
- Scripts, storyboards, and scene selection
- Captions, brand presentation, and calls to action (CTAs)
- Artificial intelligence (AI) prompts and content review criteria

For infrastructure changes, explain whether they affect these surfaces. If they do not, record why the creative review does not apply.

## Google’s ABCD principles

Use these four principles to assess creative execution. The summaries below describe the source; the project applications section defines local requirements.

| Principle | Source summary |
| --- | --- |
| Attention | Earn attention from the opening through imagery, framing, sound, and visual contrast. |
| Branding | Introduce brand identity early and reinforce it through the story and sensory cues. |
| Connection | Help viewers relate through a focused message that informs, inspires, or entertains. |
| Direction | Give viewers a clear next action through visual or audio cues. |

Google also recommends adapting execution to the marketing objective. Choose the objective before reviewing creative choices.

## Choose guidance for the campaign objective

The playbook extends the baseline for three objectives. These source summaries cover pages 10–24; pages 6–9 explain the shared principles.

| Objective | Attention | Branding | Connection | Direction |
| --- | --- | --- | --- | --- |
| Awareness, pages 11–13 | Reinforce visuals with voice, music, and effects. | Repeat varied brand cues. | Feature people and product use; reflect the audience. | Give clear instructions. |
| Consideration, pages 16–18 | Retain the opening hook. | Emphasize product close-ups; preserve branding, especially in the final five seconds. | Demonstrate relevant benefits in relatable situations. | Motivate action through time limits or limited availability; consider audio reinforcement. |
| Action, pages 21–23 | Retain the opening hook. | Keep the product visible throughout; avoid distracting brand moments. | Explain the offer precisely through realistic use cases. | Connect the CTA to the offer; consider discounts or incentives. |

Page 5 introduces a hypothetical dog-treat advertisement; pages 9, 14, 19, and 24 compare its versions. Treat these as execution examples, not product evidence. Page 25 encourages adapting execution to the brand.

For this project, select one primary objective and explain the choice in the review record. Use the following applications as planning examples, not approved campaign claims:

| Objective | Project application | Proposed evaluation |
| --- | --- | --- |
| Awareness | Introduce the supplier using authorized brand and product imagery. | Measure brand recognition with a defined audience and method. |
| Consideration | Demonstrate a verified product detail relevant to the buyer’s stated need. | Measure visits to the relevant product information. |
| Action | Invite the buyer to submit requirements for human review. | Measure completed inquiry submissions. |

Confirm that the proposed measurement is available before using it as an acceptance criterion. Record a baseline and comparison method; do not attribute improvements to the creative without supporting evidence.

The consideration timing advice applies to that source context, not every video format. Explain any adaptation for short videos or other placements. Do not invent stock shortages, deadlines, discounts, testimonials, or performance demonstrations to satisfy these recommendations. Require authorized evidence and human confirmation for commercial offers before including them.

## Project applications and limits

Treat the following checks as project policy, not additional claims from Google. Explain creative adaptations with evidence and record unresolved decisions. Evidence, rights, and approval requirements remain mandatory.

| Review area | Project check |
| --- | --- |
| Brief | Identify the audience, platform, objective, available assets, and intended next action. Label missing inputs as unknown. |
| Opening | Show a relevant product detail or buyer problem. Never invent performance claims to attract attention. |
| Brand | Use authorized brand assets and make the brand identifiable within the narrative. |
| Message | Focus on a buyer need and bind factual claims to verified product evidence. |
| Action | Specify an available next step, such as submitting fitment details or requesting a human-reviewed quote. |
| Platform | Explain assumptions about audio, captions, placement, and viewing context. Verify current platform specifications when implementation depends on them. |
| Evaluation | Propose an observable outcome tied to the objective. Label expected improvements as hypotheses until measured. |

Do not import YouTube’s audio assumptions into other platforms without evidence. Do not invent universal timing thresholds, numerical ABCD scores, or conversion guarantees from these sources.

Follow the [product and video evidence architecture](../architecture/evidence-bound-product-video.md) and [marketing video release policy](../decisions/0007-marketing-video-release-policy.md). Keep these boundaries intact:

- Cite factory evidence or human confirmation for engineering facts, compatibility, certifications, lifespan, and safety claims.
- Check media rights for the intended use, including advertising and AI generation where applicable.
- Leave formal quotes and delivery commitments to human confirmation.
- Preserve human approval gates; a creative review never authorizes publication.
- Keep real customer records and private evidence out of GitHub issues and pull requests. Reference repository contracts or synthetic fixtures instead.

## Required review record

Include this record in the relevant design, implementation, or review deliverable. Agents must exchange structured records rather than relying on conversational agreement.

| Field | Required content |
| --- | --- |
| Context | Audience, objective, platform, content surface, and intended action |
| Objective rationale | Primary objective, audience familiarity, relevant playbook pages, and reasons for adaptations |
| ABCD decisions | One entry per principle: decision, scene or artifact location, supporting evidence, and review status |
| Evidence | Authorized references for factual claims and assets; identify unverified claims |
| Platform adaptations | Differences from the YouTube baseline and the basis for each assumption |
| Open questions | Missing inputs, responsible reviewer, and whether they block the proposed content |
| Validation | Checks performed, observed results, and any proposed measurement experiment |

Use `supported`, `needs_revision`, or `not_applicable` for each principle’s review status. Explain every `not_applicable` entry. These statuses organize review; they do not establish effectiveness or replace approval.

## Runtime agent boundary

These repository instructions guide development work; they do not change application model calls. Runtime adoption requires separate changes to prompts, structured contracts, validation, and appropriate tests.

When implementing runtime adoption, trace each requirement to its enforcement point. Verify that creative suggestions cannot bypass factual evidence or human approval checks.

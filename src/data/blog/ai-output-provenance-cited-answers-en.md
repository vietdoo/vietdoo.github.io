---
title: "From RAG Chunk to Cited Answer: Building Provenance for AI Outputs"
description: "A practical provenance layer that connects retrieved sources, transformations, claims, and citations so an AI answer can be inspected instead of merely trusted."
pubDate: 2026-05-23
category: "engineering"
image: "/blog/ai-output-provenance/hero.webp"
lang: "en"
translationKey: "ai-output-provenance-cited-answers"
draft: false
---

![An engineer and an AI robot tracing a generated answer back to documents, tables, and source evidence](/blog/ai-output-provenance/hero.webp)

A RAG demo often ends with a reassuring sentence: “The answer is grounded in your documents.” That sentence can be true and still be difficult to verify.

A retrieved chunk may have come from an old document. A parser may have dropped the table header. A reranker may have selected a nearby paragraph while missing the figure that changed its meaning. The model may then combine three pieces of evidence into a claim that no source actually made. The final answer contains citations, but the citations do not explain how the claim was formed.

This is where **provenance** becomes useful. Observability tells us what the system did: which model ran, how long the request took, and which retriever returned which IDs. Provenance asks a different question: **which entities, activities, and agents contributed to this particular claim, and can a reviewer follow that lineage back to the source?** The W3C PROV model uses those concepts to reason about the quality, reliability, and trustworthiness of produced data.

> **The thesis:** A citation is a pointer. Provenance is the chain of custody behind the pointer.

The distinction matters whenever a user needs to inspect, challenge, or update an answer. It matters in research assistants, internal knowledge search, financial analysis, support tooling, and any product where “trust me” is not a sufficient interface.

## A citation alone is too small a unit

Suppose an assistant answers: “The migration window is four hours.” It cites page 18 of an operations guide. A reviewer opens page 18 and finds a table with two columns: standard migrations take four hours, but migrations with data backfill require eight. The answer used a cell from the table but lost the header during extraction.

The problem is not simply a bad citation. It is missing lineage. A reviewer needs to know which source region was selected, how it was parsed, whether it was transformed, and which claim the model attached to it.

| Layer | Example entity or activity | Question for the reviewer |
|---|---|---|
| **Source** | PDF version 7, page 18, table region | What was the original material? |
| **Extraction** | Layout parser produced a table object | Did the structure survive ingestion? |
| **Retrieval** | Hybrid search selected row 3 | Why was this evidence returned? |
| **Transformation** | Reranker and context formatter | What was removed, joined, or reordered? |
| **Claim** | “The migration window is four hours” | What exactly is the answer asserting? |
| **Citation** | Page anchor and table cell range | Can a person open the precise evidence? |

This is more detailed than a trace span, but it does not replace the trace. The trace explains runtime behavior; provenance explains the lineage of a produced artifact. A single request may have one execution trace and many claim-level provenance graphs.

## Model the answer as claims, not a blob of text

A useful first step is to represent an answer as a collection of claims. A claim can be a sentence, a table value, a recommendation, or a statement of uncertainty. Each claim receives one or more evidence links and a status.

![A provenance lineage map connects a source document through extraction and model transformation to a final claim](/blog/ai-output-provenance/lineage-map.webp)

```ts
type Claim = {
  claimId: string;
  text: string;
  status: "supported" | "partially_supported" | "unsupported" | "uncertain";
  evidence: EvidenceRef[];
  generatedBy: string;
};

type EvidenceRef = {
  sourceId: string;
  locator: {
    page?: number;
    paragraph?: string;
    table?: { row?: number; column?: number };
    boundingBox?: [number, number, number, number];
  };
  extractionVersion: string;
  retrievedAt: string;
};
```

The model does not have to emit this structure perfectly. A post-processing step can split the answer into candidate claims, map citations to spans, and flag claims that lack a source. The key is to preserve the difference between **the text the model wrote** and **the evidence the system can defend**.

A claim can be supported by several evidence items. It can also be only partially supported. For example, a retrieved policy may support the time limit but not the exception. That status is more honest than forcing a binary “grounded” label over an incomplete match.

### Use source regions, not only document IDs

A document-level citation is convenient and often inadequate. Long pages can contain multiple versions, tables, footnotes, and exceptions. Whenever the ingestion system can preserve layout, the locator should be as precise as the source allows: page, section, paragraph, table cell, figure, or bounding box.

Precision should not become false certainty. If the parser cannot reliably map a sentence to a table cell, the UI should say “page 18, table region” rather than inventing a precise cell coordinate. Provenance is valuable because it records the limit of what the system knows, not because it creates an illusion of exactness.

## Capture transformations as first-class activities

Most RAG stacks store the final text and the list of retrieved chunks. They often omit the transformations between them: OCR cleanup, table reconstruction, chunking, metadata filtering, deduplication, reranking, context packing, and answer synthesis.

Each transformation can alter meaning. A provenance record should therefore make activities explicit:

```json
{
  "claimId": "claim_07",
  "entity": {
    "type": "answer_claim",
    "text": "The migration window is four hours."
  },
  "wasDerivedFrom": ["source_page_18_region_b"],
  "wasGeneratedBy": [
    { "activity": "hybrid_retrieval", "version": "retriever-2026-05-04" },
    { "activity": "context_packing", "version": "pack-3" },
    { "activity": "answer_generation", "model": "model-release-id" }
  ],
  "confidence": "partial"
}
```

The purpose is not to save every token forever. The purpose is to retain enough lineage for the claim’s risk level. A low-stakes answer might keep compact references for a short period. A regulated workflow may require immutable evidence snapshots, model version, parser version, and reviewer actions.

This is also why provenance should not be implemented as “add more fields to the OpenTelemetry span.” Spans are excellent for runtime correlation. Provenance records need stable identifiers for entities and transformations that may be inspected after the original request has ended. The two systems can share IDs, but they serve different queries.

## Make citation coverage measurable

“Every answer has citations” is a weak quality metric. A system can attach one citation to a five-sentence answer and pass. Better metrics operate at the claim level.

| Metric | Definition | Failure it reveals |
|---|---|---|
| **Claim coverage** | Percentage of material claims with at least one evidence reference | Unsupported assertions |
| **Locator precision** | Percentage of citations that open the relevant source region | Broad or misleading links |
| **Evidence sufficiency** | Percentage of claims where evidence covers the whole statement, including exceptions | Partial grounding presented as full support |
| **Freshness compliance** | Percentage of claims backed by evidence within the policy window | Stale policies and outdated answers |
| **Transformation completeness** | Percentage of claims with the required ingestion and model lineage | Unreproducible outputs |
| **Contradiction visibility** | Rate at which conflicting sources are surfaced rather than silently merged | False consensus |

A team should define which claims are material. Dates, numbers, names, permissions, and recommendations may require stricter coverage than conversational filler. A short answer with three supported claims can be safer than a long answer with one citation at the bottom.

### Evaluate the negative path

Provenance systems are often tested only when retrieval succeeds. The more important tests include missing, stale, conflicting, and low-precision evidence. When a source cannot be opened or a citation points to a deleted document, the answer should degrade gracefully: qualify the claim, ask for another source, or abstain.

A useful contract is:

```text
If a material claim has no eligible evidence,
then the answer must either mark it uncertain,
request clarification, or decline to state it as fact.
```

This contract does not require the model to become timid. It requires the interface to distinguish a grounded answer from a plausible completion.

## Give the user a readable chain of custody

The provenance record may be graph-shaped, but the user interface does not need to expose a graph database. A citation drawer can show the claim, the source region, the document version, and a compact “how this was formed” summary. For a table or figure, the product can highlight the exact region used.

![A provenance envelope packages claim, source, transformation, timestamp, and confidence into an inspectable answer artifact](/blog/ai-output-provenance/provenance-envelope.webp)

The interface should make three states visually distinct:

| State | User-facing behavior |
|---|---|
| **Supported** | Show the citation and allow the source region to open directly |
| **Partially supported** | Explain which part is supported and qualify the rest |
| **Uncertain or unsupported** | Ask for a source, show the uncertainty, or omit the claim |

Do not hide all uncertainty behind a single confidence percentage. A score without an explanation invites users to treat probability as proof. A short reason such as “supported by the policy table, but the exception column was not extracted” is more actionable.

## Provenance must survive updates

Sources change. A document can be replaced, a web page can be edited, and an index can be rebuilt with a new parser. If provenance only stores a URL or document ID, an old answer may become impossible to reproduce.

A robust system stores a source version or content hash, capture time, parser version, and the locator used. When a source is updated, the product can mark prior claims as stale instead of silently presenting them as current. When a document is deleted, the product can distinguish “source unavailable” from “claim disproven.” Those are not the same event.

The same principle applies to transformations. If a new OCR version changes a table cell, it should be possible to identify which claims were derived from that extraction. This turns provenance into a practical change-impact tool: instead of rechecking every answer, the team can review the affected claim set.

## A small implementation path

You can introduce provenance incrementally. Start with a claim-and-evidence envelope for one high-value workflow. Preserve page and section locators during ingestion. Add a material-claim coverage metric. Then record transformation versions where reproducibility matters.

| Phase | Deliverable | Release gate |
|---|---|---|
| **1. Capture** | Source version, locator, retrieval timestamp, and answer claim IDs | Every material claim has an evidence reference or an explicit unsupported status |
| **2. Link** | Claim-to-source mapping with parser and retriever versions | Reviewers can open the relevant source region |
| **3. Qualify** | Supported, partial, contradiction, stale, and uncertain states | The UI no longer presents partial support as fact |
| **4. Monitor** | Coverage, locator precision, freshness, and contradiction metrics | Regressions block the workflow release |
| **5. Impact** | Source-version updates invalidate affected claims | Teams can revalidate only the impacted answer set |

The design is deliberately modest. Provenance is not a promise that every generated sentence is true. It is a mechanism for making the system’s relationship with evidence visible, queryable, and correctable.

When a user asks “Where did this come from?”, the answer should not be a citation pasted at the end of a paragraph. It should be a chain that explains what the source said, what the system transformed, what the model claimed, and where uncertainty remains. That is the difference between a RAG answer that looks grounded and one that can withstand inspection.

## References

[1]: https://www.w3.org/TR/prov-overview/ "W3C PROV Overview"
[2]: https://opentelemetry.io/docs/specs/semconv/gen-ai/ "OpenTelemetry Generative AI semantic conventions"
[3]: https://arxiv.org/abs/2005.11401 "Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks"
[4]: https://www.nist.gov/itl/ai-risk-management-framework "NIST AI Risk Management Framework"
[5]: https://www.anthropic.com/research/building-effective-agents "Building Effective Agents — Anthropic"

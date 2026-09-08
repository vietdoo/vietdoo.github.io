---
title: "Temporal RAG: Teaching Retrieval to Respect What Was True When"
description: "A production-minded guide to time-aware retrieval, valid-time versus transaction-time, contradiction handling, and evaluation for historical questions."
pubDate: 2026-07-07
category: "engineering"
image: "/blog/temporal-rag-time-aware-retrieval/hero.webp"
lang: "en"
translationKey: "temporal-rag-time-aware-retrieval"
draft: false
---

![A hand-drawn time-aware RAG system connecting dated documents, a timeline, and an evidence-backed answer](/blog/temporal-rag-time-aware-retrieval/hero.webp)

A normal RAG system answers the question, “Which documents are semantically similar to this query?” A production knowledge system often needs to answer a harder question: **which documents were true at the time the user means?**

That distinction is easy to miss because vector search feels intelligent. Give it a query such as “What was our refund policy in March?” and it can retrieve documents containing the words _refund_ and _March_. But semantic similarity does not understand that a policy published in June superseded a policy that was valid in March. It can return a newer, more polished answer that is historically wrong.

This is the core problem of **Temporal Retrieval-Augmented Generation**. The challenge is not adding a `published_at` field to a chunk and hoping the model notices it. The system needs an explicit temporal model, retrieval rules, evidence display, and evaluation cases that distinguish “true now” from “true then.” Recent work on diachronic question answering treats time-aware retrieval as a problem in its own right rather than a small variation of ordinary semantic search.[1]

> **Thesis:** If the answer contains a time reference, time is part of the retrieval contract—not decoration in the prompt.

## Why semantic similarity gets history wrong

Consider a simple policy timeline:

| Document         | Published | Valid from | Valid until | Statement                      |
| ---------------- | --------: | ---------: | ----------: | ------------------------------ |
| Refund Policy v1 |     Jan 8 |      Jan 8 |      Apr 30 | Refunds allowed within 14 days |
| Refund Policy v2 |     May 1 |      May 1 |      Aug 31 | Refunds allowed within 30 days |
| Refund Policy v3 |     Sep 1 |      Sep 1 |        Open | Refunds allowed within 7 days  |

A user asks, “Could a customer request a refund on April 20 under the policy we used then?” The most recent document is authoritative for today but wrong for the question. A semantic retriever may rank v3 highly because it contains the same product terms and a concise explanation. A keyword filter may also fail if the question says “back then” rather than naming a date.

Temporal correctness has at least three dimensions:

| Dimension        | Question                                      | Failure example                                       |
| ---------------- | --------------------------------------------- | ----------------------------------------------------- |
| Valid time       | When was the fact true in the modeled world?  | A 30-day policy is applied to an April transaction    |
| Transaction time | When did our system learn or record the fact? | A late-arriving correction overwrites a prior record  |
| Reference time   | Which time does the user’s question intend?   | “At the time of the incident” is interpreted as today |

These clocks are not interchangeable. A document can be written in June about an event that happened in April. A database can ingest an old contract in September. A support agent can ask about the policy “when the customer signed up,” which is neither the publication date nor the current date.

## Model time before you index text

The first design decision is not the embedding model. It is the temporal contract for each source.

For a document corpus, represent at least the document’s effective interval and its observation metadata. In a relational store, that might look like:

```sql
CREATE TABLE policy_versions (
  policy_id       text NOT NULL,
  version         text NOT NULL,
  body            text NOT NULL,
  valid_from      timestamptz NOT NULL,
  valid_until     timestamptz,
  recorded_at     timestamptz NOT NULL,
  supersedes      text,
  source_uri      text NOT NULL,
  PRIMARY KEY (policy_id, version)
);
```

`valid_from` and `valid_until` describe when the policy applies. `recorded_at` describes when the system received or recorded the evidence. `supersedes` is useful for explaining lineage but should not be treated as the only source of temporal truth; real repositories contain backfills, corrections, and overlapping policies.

The chunk should carry the same metadata as its parent document. If a chunk loses the effective interval during ingestion, the retriever cannot recover it later from the prose reliably.

```json
{
  "chunk_id": "refund-v2-section-03",
  "text": "Customers may request a refund within 30 days...",
  "embedding": "...",
  "valid_from": "2026-05-01T00:00:00Z",
  "valid_until": "2026-08-31T23:59:59Z",
  "recorded_at": "2026-05-01T09:12:00Z",
  "source_version": "refund-v2"
}
```

A useful invariant is simple: **every answerable historical claim must be traceable to an evidence interval**. If a source has no temporal metadata, the system should mark it as current-only, timeless, or unknown rather than silently treating it as valid for every date.

## Resolve the question’s reference time explicitly

Users rarely speak in database timestamps. They say “last quarter,” “before the migration,” “when I joined,” “at the time of the outage,” or “what is the rule now?” A temporal query planner must translate language into a reference interval while preserving uncertainty.

The planner can use conversation context, user profile, known events, and a clock service. It should not invent precision that the user did not provide.

```ts
type TemporalIntent = {
  query: string;
  referenceStart?: string;
  referenceEnd?: string;
  relation: "at" | "before" | "after" | "between" | "current" | "unknown";
  confidence: number;
  needsClarification: boolean;
};
```

“Under the policy we used then” may resolve from the transaction date in the case record. “What was the policy last quarter?” can resolve to a calendar interval. “Before the incident” may require a known incident timestamp. If multiple interpretations remain plausible and the answer would change, ask a clarification question instead of picking the latest document.

The retrieval query should expose the temporal assumption to the rest of the pipeline:

```text
semantic query: refund eligibility
reference interval: [2026-04-20, 2026-04-20]
mode: valid-at
required evidence: policy version effective on reference date
```

## Retrieve in stages: temporal filter, semantic rank, contradiction check

A robust pipeline usually combines structured filtering with semantic retrieval rather than asking one vector query to do everything.

The first stage narrows candidates using the temporal relation. For a point-in-time question, select chunks where `valid_from <= t` and (`valid_until` is null or `t <= valid_until`). For a range question, choose documents whose validity interval overlaps the requested interval. For “current,” use the system’s clock and a currentness policy, not the last chunk returned by the vector database.

The second stage ranks the temporally valid candidates by semantic relevance, source authority, granularity, and coverage. The third stage checks whether the candidates contradict one another, overlap ambiguously, or leave a gap.

![A hand-drawn pipeline filtering evidence by time before semantic ranking and contradiction review](/blog/temporal-rag-time-aware-retrieval/pipeline.webp)

| Stage                 | Input                           | Output                          | Main failure it prevents            |
| --------------------- | ------------------------------- | ------------------------------- | ----------------------------------- |
| Temporal planner      | User query and context          | Reference interval and relation | Answering the wrong time            |
| Candidate filter      | Source metadata                 | Temporally eligible chunks      | Newer documents dominating history  |
| Semantic ranker       | Eligible chunks                 | Relevant evidence set           | Returning valid but irrelevant text |
| Contradiction checker | Evidence set and lineage        | Conflict/gap signal             | Blending incompatible versions      |
| Generator             | Evidence plus temporal contract | Cited answer with scope         | Presenting uncertainty as certainty |

This sequence is not universal. In some domains, semantic retrieval first can help identify the event that defines the time interval. The engineering principle is to make the ordering explicit and testable.

## Contradictions are data, not noise

Temporal corpora naturally contain statements that conflict because reality changed. The system should not automatically “fix” the conflict by asking the language model to choose the most fluent paragraph.

Imagine two records:

```text
2026-04-10: The service supports password login.
2026-06-02: Password login has been disabled for new accounts.
```

These statements are not necessarily contradictory. They may describe different populations and effective dates. Another pair may be a genuine correction:

```text
2026-04-10: Data is retained for 30 days.
2026-04-12 correction: The previous retention period was incorrect; data is retained for 7 days.
```

A contradiction layer should classify the relationship: supersedes, narrows scope, expands scope, corrects, coexists, or unresolved. Keep the classification close to evidence so the generator can explain why one source wins.

| Conflict type    | Resolution                                             | Answer behavior                  |
| ---------------- | ------------------------------------------------------ | -------------------------------- |
| Supersession     | Pick source valid at reference time                    | Cite the applicable version      |
| Scope difference | Filter by tenant, product, or population               | State the scope explicitly       |
| Correction       | Prefer the corrected record for its effective interval | Mention correction when material |
| Overlap          | Apply domain precedence or ask                         | Do not blend silently            |
| Unresolved       | Escalate or qualify                                    | Say that evidence conflicts      |

The generator should be prohibited from saying “the policy is X” when the evidence only supports “the policy was X between April 1 and April 30.” Temporal qualifiers are part of correctness.

## Evaluate historical questions, not just answer quality

An ordinary RAG benchmark can grade relevance, groundedness, and answer correctness. A temporal benchmark needs additional labels:

1. Did the system identify the intended reference interval?
2. Did it retrieve evidence valid for that interval?
3. Did it avoid using later evidence to rewrite the past?
4. Did it distinguish a correction from a new policy?
5. Did it express uncertainty when the interval or lineage was ambiguous?

A small test matrix can cover most high-risk bugs:

| Test             | Query                               | Expected behavior                             |
| ---------------- | ----------------------------------- | --------------------------------------------- |
| Point lookup     | “What rule applied on April 20?”    | Return the version valid on April 20          |
| Before/after     | “What changed after the migration?” | Compare two intervals and cite both           |
| Late ingestion   | An April document arrives in June   | Preserve valid time; record ingestion time    |
| Contradiction    | Two overlapping policies            | Surface conflict or apply explicit precedence |
| Current fallback | “What is the rule now?”             | Use currentness policy and current clock      |
| Missing time     | “What was the old rule?”            | Ask or qualify rather than choose arbitrarily |

This is where temporal RAG connects naturally to eval-driven system design. Each temporal case should capture not only the final prose but also the selected interval, source versions, and evidence chain.

![A hand-drawn timeline benchmark showing historical queries, overlapping validity windows, and expected evidence](/blog/temporal-rag-time-aware-retrieval/benchmark.webp)

A hard grader can verify interval inclusion and source IDs. A semantic grader can assess whether the explanation of a change is understandable. If the system chooses a source that was not valid at the reference time, it should be a hard failure even if the answer sounds plausible.

## Make the UI show time, not hide it

The retrieval contract is wasted if the user interface displays a timeless paragraph. A temporal answer should make its scope visible.

A useful citation card can show the source version, valid interval, recorded time, and whether the source was superseded. A comparison view can place “then” and “now” side by side. If the system inferred the date from context rather than receiving it directly, show that assumption in a subtle but readable way.

```text
Answer for: 20 April 2026
Evidence: Refund Policy v1
Valid: 8 January–30 April 2026
Recorded: 8 January 2026
Status: Superseded by v2 on 1 May 2026
```

This is not decorative metadata. It gives the reader a way to catch a wrong assumption before acting on it.

## Failure modes that look intelligent in a demo

The most dangerous temporal bugs are often fluent.

**Latest-document bias** happens when a retriever ranks the newest policy highly because it is concise and semantically close. The fix is not a prompt instruction; it is a temporal filter or explicit currentness rule.

**Date mention bias** happens when a chunk contains the word “April” but was published in June. The system treats a mention of a date as evidence that the document was valid on that date. Store effective intervals separately from prose.

**Time-zone drift** happens when an event near midnight is assigned to the wrong business day. Normalize timestamps but preserve the domain’s local calendar when the policy is defined in local time.

**Retroactive correction confusion** happens when a later correction is applied to historical decisions that were valid under the old information. Whether to answer with “what was true” or “what should have been known” is a product decision and must be explicit.

**Temporal hallucination** happens when the model invents a precise date because the evidence is vague. An `unknown` interval should remain unknown.

## A production checklist

Before shipping a time-aware RAG feature, verify that every source class has a documented notion of validity, observation, and precedence. Verify that the ingestion pipeline preserves temporal metadata at chunk level. Verify that query planning can represent point, range, before, after, current, and unknown relations. Verify that contradictions are surfaced rather than silently blended.

Then replay a golden set with historical questions, late-arriving documents, overlapping policies, timezone edges, and ambiguous references. Instrument the trace so an engineer can see the inferred interval, candidate sources, rejected sources, and final evidence. Track a temporal error budget separately from ordinary answer quality.

## Closing perspective

A vector database is good at finding similar language. It is not automatically good at remembering which truth applied when. The difference is a system-design problem involving data modeling, query planning, source lineage, contradiction handling, UI evidence, and evaluation.

Temporal RAG becomes practical when time is treated as a first-class contract. The result is not merely a more accurate answer. It is an answer that can explain **which reality it is talking about, which evidence supports it, and where the boundary of certainty ends**.

## References

[1]: https://arxiv.org/html/2507.22917v1 "RAG for Answering Diachronic Questions"
[2]: https://openreview.net/forum?id=kwro5432AI "Right Answer at the Right Time — Temporal Retrieval-Augmented Generation"
[3]: https://github.com/open-telemetry/semantic-conventions-genai "OpenTelemetry Semantic Conventions for Generative AI"

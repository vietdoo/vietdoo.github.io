---
title: "Mentoring a RAG System: What Production Teaches That Tutorials Don't"
description: "Architecture, production incidents, and key takeaways from guiding a senior intern to build a RAG chatbot + dashboard on Cloud — written for engineers, not to brag."
pubDate: 2026-02-06
category: "engineering"
image: "/blog/hanh-trinh-mentor-thuc-tap-sinh-ai/hero.webp"
lang: "en"
translationKey: "hanh-trinh-mentor-thuc-tap-sinh-ai"
draft: false
---

![Mentoring a RAG pipeline from zero to production](/blog/hanh-trinh-mentor-thuc-tap-sinh-ai/hero.webp)

> **TL;DR** — 8 weeks, 1 senior intern, 1 RAG + Dashboard system running live in production on Cloud. Results: 2,639 public administrative procedures indexed into 20,916+ vectors, 90.8% retrieval accuracy over 308 real chat sessions, query latency reduced by ~70% after one round of pipeline optimization. This article isn't an emotional retrospective — it's an engineering log of decisions made right and wrong, and how I mentored a newcomer through each decision.

## The Problem

Problem statement: Build an AI Virtual Assistant for querying public administrative procedures using RAG, accompanied by a Dashboard analyzing processing performance — assigned to a senior intern, over 8 weeks, deployed live on Cloud infrastructure rather than demoing on a local machine.

Real-world constraints made this problem very different from a side-project: input data consisted of Vietnamese legal texts with mixed structures (prose, tables, clauses), the system had to run 24/7 on Cloud, and end-users were administrative staff — not developers, meaning everything from UI to data updating mechanisms had to be "zero-technical-debt for non-technical users".

## System Architecture

```
┌─────────────┐      ┌──────────────┐      ┌─────────────────────────┐
│   Next.js    │ HTTP │   FastAPI    │      │        RAG Pipeline      │
│  (Chat + UI) │─────▶│   Backend    │─────▶│  Embed → Retrieve(k=10)  │
└─────────────┘      └──────┬───────┘      │  → Rerank(k=3) → Fallback│
                             │              │  → Gemini 2.5 Flash      │
                             ▼              └─────────────────────────┘
                      ┌──────────────┐
                      │  PostgreSQL   │◀── chat history, api_logs, records
                      │  ChromaDB     │◀── 20,916 vector chunks
                      └──────────────┘
```

The two most noteworthy architectural decisions, both of which served as lessons for myself during reviews:

**1. Reranker is mandatory, not optional.** Pure similarity search on embeddings returns top-10 chunks that are mathematically "close", but not necessarily "correct" in terms of question semantics. Adding a cross-encoder reranker (`ms-marco-MiniLM`) to filter top-10 down to top-3 was the single biggest contributor to answer quality — even bigger than switching LLMs.

**2. Fallback handler is a contract, not a nice-to-have.** The similarity score threshold was hard-coded: below the threshold, the system answers "Information not found" instead of pushing an empty context into the LLM. Without this step, hallucination on a public administrative system is an unacceptable risk — a single wrong answer on legal procedures has real consequences for real users.

## The Hardest Technical Problem: Chunking Is Not a One-Size-Fits-All Issue

Fixed character count chunking — the most common approach in most RAG tutorials — failed immediately on legal documents because it sliced through "required documents" tables or separated a legal clause from its governing document number.

The final solution — researched independently by the intern after I presented the problem without giving the answer — was section-based chunking routed by 3 content types:

| Content Type | Strategy | Size |
|---|---|---|
| Prose (step-by-step procedures) | `RecursiveCharacterTextSplitter` | ~350 tokens, overlap 50 |
| Tables (documents, fees) | Serialize to text, preserve 1 table = 1 chunk | No hard limit |
| Legal clauses | 1 document = 1 chunk, tagged with document ID | ~100–150 tokens |

Each chunk was enriched with metadata (`ma_thu_tuc`, `section_type`, `so_van_ban`, `cap_thuc_hien`) — allowing pre-filtering before vector search instead of querying the entire corpus, speeding up search while reducing noise.

## When the System Hit Production: Live Incident Logs

![3 AM production incident](/blog/hanh-trinh-mentor-thuc-tap-sinh-ai/production-incident.webp)

This is the section I believe carries the most value for developers, as it isn't found in any textbook:

| Incident | Root Cause | Fix / Resolution |
|---|---|---|
| Total vector DB loss after server restart | ChromaDB Docker image changed default storage path, bind mount misconfigured | Configured explicit volume paths, rebuilt index from source |
| Crawler blocked mid-way | Request rate too high, missing delay + IP rotation | Added rate throttling, checked `robots.txt` before crawling |
| Random PostgreSQL write failures | NULL character (`\x00`) embedded in scraped text | Sanitized input before insertion; never trust raw source data 100% |
| Irrelevant search results (domestic vs. international marriage) | Query expansion was not specific enough | Added context-based weighting, controlled query expansion |

For every incident, my mentoring approach was identical: never fix it for them immediately. Let the intern read the logs, formulate hypotheses, and verify independently before I confirmed whether the direction was right or wrong. Independent debugging in production is a skill no exercise can teach except production itself.

## Measurable Results

| Metric | Value |
|---|---|
| Administrative procedures indexed | 2,639 (across 6 ministries) |
| Vector chunks in ChromaDB | 20,916 |
| Retrieval accuracy (real-world) | 90.8% across 308 chat sessions |
| Latency reduction after pipeline optimization | ~70% |
| Demo records integrated into Dashboard | 801 |
| System Uptime | 24/7 on GCP Compute Engine + Vercel |

The most important metric to me wasn't 90.8% — it was that the **Ministry/Department Dashboard allowed operational staff to self-add data sources via Excel files without engineering intervention**. A high accuracy rate is useless if the system dies the moment the intern leaves because no one else can operate it.

## Technical Mentorship Lessons, Distilled into 4 Rules

1. **Provide constraints, not solutions.** "Chunking for administrative documents needs custom optimization; research it further" led to a better solution than any answer I could have handed out.
2. **Let production incidents teach.** Fixing a bug for them saves 20 minutes today, but robs them of an independent debugging lesson they will need next week.
3. **Distinguish between "academic reporting" and "executive reporting."** Graduation presentation slide structure (self-intro → results → skills acquired) completely misses the audience when presenting to leadership, where bottom-line first – evidence second is required, alongside a mandatory "next steps" slide.
4. **Repeated feedback isn't a sign of failure — it's a sign the learner is serious.** How someone responds to the 5th round of feedback matters far more than the quality of their first submission.

## Conclusion

![Mentor and mentee finishing the journey](/blog/hanh-trinh-mentor-thuc-tap-sinh-ai/ending.webp)

Final grade I awarded: 8.x/10. Not a perfect score — there is still latency to optimize and presentation details to refine. But I believe an honest evaluation, highlighting both strengths and specific areas for improvement, is far more valuable than a padded report card that doesn't reflect reality.

If any developer is considering mentoring an intern: do it, but don't do the work for them. The greatest value isn't the working end product — it's the capacity for self-debugging, independent research, and self-critique that they carry with them when they leave.

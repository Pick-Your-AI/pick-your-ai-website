# Bounded real-data pilot: evidence and limits

This pilot replaces the synthetic fixture with **sourced** records for one open-weight model and its publisher. It is a bounded evidence exercise, not a claim that the production catalog, rights review or publication eligibility is done.

## Inventory

| Record                      | Identity                                               | Exact revision                                                 |
| --------------------------- | ------------------------------------------------------ | -------------------------------------------------------------- |
| Publisher                   | `cat.model_provider.qwen` — Qwen                       | 2026-11-05 catalog capture, not a vendor release               |
| Model                       | `cat.model.qwen25_05b_instruct`                        | Hugging Face commit `7ae557604adf67be50417f59c2c2f167def9a775` |
| Candidate rate (unadmitted) | `rate.license.qwen25_05b_instruct` in `prices.pilot.1` | same immutable model revision                                  |

There is no hosted-service admission, SLA or independent quality comparison. `billing_class: unknown` is intentional. No model weights are downloaded; only public model metadata and the publisher's license text were read.

## Primary-source checks, 2026-11-05

**Publisher model card at the captured revision** — <https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct/blob/7ae557604adf67be50417f59c2c2f167def9a775/README.md>

- Names `Qwen2.5-0.5B-Instruct`, with the publisher's Qwen organization.
- States **"Context Length: Full 32,768 tokens and generation 8192 tokens."**
- The card metadata and repository tags identify `license: apache-2.0`, `safetensors`, `text-generation` and arXiv `2407.10671`.

**Immutable-revision configuration** — <https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct/blob/7ae557604adf67be50417f59c2c2f167def9a775/config.json>

- `max_position_embeddings: 32768`
- `model_type: qwen2`
- `vocab_size: 151936`

**Publisher-distributed license** — <https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct/blob/7ae557604adf67be50417f59c2c2f167def9a775/LICENSE>

- The text is Apache License, Version 2.0, January 2004. That license permits use, modification and redistribution without royalties subject to its conditions.

## Evidence grades

All entries are `verification_status: unverified`. This is deliberate: these are source-checked primary-source claims without an independent reviewer or independent corroboration. The website's evidence rule is unchanged — independent support is needed before moving an entry to `verified`.

The two listed sources are two artifacts from the same publisher, not two independent publishers. They are recorded separately because they ground different fields, not because they provide independent corroboration.

## Cost scope and owner disposition, 2026-11-17

**Quantitative pilot pricing is deferred.** The publisher's license supports a qualitative royalty-free licensing fact. It does not publish a USD/month schedule, a licence count, an occurrence count, or a proration rule. Turning that fact into a monthly quantity of one would invent a usage basis. This campaign therefore keeps the model's `billing_class: unknown` and does not claim that issue #15's published-pricebook acceptance criterion is met.

The existing `prices.pilot.1` candidate retains its provisional `0.00`/`license_month` record only to exercise schema validation, identity locks and the static provider's loading path. Its conditions and provenance explicitly mark it as **unadmitted for quantitative pricing**. The v1 schema requires at least one rate; an empty pricebook would not be a valid substitute. This candidate must not be promoted as an authoritative rate or a demonstrated cost projection. A source-supported pricebook from the pricing/research owner is still required before publication.

The estimator leaves both `license_month` and `one_time` unpriced unless a supported quantity model is added through the contract/usage-model process. It reports incomplete coverage and a warning instead of assuming a single licence, prorating across a period, or assuming a single charge. Existing token, GPU-hour and storage projections are unchanged. The actual pilot model also remains unpriced because its billing classification is unknown; a zero-valued provisional rate does not turn that into free hosting.

Compute, hosting, inference, storage, egress and support costs remain unestablished. No inference-token price, total-cost claim or zero-cost AI stack is asserted.

The candidate citation correction pins the licence URL to the same immutable model revision. The original capture timestamp is retained as the earlier contributor's record, not presented as a newly reproduced historical check. The pinned licence was read on 2026-11-17 for this correction. Future admitted artifact revisions require their own identities and evidence dates.

## What is still missing

- An admitted pricebook, documented quantity/proration semantics and receiving-owner acceptance are absent. Research issue #39 must supply that basis before the quantitative pilot is considered complete.
- Other component kinds are not represented, so a complete T0–T6 builder stack is not claimed.
- No calibrated capacity evidence is available; VRAM-fit stays Unknown, as before.
- No published evidence about provider quotas, availability, latency, quality, privacy, regional restrictions or customer entitlement exists.
- Apache-2.0 licensing is not an authorization to publish arbitrary other vendors' content. The broader source-permission review remains needed.
- No automatic freshness policy adopts new versions. Pinning does not make a vendor fact current forever.

## Commands to reproduce the source checks

```sh
curl -fsSL https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct/raw/7ae557604adf67be50417f59c2c2f167def9a775/README.md
curl -fsSL https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct/raw/7ae557604adf67be50417f59c2c2f167def9a775/config.json
curl -fsSL https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct/raw/7ae557604adf67be50417f59c2c2f167def9a775/LICENSE
```

The original capture values above are attributed to the contributor’s 2026-11-05 record. These pinned commands are for later source rechecks; running them does not reproduce a historical observation time. This correction is to an unpublished PR candidate, not an overwrite of an admitted immutable artifact. Any subsequent admitted data change must use a new immutable revision.

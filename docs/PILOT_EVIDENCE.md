# Bounded real-data pilot: evidence and limits

This pilot replaces the synthetic fixture with **sourced** records for one open-weight model and its publisher. It is a bounded evidence exercise, not a claim that the production catalog, rights review or publication eligibility is done.

## Inventory

| Record           | Identity                                               | Exact revision                                                 |
| ---------------- | ------------------------------------------------------ | -------------------------------------------------------------- |
| Publisher        | `cat.model_provider.qwen` — Qwen                       | 2026-11-05 catalog capture, not a vendor release               |
| Model            | `cat.model.qwen25_05b_instruct`                        | Hugging Face commit `7ae557604adf67be50417f59c2c2f167def9a775` |
| License-fee rate | `rate.license.qwen25_05b_instruct` in `prices.pilot.1` | same immutable model revision                                  |

There is no hosted-service admission, SLA or independent quality comparison. `billing_class: unknown` is intentional. No model weights are downloaded; only public model metadata and the publisher's license text were read.

## Primary-source checks, 2026-11-05

**Publisher model card** — <https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct>

- Names `Qwen2.5-0.5B-Instruct`, with the publisher's Qwen organization.
- States **"Context Length: Full 32,768 tokens and generation 8192 tokens."**
- The card metadata and repository tags identify `license: apache-2.0`, `safetensors`, `text-generation` and arXiv `2407.10671`.

**Immutable-revision configuration** — <https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct/blob/7ae557604adf67be50417f59c2c2f167def9a775/config.json>

- `max_position_embeddings: 32768`
- `model_type: qwen2`
- `vocab_size: 151936`

**Publisher-distributed license** — <https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct/blob/main/LICENSE>

- The text is Apache License, Version 2.0, January 2004. That license permits use, modification and redistribution without royalties subject to its conditions.

## Evidence grades

All entries are `verification_status: unverified`. This is deliberate: these are source-checked primary-source claims without an independent reviewer or independent corroboration. The website's evidence rule is unchanged — independent support is needed before moving an entry to `verified`.

The two listed sources are two artifacts from the same publisher, not two independent publishers. They are recorded separately because they ground different fields, not because they provide independent corroboration.

## Cost scope

The pilot pricebook has **one** rate: license fee 0.00 USD/month, `price_type: estimate`, bounded to the model's immutable version and the Apache-2.0 license. It carries the explicit condition that compute, hosting, inference, storage, egress and support are **not established and are not zero by implication**. No inference-token price is asserted.

Unknown cost remains incomplete coverage, not free hosting. In particular, do not describe this as a zero-cost AI stack.

## What is still missing

- Other component kinds are not represented, so a complete T0–T6 builder stack is not claimed.
- No calibrated capacity evidence is available; VRAM-fit stays Unknown, as before.
- No published evidence about provider quotas, availability, latency, quality, privacy, regional restrictions or customer entitlement exists.
- Apache-2.0 licensing is not an authorization to publish arbitrary other vendors' content. The broader source-permission review remains needed.
- No automatic freshness policy adopts new versions. Pinning does not make a vendor fact current forever.

## Commands to reproduce the source checks

```sh
curl -fsSL https://huggingface.co/api/models/Qwen/Qwen2.5-0.5B-Instruct
curl -fsSL https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct/raw/7ae557604adf67be50417f59c2c2f167def9a775/config.json
curl -fsSL https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct/raw/main/LICENSE
```

The URLs, dates and captured values above describe the observed state on 2026-11-05. A later change must be captured as a new immutable revision, not silently overwrite this pilot's revision.

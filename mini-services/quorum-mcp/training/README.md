# Meta Muse retrieval and fine-tuning data

This workflow grounds Meta Muse answers in public procurement records and
prepares supervised examples for fine-tuning a Meta open-weight model. The
Zambia Public Procurement Authority (ZPPA) OCDS release is published under
**CC BY 4.0**. Downloaded data and generated splits stay under `/tmp` by
default and are not committed.

## Important: the Meta API key does not train a model

Meta Model API serves Muse models for inference. Its API key can call Muse
Spark for retrieval-augmented answers, but it cannot update Muse Spark's model
weights or create a fine-tuned model. Meta's documented fine-tuning path uses
open-weight Muse models with training infrastructure. Muse Spark Open can be
fine-tuned through Meta's documented hosted providers, including Fireworks
AI, or with a supported GPU cluster. The 816B Muse Spark Open model cannot be
fine-tuned on this local Mac.

The repo's `.env.local` Meta credential is used only for `consult-meta`. The
Fireworks training credential is separate (`FIREWORKS_API_KEY`) and is not
configured in this checkout. No Meta adapter has been trained or deployed.

## Prepare retrieval and SFT data

```bash
python3 mini-services/quorum-mcp/training/ocds_pipeline.py download
python3 mini-services/quorum-mcp/training/ocds_pipeline.py index \
  --input /tmp/quorum-procurement-training/zambia_full.jsonl.gz
python3 mini-services/quorum-mcp/training/ocds_pipeline.py retrieve \
  --query "medical supplies cold chain" --country Zambia
python3 mini-services/quorum-mcp/training/ocds_pipeline.py prepare \
  --input /tmp/quorum-procurement-training/zambia_full.jsonl.gz
```

`prepare` creates `train.jsonl`, `valid.jsonl`, `test.jsonl`, and a manifest.
Each example teaches evidence-backed OCDS field extraction from a public
record. Splits are deterministic by OCID to prevent the same procurement
process from appearing in multiple splits. Synthetic tender packs and
existing evaluation labels are excluded. Supplier-party data is not copied;
emails, labelled phone numbers, and fax numbers in retained text are redacted.

The index and examples represent the Zambian source records. A country filter
is applied on every retrieval query; this corpus is not evidence about Kenyan
or Rwandan law. The model prompt prohibits legal-compliance, eligibility,
fraud, value-for-money, and award-quality conclusions from these records.

## Ask Meta Muse with retrieval

The API credential already shared with the project is read from `MUSE_API_KEY`
or `MODEL_API_KEY` in `.env.local` or the process environment. The call is
source-grounded inference; it does not fine-tune the hosted API model.

```bash
python3 mini-services/quorum-mcp/training/ocds_pipeline.py consult-meta \
  --db /tmp/quorum-procurement-training/zambia.sqlite3 \
  --country Zambia \
  --query "Find public tenders for medical supplies and cold-chain equipment; summarize the records and cite each OCID."
```

The response includes the model ID and source citations (dataset, OCID, and
release ID). The call uses the configured Meta Muse model, defaulting to
`muse-spark-1.3`.

## Fine-tune a Meta open-weight model

For a trained adapter, use Meta's [Muse Spark Open post-training guide](https://dev.meta.ai/docs/muse-spark-open/post-training)
and its Fireworks serverless SFT recipe. The training base model is Meta's
Muse Spark Open, not a third-party base model. Provide the generated
`train.jsonl` and `valid.jsonl`; keep `test.jsonl` held out for final
evaluation. Fireworks must enable Muse Spark Open training on the account.

The required Fireworks credential is separate from the Meta Model API key.
Once `FIREWORKS_API_KEY` and account access are available, follow the current
[Fireworks SFT recipe](https://github.com/fw-ai/cookbook/blob/main/training/recipes/sft_loop.py)
and training documentation. Do not upload private tenders or bidder data to
the hosted trainer.

The exact Fireworks training run has not been started because there is no
Fireworks key or training account configured here. The API key supplied for
Meta inference cannot be substituted for it. Meta also documents Muse Glimmer
SFT on GPUs; its 30B model requires substantially more memory than this
16 GiB local machine has.

## Source and license

- Publisher: Zambia Public Procurement Authority (ZPPA)
- Registry: <https://data.open-contracting.org/en/publication/3>
- License: <https://creativecommons.org/licenses/by/4.0/>
- Download: <https://data.open-contracting.org/en/publication/3/download?name=full.jsonl.gz>

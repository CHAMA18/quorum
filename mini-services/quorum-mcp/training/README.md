# OCDS retrieval data

This workflow turns a public procurement corpus into a searchable index and
supervised examples. The Zambia Public Procurement Authority (ZPPA) OCDS
release is published under **CC BY 4.0**. Downloaded data and generated splits
stay under `/tmp` by default and are not committed.

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

## Source and license

- Publisher: Zambia Public Procurement Authority (ZPPA)
- Registry: <https://data.open-contracting.org/en/publication/3>
- License: <https://creativecommons.org/licenses/by/4.0/>
- Download: <https://data.open-contracting.org/en/publication/3/download?name=full.jsonl.gz>

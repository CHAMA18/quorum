# Independent second review

Give `reviewer-pack.json` to a procurement reviewer who has not seen Quorum's findings or the existing evaluation labels. It contains the source documents, stable case IDs, and a blank finding form only. The pack does not include `gold.json`, model observations, or engine output.

Ask the reviewer to complete every case, including cases with no findings. Preserve source filenames and quote exact text. When the reviewer returns the completed file, run:

```sh
bun mini-services/quorum-mcp/independent-review.ts score /path/to/completed-reviewer-pack.json
```

The resulting report measures same-rule/same-source-file agreement, one-to-one matching, and whether reviewer quotes are present in the source files. It does not turn a small synthetic pack into a field pilot or legal accuracy claim.

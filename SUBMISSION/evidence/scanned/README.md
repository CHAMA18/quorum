# Scanned-page evidence

Two real public documents used to test the SAM 3.1 path. Neither is synthetic.

| File | Source | Retrieved | What it is |
| --- | --- | --- | --- |
| `CA-certificate-of-award-Feb-2019.pdf` | Communications Authority of Kenya — [Certificate of Award, supply and delivery of office safe, Feb 2019](https://www.ca.go.ke/sites/default/files/CA/Certificate%20of%20Award/Certificate-of-Award-Supply-and-Delivery-of-Office-Safe-Feb-2019.pdf) | 2026-10-31 | A one-page scanned certificate with a handwritten name, designation, signature and date. |
| `nyamira-price-schedule-p58.png` | County Government of Nyamira — [Tender CGN/T015/2024-2025](https://nyamira.go.ke/static/documents/04_03_2025_05_55_57_pm_Tender_Document_for_Supply_Delivery_and_Installtion_of_Medical_Equipment_to_Gesima_Magwagwa_Nyamusi_and_Other_Five_Health_Facilities_Tender_No_CGN_T015_2024_2025.pdf), page 58 | 2026-10-31 | A rendered page containing a conflict-of-interest table. |

## What the live SAM 3.1 call returned (2026-10-31)

Both calls used `POST https://api.meta.ai/v1/responses`, `model: "sam-3.1"`,
`stream: true`, `metadata.mask_encoding: "one_bit"`.

| Image | Prompt | Result |
| --- | --- | --- |
| `CA-certificate-of-award-Feb-2019.pdf` (page 1, 150 dpi) | `logo` | 1 box — the Authority's logo, `x1=351 y1=183 x2=484 y2=309` in a 1240×1754 page. |
| `nyamira-price-schedule-p58.png` | `table` | 1 box — the table, `x1=128 y1=122 x2=884 y2=1305` in a 993×1404 image. |
| `CA-certificate-of-award-Feb-2019.pdf` | `signature` | 0 boxes. Reported as no match, not as a signature. |
| `CA-certificate-of-award-Feb-2019.pdf` | `handwriting` | 1 box at 1000px wide (the handwritten name line); 0 at 1500px. The model is prompt- and resolution-sensitive. |

## The limit, stated plainly

SAM returns geometry, not meaning. A box around a table does not read the table, a
box around handwriting does not authenticate the signer, and a zero-match result
does not prove a document is unsigned. The upload route therefore marks every
scanned page `humanReviewRequired` whether SAM matches or not, and the UI says a
human must inspect the region.

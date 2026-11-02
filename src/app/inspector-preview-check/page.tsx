"use client";

/* TEMPORARY verification page — deleted after the visual check. */

import { useState } from "react";
import { SupplierDocumentInspector, type InspectableProfileDocument } from "@/components/quorum/org/supplier-document-inspector";
import type { MetaProfileDocumentScan } from "@/lib/meta-bid-document-assist";

const PDF_BASE64 =
  "JVBERi0xLjcKJYGBgYEKCjYgMCBvYmoKPDwKL0ZpbHRlciAvRmxhdGVEZWNvZGUKL0xlbmd0aCA0MjgKPj4Kc3RyZWFtCniczZVNixRBDIbv/SvqLIj5TgpkD7vTjQcvQv8BkVVW9LCL+Pt9e2bwNAVzLJoOIfX19Fud5HV53Bdqx/P2Y/nw6fnX3+c/L9++vk/qZUVZvbG2/fsi1vbPC5+nctNoTtT238tHU3MXN+sWeNUYvgvZZgHbbUVswww67Hm0Y2x9aPvPZX+3rPvyZXkdcfQ0iRKPahw3OSwvHK5pwaHxaFusAQLX2OIpHfEOb00FzxP8U2Db8LD7GISIirxXtH4bwfwqBY45JQFjzY7D1thkFVJWUVJTx9uVhfCcDmsdqFiVglWwwRewyxqMnxARzChEjj1E+V7hIHgAIlvdhr7en1sU9IA2Vwu8OCBOF83SrlhnDbHf8Xl56Iu4Ax9zzx6gI+BBAowdt7H9j0ueFcf+d947bk1c8d0xwNeSifHLnLiIh+pr2Mz4gb89ubJG+BYT43uJRYjqEF9qYnxG5T0qZfoIn6dO3arqzBQ6wJc+c+r27IoWJX1EnzNnLvpIce/dR3UTrXRi/Eg6el2gOg7wdebMTXWPbjWq+ujoE9Oj3BuxJ/MInyZI3H/aIFBTCmVuZHN0cmVhbQplbmRvYmoKCjcgMCBvYmoKPDwKL0ZpbHRlciAvRmxhdGVEZWNvZGUKL1R5cGUgL09ialN0bQovTiA1Ci9GaXJzdCAyNgovTGVuZ3RoIDQ3OAo+PgpzdHJlYW0KeJzVVE1r3DAQvftXzLE9FI2+pbIsbHbtFkpoSAotLT04tlhcglVsbUn/fUf2JiFEpediBnvmzUjzPI/hgCBAKZBgHSjQUoAGwxVsNhX79PtnAHbVHsNcsQ9DP8M3QhGu4XvF9vE0JuDVdls95e7b1N7FY7UWAc/JDxlXU+xPXZhg09RNg2gR0SgygygO9N6TeTJBPmHC0TeZVWejmJWIckdYs5qxa03Gl1x9rq/pTbkm5xzWXOVW//HefFe9niH+1Y/fVuwy9oc2BXh1eCtQGM6pTSul4F9f0++YQpvi/0tu6X+I418ZPptzE8dUsZvTbVrcHOQVu2jnkBFg78Pdr5CGrq1YPXaxH8YjsM/DuBvn4SHw/MQsmCybKWRVLbph12GOp6kjIeW85eT88Xj4G4veEXPrPGl3KXnCvFXCOKGNe4nlCTjU3plSnUZlPBF/iVlthZbSlOqc0sgd8lKdM3SX5c4WetFOKGOElAWMEzstFLe60ItzztOEjCxx8FIpLwq/RVh03HuvCxRILMRNGKMK10mtjVeuxM46hVxbzs8YDZZ9+Xj7I3TLwLJb36d3Nylraw3k2GXoh/Yi3tNWQXqUQNAG827ZjWNMedsse2ZMpInsmfPuoeI/wUUpaQplbmRzdHJlYW0KZW5kb2JqCgo4IDAgb2JqCjw8Ci9TaXplIDkKL1Jvb3QgMiAwIFIKL0luZm8gMyAwIFIKL0ZpbHRlciAvRmxhdGVEZWNvZGUKL1R5cGUgL1hSZWYKL0xlbmd0aCA0MQovVyBbIDEgMiAyIF0KL0luZGV4IFsgMCA5IF0KPj4Kc3RyZWFtCnicY2Bg+P+fiYGdgQFEMIIIJhDBDCJYGBkEGICCrECCxZOBAQBavwKdCmVuZHN0cmVhbQplbmRvYmoKCnN0YXJ0eHJlZgoxMDk3CiUlRU9G";

const DOC: InspectableProfileDocument = {
  requirement: "Certificate of incorporation / business registration",
  key: "orgs/org-demo/uid-demo/profile-documents/hash/demo.pdf",
  filename: "Injini-AI-Venture-Build-Offer-Letter-Samukhele-Ngoma.pdf",
  bytes: 1_245_184,
  contentType: "application/pdf",
  uploadedAt: "2026-10-31T09:12:00.000Z",
  sha256: "a".repeat(64),
};

const REVIEW: MetaProfileDocumentScan = {
  model: "muse-spark-1.3",
  readable: true,
  documentType: "CERTIFICATE OF INCORPORATION",
  requirementMatch: true,
  organizationNamed: "STACKONE SOLUTIONS LIMITED",
  issuedDate: "2021-03-12",
  expiryDate: "",
  documentNumber: "12045491",
  summary:
    "Certificate of incorporation for StackOne Solutions Limited, company number 12045491, registered on 12 March 2021 by the Companies Registry.",
  cautions: ["The scan is legible but the registry stamp is faint on page 1."],
  note: "A model reading of the file, not an official finding. Confirm every detail against the original; this is not an eligibility or authenticity decision.",
};

function loadPreview(): Promise<Blob> {
  const binary = atob(PDF_BASE64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return Promise.resolve(new Blob([bytes], { type: "application/pdf" }));
}

function requestScan(): Promise<MetaProfileDocumentScan> {
  return new Promise((resolve) => setTimeout(() => resolve(REVIEW), 1200));
}

export default function InspectorPreviewPage() {
  const [scan, setScan] = useState(false);
  return (
    <main className="min-h-screen bg-night p-6">
      <div className="mx-auto flex max-w-3xl flex-col gap-3">
        <button
          type="button"
          className="w-fit rounded-lg bg-white px-3 py-2 text-[13px] font-semibold text-night"
          onClick={() => setScan((value) => !value)}
        >
          Reopen with scan
        </button>
        <p className="text-[12px] text-white/60">Fixture page for the document inspector.</p>
      </div>
      <SupplierDocumentInspector
        key={scan ? "scan" : "idle"}
        doc={DOC}
        autoScan={scan}
        onClose={() => undefined}
        loadPreview={loadPreview}
        requestScan={requestScan}
        saveCopy={() => Promise.resolve()}
      />
    </main>
  );
}

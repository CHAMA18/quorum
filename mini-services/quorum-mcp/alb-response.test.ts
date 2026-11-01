import { afterEach, describe, expect, test } from "bun:test";
import { handleCycleRoutes } from "./cycle-routes";
import { state, type TenderCycle } from "./store";

const TENDER = "T-ALB-SUPPLIER-RESPONSE";
const DUE = new Date(Date.now() + 86_400_000).toISOString();

describe("authenticated supplier ALB responses", () => {
  afterEach(() => {
    state.cycle = state.cycle.filter((cycle) => cycle.tenderId !== TENDER);
  });

  test("binds the response to the attested bidder, records a receipt, and refuses another bidder", async () => {
    const cycle: TenderCycle = {
      tenderId: TENDER,
      workspaceId: "supplier-public",
      coi: [],
      alb: [
        { id: "alb-acme", tenderId: TENDER, bidder: "Acme Supplies Limited", openedAt: new Date().toISOString(), letterMd: "Explain the offered price and delivery plan.", responseDueAt: DUE },
        { id: "alb-beta", tenderId: TENDER, bidder: "Beta Works", openedAt: new Date().toISOString(), letterMd: "Explain the offered price and delivery plan.", responseDueAt: DUE },
      ],
      debriefs: [],
      complaints: [],
      clarifications: [],
      addenda: [],
      notices: [],
      specs: [],
      dissents: [],
      createdAt: new Date().toISOString(),
    };
    state.cycle.push(cycle);

    const path = `/api/tenders/${TENDER}/alb/alb-acme/response`;
    const recorded = await handleCycleRoutes(path, "POST", {
      response: "Our factory pricing reflects an existing materials contract and in-country stock.",
      evidenceRef: "supplier-cost-schedule.pdf, pages 2–4",
    }, "org:Acme Supplies", "supplier-public");
    expect(recorded?.status).toBe(201);
    const receipt = await recorded!.json() as { receiptHash: string; receivedAt: string };
    expect(receipt.receiptHash).toMatch(/^[a-f0-9]{32}$/);
    expect(cycle.alb[0].response?.submittedByOrg).toBe("Acme Supplies");

    const wrongSupplier = await handleCycleRoutes(`/api/tenders/${TENDER}/alb/alb-beta/response`, "POST", {
      response: "Our factory pricing reflects an existing materials contract and in-country stock.",
      evidenceRef: "supplier-cost-schedule.pdf",
    }, "org:Acme Supplies", "supplier-public");
    expect(wrongSupplier?.status).toBe(422);
    expect(cycle.alb[1].response).toBeUndefined();
  });
});

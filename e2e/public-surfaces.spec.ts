import { expect, test } from "playwright/test";

test("landing page renders and the API is healthy", async ({ page, request }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /One complete tender review/i }),
  ).toBeVisible();

  const health = await request.get("/api/health");
  expect(health.ok()).toBe(true);
  const body = (await health.json()) as { ok?: boolean; store?: { writable?: boolean } };
  expect(body.ok).toBe(true);
  expect(body.store?.writable).toBe(true);
});

test("supplier portal renders its sign-in door", async ({ page }) => {
  await page.goto("/org");
  await expect(page.getByRole("heading", { name: /Your procurement workspace/i })).toBeVisible();
});

test("documentation page renders", async ({ page }) => {
  await page.goto("/docs");
  await expect(page.locator("#docs-title")).toBeVisible();
});

test("a second self-serve workspace is refused", async ({ request }) => {
  const stamp = Date.now();
  /* On a fresh CI store the first account is allowed and opens the workspace;
     on a populated store it is already invitation-only. Either way, the next
     self-serve account must be refused. */
  const first = await request.post("/api/auth/register", {
    data: {
      name: "E2E First Owner",
      email: `e2e.first.${stamp}@example.test`,
      password: "a-long-e2e-password",
    },
  });
  expect([201, 403]).toContain(first.status());

  const second = await request.post("/api/auth/register", {
    data: {
      name: "E2E Second Tenant",
      email: `e2e.second.${stamp}@example.test`,
      password: "a-long-e2e-password",
    },
  });
  expect(second.status()).toBe(403);
  await expect(second.json()).resolves.toMatchObject({
    error: expect.stringContaining("invitation-only"),
  });
});

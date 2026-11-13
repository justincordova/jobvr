import { testClient } from "hono/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "@/app";
import { resetExamples } from "@/modules/example/services";

describe("Example Routes", () => {
  const client = testClient(createApp());

  beforeEach(() => {
    resetExamples();
  });

  it("GET /api/example returns an empty list", async () => {
    const res = await client.api.example.$get();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: [], count: 0 });
  });

  it("POST /api/example creates an example", async () => {
    const res = await client.api.example.$post({
      json: { name: "Alice", email: "alice@example.com" },
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    if (!body.success) throw new Error("expected a success envelope");
    expect(body.data.id).toBe(1);
    expect(body.data.name).toBe("Alice");
  });

  it("POST /api/example rejects an invalid body with the error envelope", async () => {
    const res = await client.api.example.$post({
      // @ts-expect-error intentionally invalid payload
      json: { email: "not-an-email" },
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({ success: false, error: "Validation Error" });
    expect(Array.isArray("details" in body ? body.details : undefined)).toBe(true);
  });

  it("GET /api/example/:id returns 400 for a non-numeric id", async () => {
    const res = await client.api.example[":id"].$get({ param: { id: "abc" } });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ success: false, error: "Validation Error" });
  });

  it("GET /api/example/:id rejects non-canonical numeric ids", async () => {
    for (const id of ["1e0", "0x1", "0", "-1", "99999999999999999999"]) {
      const res = await client.api.example[":id"].$get({ param: { id } });
      expect(res.status).toBe(400);
    }
  });

  it("PATCH /api/example/:id rejects an empty update", async () => {
    const res = await client.api.example[":id"].$patch({ param: { id: "1" }, json: {} });
    expect(res.status).toBe(400);
  });

  it("GET /api/example/:id returns 404 for an unknown id", async () => {
    const res = await client.api.example[":id"].$get({ param: { id: "999" } });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({
      success: false,
      error: "Not Found",
      message: "Example with ID 999 not found",
    });
  });

  it("supports a full CRUD round-trip", async () => {
    const created = await client.api.example.$post({
      json: { name: "Bob", email: "bob@example.com", age: 40 },
    });
    const createdBody = await created.json();
    if (!createdBody.success) throw new Error("create failed");
    const id = String(createdBody.data.id);

    const fetched = await client.api.example[":id"].$get({ param: { id } });
    expect(fetched.status).toBe(200);

    const updated = await client.api.example[":id"].$patch({
      param: { id },
      json: { name: "Bobby" },
    });
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({ data: { name: "Bobby", age: 40 } });

    const deleted = await client.api.example[":id"].$delete({ param: { id } });
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toMatchObject({ success: true });

    const list = await client.api.example.$get();
    expect(await list.json()).toMatchObject({ count: 0 });
  });
});

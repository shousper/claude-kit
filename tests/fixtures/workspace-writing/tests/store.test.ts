import { expect, test } from "bun:test";
import { put, expire } from "../src/store";

test("expires entries older than 10ms", async () => {
  put("a", "1", Date.now());
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(expire(10, Date.now())).toBe(1);
});

import { strict as assert } from "node:assert";
import { decideChange } from "./competitor_catalog.ts";

assert.equal(decideChange(12.99, 14.99), "increase");
assert.equal(decideChange(12.99, 12.99), "unchanged");
assert.equal(decideChange(12.99, 9.99), "decrease");
console.log("catalog decision test passed");

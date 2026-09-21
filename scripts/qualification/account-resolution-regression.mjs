import assert from "node:assert/strict";
import test from "node:test";

const {selectExpectedKeystore} = await import("./create-root-mandate.ts");

const expected = "0xcb5a845638cbc1f95d7f8343278685682c3ba13f";

test("wrong active profile does not reject the expected signer profile", () => {
  const selected = selectExpectedKeystore([
    {name: "agentpact-requester", address: "0x61f10cc252ed98ce7596c73fc557cca4cc600c82", path: "wrong.json"},
    {name: "meritround-v2-studionet", address: expected, path: "expected.json"},
  ]);
  assert.equal(selected.name, "meritround-v2-studionet");
});

test("selection is address-bound and deterministic", () => {
  const selected = selectExpectedKeystore([
    {name: "z-duplicate", address: expected.slice(2), path: "z.json"},
    {name: "a-duplicate", address: expected.toUpperCase(), path: "a.json"},
  ]);
  assert.equal(selected.name, "a-duplicate");
});

test("a different signer is rejected", () => {
  assert.throws(() => selectExpectedKeystore([
    {name: "other", address: "0x1111111111111111111111111111111111111111", path: "other.json"},
  ]), /No encrypted keystore matches/);
});

test("a missing expected signer fails closed", () => {
  assert.throws(() => selectExpectedKeystore([]), /No encrypted keystore matches/);
});

test("selection returns metadata only and never exposes keystore contents", () => {
  const selected = selectExpectedKeystore([{name: "expected", address: expected, path: "expected.json"}]);
  assert.deepEqual(Object.keys(selected).sort(), ["address", "name", "path"]);
});

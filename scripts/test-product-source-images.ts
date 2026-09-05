import assert from "node:assert/strict";
import { validateProductAgentSource } from "../lib/product/agent";

// Synthetic pixel fixtures validate reference binding, not real product image accuracy.
const bytes =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6pAAAAABJRU5ErkJggg==";
const image = (ref: string) => ({ ref, media_type: "image/png" as const, data_base64: bytes });
const source = {
  record_id: "synthetic-image-bindings",
  source_ref: "source-synthetic-image-bindings",
  evidence_refs: ["evidence-synthetic-image-bindings"],
  source_text: "Synthetic reference-binding test only",
  image_availability: "real_product_image" as const,
  image_refs: ["synthetic-image-a", "synthetic-image-b"],
  image_inputs: [image("synthetic-image-a"), image("synthetic-image-b")],
};
assert.deepEqual(validateProductAgentSource(source), source);
assert.deepEqual(
  validateProductAgentSource({ ...source, image_inputs: [...source.image_inputs].reverse() })
    .image_refs,
  source.image_refs,
);
// Two copies of A cannot substitute for bytes belonging to B.
assert.throws(() =>
  validateProductAgentSource({
    ...source,
    image_inputs: [image("synthetic-image-a"), image("synthetic-image-a")],
  }),
);
assert.throws(() =>
  validateProductAgentSource({
    ...source,
    image_refs: ["synthetic-image-a", "synthetic-image-a"],
    image_inputs: [image("synthetic-image-a")],
  }),
);
assert.throws(() =>
  validateProductAgentSource({ ...source, image_inputs: [image("synthetic-image-a")] }),
);
assert.throws(() =>
  validateProductAgentSource({
    ...source,
    image_inputs: [image("synthetic-image-a"), image("synthetic-image-c")],
  }),
);
assert.throws(() =>
  validateProductAgentSource({
    ...source,
    image_refs: ["", "synthetic-image-b"],
    image_inputs: [image(""), image("synthetic-image-b")],
  }),
);
assert.throws(() => validateProductAgentSource({ ...source, image_availability: "none" }));
const noImages = {
  ...source,
  image_availability: "none" as const,
  image_refs: [],
  image_inputs: [],
};
assert.deepEqual(validateProductAgentSource(noImages), noImages);
console.log("PASS product image source one-to-one bindings");

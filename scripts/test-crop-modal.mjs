import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");

function extractFunction(name) {
  const pattern = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`);
  const match = pattern.exec(html);
  assert.ok(match, `Expected ${name} to exist in index.html`);
  let signatureDepth = 1;
  let signatureQuote = "";
  let signatureEscaped = false;
  let signatureEnd = match.index + match[0].length;
  for (; signatureEnd < html.length && signatureDepth > 0; signatureEnd++) {
    const char = html[signatureEnd];
    if (signatureQuote) {
      if (signatureEscaped) signatureEscaped = false;
      else if (char === "\\") signatureEscaped = true;
      else if (char === signatureQuote) signatureQuote = "";
      continue;
    }
    if (char === "'" || char === '"' || char === "`") { signatureQuote = char; continue; }
    if (char === "(") signatureDepth++;
    if (char === ")") signatureDepth--;
  }
  const open = html.indexOf("{", signatureEnd);
  let depth = 0;
  let quote = "";
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let i = open; i < html.length; i++) {
    const char = html[i];
    const next = html[i + 1];
    if (lineComment) { if (char === "\n") lineComment = false; continue; }
    if (blockComment) { if (char === "*" && next === "/") { blockComment = false; i++; } continue; }
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === "/" && next === "/") { lineComment = true; i++; continue; }
    if (char === "/" && next === "*") { blockComment = true; i++; continue; }
    if (char === "'" || char === '"' || char === "`") { quote = char; continue; }
    if (char === "{") depth++;
    if (char === "}" && --depth === 0) return html.slice(match.index, i + 1);
  }
  assert.fail(`Could not find the end of ${name}`);
}

function install(context, name) {
  vm.runInContext(`${extractFunction(name)}\nthis.${name}=${name};`, context);
}

const cropMarkup = html.slice(html.indexOf('<div id="imageCropModal"'), html.indexOf('<div id="ownerConfirmModal"'));
assert.match(cropMarkup, /data-crop-action="cancel"/);
assert.match(cropMarkup, /data-crop-action="apply"/);
assert.doesNotMatch(cropMarkup, /onclick\s*=\s*["']finishImageCrop/);
assert.match(html, /touch-action:manipulation/);
assert.match(html, /@media\(pointer:coarse\).*min-height:48px/);

const actionCalls = [];
const cancelButton = { dataset: { cropAction: "cancel" } };
const applyButton = { dataset: { cropAction: "apply" } };
const modalListeners = {};
const modal = {
  dataset: {},
  addEventListener: (type, callback) => { modalListeners[type] = callback; },
  contains: () => true
};
const actionContext = vm.createContext({
  document: { getElementById: () => modal },
  finishImageCrop: action => { actionCalls.push(action); }
});
install(actionContext, "bindImageCropActions");
actionContext.bindImageCropActions();
actionContext.bindImageCropActions();
assert.equal(Object.keys(modalListeners).length, 1, "crop click delegation binds once");
for (const button of [cancelButton, applyButton]) {
  let prevented = false;
  modalListeners.click({ target: { closest: () => button }, preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
}
assert.deepEqual(actionCalls, [false, true], "delegated Cancel and Crop buttons dispatch the right actions");

function makeHarness(canvasFactory) {
  const buttonSet = [
    { dataset: { cropAction: "cancel" }, disabled: false },
    { dataset: { cropAction: "apply" }, disabled: false },
    { dataset: {}, disabled: false }
  ];
  const toasts = [];
  const modalClasses = new Set(["show"]);
  const modalElement = {
    classList: { add: value => modalClasses.add(value), remove: value => modalClasses.delete(value) },
    setAttribute: () => {}
  };
  const cropImage = { naturalWidth: 100, naturalHeight: 100, onload: null, onerror: null, removeAttribute: () => {} };
  const viewport = { clientWidth: 100, clientHeight: 80 };
  const elements = {
    imageCropModal: modalElement,
    cropImage,
    cropViewport: viewport,
    hidden: { value: "" },
    preview: { src: "", classList: { add(value) { this[value] = true; } } }
  };
  const context = vm.createContext({
    AbortController,
    Blob,
    MAX_CLOUD_IMAGE_BYTES: 1300000,
    pendingImageCrop: null,
    ownerProductImageQueue: null,
    showToast: message => toasts.push(String(message)),
    uploadOwnerImageToCloud: async () => { throw new Error("Unexpected upload"); },
    document: {
      getElementById: id => elements[id],
      querySelectorAll: () => buttonSet,
      createElement: () => canvasFactory()
    },
    setTimeout: (callback, delay) => setTimeout(callback, Math.min(delay, 5)),
    clearTimeout
  });
  for (const name of ["releaseCropForm", "setImageCropBusy", "canvasBlob", "closeImageCrop", "finishImageCrop"]) install(context, name);
  return { context, elements, buttonSet, toasts, modalClasses };
}

const abortHarness = makeHarness(() => ({ getContext: () => ({ drawImage() {} }), toBlob() {} }));
let uploadCalls = 0;
abortHarness.context.uploadOwnerImageToCloud = async () => { uploadCalls++; return "/unused"; };
const cancelledInput = { disabled: true, value: "photo.jpg" };
const cancelledSubmit = { disabled: true };
const queue = { input: cancelledInput, submit: cancelledSubmit };
const controller = new AbortController();
const queuedCrop = { uploading: true, queue: true, input: cancelledInput, submit: cancelledSubmit, processingController: controller };
abortHarness.context.pendingImageCrop = queuedCrop;
abortHarness.context.ownerProductImageQueue = queue;
await abortHarness.context.finishImageCrop(false);
assert.equal(controller.signal.aborted, true, "Cancel aborts active image work");
assert.equal(abortHarness.context.pendingImageCrop, null, "Cancel closes the crop modal");
assert.equal(abortHarness.context.ownerProductImageQueue, null, "Cancel discards the queued image");
assert.equal(cancelledInput.disabled, false);
assert.equal(cancelledInput.value, "");
assert.equal(cancelledSubmit.disabled, false);
assert.equal(uploadCalls, 0, "Cancel never uploads or saves the crop");
assert.ok(abortHarness.toasts.some(message => message.includes("هەڵوەشایەوە")));

const successHarness = makeHarness(() => ({
  getContext: () => ({ drawImage() {} }),
  toBlob: callback => callback(new Blob(["image"], { type: "image/webp" }))
}));
const validImageUrl = `/api/media/shop/${"a".repeat(43)}.jpg`;
let successfulUploads = 0;
successHarness.context.uploadOwnerImageToCloud = async blob => {
  successfulUploads++;
  assert.equal(blob.type, "image/webp");
  return validImageUrl;
};
const successInput = { disabled: true, value: "photo.jpg" };
const successSubmit = { disabled: true };
successHarness.context.pendingImageCrop = {
  uploading: false, queue: false, input: successInput, submit: successSubmit,
  hiddenId: "hidden", previewId: "preview", scale: 1, left: 0, top: 0, ratio: 0.8
};
await successHarness.context.finishImageCrop(true);
assert.equal(successfulUploads, 1);
assert.equal(successHarness.elements.hidden.value, validImageUrl, "successful Crop saves the shared image URL");
assert.equal(successHarness.elements.preview.src, validImageUrl);
assert.equal(successHarness.context.pendingImageCrop, null, "successful Crop closes the modal");
assert.equal(successInput.disabled, false);
assert.equal(successSubmit.disabled, false);
assert.ok(successHarness.toasts.some(message => message.includes("ئامادەیە")));
assert.ok(successHarness.buttonSet.every(button => button.disabled === false), "closing restores crop controls");

const timeoutHarness = makeHarness(() => ({ getContext: () => ({ drawImage() {} }), toBlob() {} }));
const failedInput = { disabled: true, value: "photo.jpg" };
const failedSubmit = { disabled: true };
const failedCrop = {
  uploading: false, queue: false, input: failedInput, submit: failedSubmit,
  hiddenId: "hidden", previewId: "preview", scale: 1, left: 0, top: 0, ratio: 0.8
};
timeoutHarness.context.pendingImageCrop = failedCrop;
await timeoutHarness.context.finishImageCrop(true);
assert.equal(failedCrop.uploading, false, "a stalled encoder unlocks the modal actions");
assert.equal(timeoutHarness.context.pendingImageCrop, failedCrop, "failure leaves the modal available for retry or cancel");
assert.ok(timeoutHarness.toasts.some(message => message.includes("took too long")), "failure has a clear timeout message");
assert.equal(timeoutHarness.buttonSet[0].disabled, false, "Cancel stays available during and after failure");
assert.equal(timeoutHarness.buttonSet[1].disabled, false, "Crop can be retried after failure");
assert.equal(failedSubmit.disabled, true, "the product form remains protected until the crop is completed or cancelled");
await timeoutHarness.context.finishImageCrop(false);
assert.equal(timeoutHarness.context.pendingImageCrop, null, "Cancel closes after a processing error");
assert.equal(failedInput.disabled, false);
assert.equal(failedSubmit.disabled, false, "Cancel releases the product form after a failed crop");

console.log("Crop modal regression tests passed: iPhone touch delegation, cancel/abort, successful crop upload, timeout error, retry/cancel recovery.");

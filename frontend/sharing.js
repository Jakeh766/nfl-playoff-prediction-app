import { createShareModel, nativeSharePayload } from "./share-model.js";
import { renderShareCard, canvasPng } from "./share-card.js";

let activeDialog = null;
export async function openShareCard(context) {
  if (activeDialog?.open) return;
  const model = createShareModel(context);
  const track = event => context.track?.(event, { bracketType: context.sport });
  const dialog = document.createElement("dialog");
  dialog.className = "account-dialog prediction-share-dialog";
  dialog.setAttribute("aria-labelledby", "prediction-share-title");
  dialog.innerHTML = `
    <div class="dialog-heading"><h2 id="prediction-share-title">${model.kind === "results" ? "Share my results" : "Share my picks"}</h2>
      <button class="dialog-close" type="button" aria-label="Close sharing">×</button></div>
    <div class="prediction-share-preview" aria-busy="true"></div>
    <p class="input-hint">Your public picks and overall standings. Private group details are excluded.</p>
    <p class="dialog-message" role="status" aria-live="polite">Generating your image…</p>
    <div class="dialog-actions">
      <button class="button button-primary" data-share-native type="button" hidden disabled>Share</button>
      <button class="button button-secondary" data-share-download type="button" disabled>Download image</button>
      <button class="button button-secondary" data-share-copy type="button">Copy public link</button>
    </div>
    <label class="prediction-share-link-label" for="prediction-share-link">Public bracket link</label>
    <input id="prediction-share-link" type="url" readonly />`;
  const preview = dialog.querySelector(".prediction-share-preview");
  const status = dialog.querySelector('[role="status"]');
  const native = dialog.querySelector("[data-share-native]");
  const download = dialog.querySelector("[data-share-download]");
  const copy = dialog.querySelector("[data-share-copy]");
  const link = dialog.querySelector("input");
  const trigger = document.activeElement;
  link.value = model.url;
  let imageUrl = null, file = null;
  const filename = `predict-playoffs-${context.sport}-${model.kind}.png`;
  document.body.appendChild(dialog);
  activeDialog = dialog;
  dialog.addEventListener("close", () => {
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    if (activeDialog === dialog) activeDialog = null;
    dialog.remove();
    if (trigger?.isConnected) trigger.focus();
  });
  dialog.querySelector(".dialog-close").addEventListener("click", () => dialog.close());
  native.hidden = !navigator.share;
  native.addEventListener("click", async () => {
    try {
      // Files were generated before this click, preserving mobile user activation.
      const payload = nativeSharePayload(model, file, navigator);
      if (!payload) return;
      await navigator.share(payload);
      track("share_native_used");
      status.textContent = "Shared.";
    } catch (error) {
      if (error.name !== "AbortError") status.textContent = "Sharing failed. Download the image or copy the public link.";
    }
  });
  download.addEventListener("click", () => {
    if (!imageUrl) return;
    const anchor = document.createElement("a");
    anchor.href = imageUrl;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    track("share_image_downloaded");
    status.textContent = "Image downloaded. Attach it to your message or post.";
  });
  copy.addEventListener("click", async () => {
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(model.url);
      else {
        link.select();
        if (!document.execCommand("copy")) throw new Error("Copy unavailable");
      }
      track("share_link_copied");
      status.textContent = "Public bracket link copied.";
    } catch (_error) {
      status.textContent = "Select the public link below and copy it manually.";
      link.focus();
      link.select();
    }
  });
  dialog.showModal();
  track("share_card_opened");
  try {
    const canvas = await renderShareCard(model);
    if (!dialog.open) return;
    preview.appendChild(canvas);
    const blob = await canvasPng(canvas);
    if (!dialog.open) return;
    imageUrl = URL.createObjectURL(blob);
    file = typeof File === "function" ? new File([blob], filename, { type: "image/png" }) : null;
    track("share_image_generated");
    download.disabled = false;
    native.disabled = false;
    native.textContent = nativeSharePayload(model, file, navigator)?.files ? "Share image" : "Share link";
    status.textContent = "Ready to share. The image is a snapshot of your saved picks and results.";
  } catch (error) {
    status.textContent = error.message || "Image generation failed. Copy the public link instead.";
    native.disabled = false;
    native.textContent = "Share link";
  } finally {
    preview.setAttribute("aria-busy", "false");
  }
}

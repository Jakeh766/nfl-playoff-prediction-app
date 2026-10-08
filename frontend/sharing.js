import { createShareModel, nativeSharePayload, shareImageFilename } from "./share-model.js";
import { renderShareCard, canvasPng } from "./share-card.js";

// The PNG remains available in the preview if the browser blocks a download.
// A download cannot report OS completion, so acknowledge only that it started.
export function downloadShareImage(imageUrl, filename) {
  if (!imageUrl?.startsWith("blob:")) throw new Error("The PNG is unavailable.");
  const anchor = document.createElement("a");
  anchor.href = imageUrl;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  try { anchor.click(); } finally { anchor.remove(); }
}

export function releaseShareImageUrl(imageUrl, downloadStarted = false) {
  if (!imageUrl) return;
  // Safari may resolve the download asynchronously after the dialog closes.
  if (downloadStarted) setTimeout(() => URL.revokeObjectURL(imageUrl), 60_000);
  else URL.revokeObjectURL(imageUrl);
}

export function usesIosImageSaving(browserNavigator) {
  return /iPad|iPhone|iPod/.test(browserNavigator.userAgent || "") ||
    (browserNavigator.platform === "MacIntel" && browserNavigator.maxTouchPoints > 1);
}

let activeDialog = null;
export async function openShareCard(context) {
  if (activeDialog?.open) return;
  const model = createShareModel(context);
  const track = event => context.track?.(event, { bracketType: context.sport });
  const dialog = document.createElement("dialog");
  dialog.className = "account-dialog prediction-share-dialog";
  dialog.setAttribute("aria-labelledby", "prediction-share-title");
  dialog.innerHTML = `
    <div class="dialog-heading"><h2 id="prediction-share-title">${model.kind === "results" ? "Share my results" : "Share bracket"}</h2>
      <button class="dialog-close" type="button" aria-label="Close sharing">×</button></div>
    <div class="prediction-share-preview" aria-busy="true"></div>
    <p class="dialog-message" role="status" aria-live="polite">Generating your image…</p>
    <div class="dialog-actions">
      <button class="button button-primary" data-share-native type="button" hidden disabled>Share bracket image</button>
      <button class="button button-secondary" data-share-download type="button" disabled>Download bracket image</button>
    </div>
    <p class="prediction-share-help" hidden></p>`;
  const preview = dialog.querySelector(".prediction-share-preview");
  const status = dialog.querySelector('[role="status"]');
  const native = dialog.querySelector("[data-share-native]");
  const download = dialog.querySelector("[data-share-download]");
  const help = dialog.querySelector(".prediction-share-help");
  const trigger = document.activeElement;
  let imageUrl = null, file = null, nativePending = false, downloadStarted = false;
  const filename = shareImageFilename(model);
  document.body.appendChild(dialog);
  activeDialog = dialog;
  dialog.addEventListener("close", () => {
    releaseShareImageUrl(imageUrl, downloadStarted);
    if (activeDialog === dialog) activeDialog = null;
    dialog.remove();
    if (trigger?.isConnected) trigger.focus();
  });
  dialog.querySelector(".dialog-close").addEventListener("click", () => dialog.close());

  async function shareImage() {
    if (nativePending || !dialog.open) return;
    // Re-check the exact prepared file on every attempt. No rendering or fetch
    // occurs between this user gesture and navigator.share().
    const payload = nativeSharePayload(model, file, navigator);
    if (!payload) {
      native.hidden = true;
      native.disabled = true;
      status.textContent = "Download the bracket image and upload it in your app.";
      return;
    }
    nativePending = true;
    native.disabled = true;
    native.setAttribute("aria-busy", "true");
    status.textContent = "";
    try {
      await navigator.share(payload);
      track("share_native_used");
      if (dialog.open) status.textContent = "Image sent to your share app.";
    } catch (error) {
      // Cancellation and an empty OS share sheet both use AbortError.
      if (dialog.open && error?.name !== "AbortError") {
        status.textContent = "Could not open sharing. Try again or download the bracket image.";
      }
    } finally {
      nativePending = false;
      native.removeAttribute("aria-busy");
      native.disabled = !nativeSharePayload(model, file, navigator);
    }
  }

  native.addEventListener("click", shareImage);
  download.addEventListener("click", () => {
    if (!imageUrl) return;
    try {
      downloadShareImage(imageUrl, filename);
      downloadStarted = true;
      track("share_image_downloaded");
      status.textContent = "Download started. Upload the PNG in your app.";
    } catch (_error) {
      status.textContent = "Download could not start. Try again or use your browser’s save options on the image.";
    }
  });
  dialog.showModal();
  track("share_card_opened");
  try {
    const canvas = await renderShareCard(model, { logoUrl: context.logoUrl });
    if (!dialog.open) return;
    const blob = await canvasPng(canvas);
    if (!dialog.open) return;
    imageUrl = URL.createObjectURL(blob);
    const image = document.createElement("img");
    image.alt = canvas.getAttribute("aria-label");
    image.width = canvas.width;
    image.height = canvas.height;
    image.src = imageUrl;
    // The preview uses the exact bytes that will be shared or downloaded.
    await image.decode();
    if (!dialog.open) return;
    preview.appendChild(image);
    file = typeof File === "function" ? new File([blob], filename, { type: "image/png" }) : null;
    track("share_image_generated");
    download.disabled = false;
    const canShareImage = Boolean(nativeSharePayload(model, file, navigator));
    native.hidden = !canShareImage;
    native.disabled = !canShareImage;
    help.hidden = false;
    help.textContent = "If your app isn’t listed, download the PNG and upload it there." +
      (usesIosImageSaving(navigator) ? " Downloads go to Files. Touch and hold the image for save options." : "");
    status.textContent = "";
    // Slow assets can outlast transient activation. Do not force a share call
    // after it expires; the visible button supplies a fresh gesture instead.
    if (canShareImage && navigator.userActivation?.isActive) void shareImage();
    else if (canShareImage) native.focus();
    else download.focus();
  } catch (_error) {
    if (dialog.open) status.textContent = "Could not generate your bracket image. Close this window and try again.";
  } finally {
    preview.setAttribute("aria-busy", "false");
  }
}

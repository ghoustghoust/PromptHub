/**
 * Reference images only need to be legible to the vision tower, not kept at
 * their original resolution. Downscaling here keeps a 20 MB ComfyUI export
 * from turning into a multi-minute request.
 */
export const MAX_REFERENCE_IMAGE_SIDE = 1024;

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Unable to read image"));
    reader.readAsDataURL(file);
  });
}

export async function downscaleImageToDataUrl(
  source: Blob,
  maxSide: number = MAX_REFERENCE_IMAGE_SIDE,
  quality = 0.85,
): Promise<string> {
  try {
    const bitmap = await createImageBitmap(source);
    try {
      const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas 2D is unavailable");
      context.drawImage(bitmap, 0, 0, width, height);
      return canvas.toDataURL("image/jpeg", quality);
    } finally {
      bitmap.close?.();
    }
  } catch {
    // A format the renderer cannot decode is sent as-is rather than dropped.
    return readAsDataUrl(source);
  }
}

export function base64ToBlob(base64: string, mimeType: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mimeType });
}
"use client";

/**
 * A file input that shrinks pictures in the browser before they are uploaded.
 *
 * Drop-in for `<input type="file" accept="image/*">`. On selection each
 * picture is decoded, scaled so its longest edge is CLIENT_MAX_EDGE, and
 * re-encoded as JPEG; the shrunk files are written back into the input, so
 * the ordinary form post carries them and every server action keeps working
 * unchanged.
 *
 * Why it exists: Vercel rejects request bodies over ~4.5 MB before our code
 * runs, and a phone photo is routinely 3–6 MB — so uploads were dying as a
 * blank "This page couldn't load" (see lib/upload-limits.ts). Shrinking also
 * turns a minute-long upload on a weak rural connection into a couple of
 * seconds, which is the version of this fix members will actually notice.
 *
 * Every failure path falls back to the original file rather than blocking the
 * post: an old browser with no canvas, a HEIC the browser can't decode, a
 * picture that somehow encodes LARGER. If what's left still won't fit, the
 * component says so in plain words BEFORE the submit, because the alternative
 * is the broken page this was built to kill.
 */
import { useRef, useState } from "react";
import {
  CLIENT_JPEG_QUALITY,
  CLIENT_MAX_EDGE,
  CLIENT_SHRINK_THRESHOLD_BYTES,
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_TOTAL_BYTES,
  shrinkTo,
  uploadFits,
  uploadLimitLabel,
} from "@/lib/upload-limits";

/** Shrink one picture, or return null to mean "send the original". */
async function shrinkImage(file: File): Promise<File | null> {
  if (!file.type.startsWith("image/")) return null;
  // GIFs may be animated — re-encoding through a canvas would flatten them to
  // a single frame, so they ride as-is and take their chances with the size
  // check below.
  if (file.type === "image/gif") return null;
  if (file.size <= CLIENT_SHRINK_THRESHOLD_BYTES) return null;
  if (typeof createImageBitmap !== "function") return null;

  let bitmap: ImageBitmap;
  try {
    // from-image bakes EXIF rotation into the pixels, so photos taken
    // sideways land the right way up (the server's sharp .rotate() then has
    // nothing left to do, which is fine).
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return null;
  }
  try {
    const { width, height } = shrinkTo(bitmap.width, bitmap.height, CLIENT_MAX_EDGE);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", CLIENT_JPEG_QUALITY),
    );
    // Never send something bigger than what we started with.
    if (!blob || blob.size >= file.size) return null;
    const name = file.name.replace(/\.[^.]*$/, "") || "photo";
    return new File([blob], `${name}.jpg`, { type: "image/jpeg", lastModified: Date.now() });
  } catch {
    return null;
  } finally {
    bitmap.close?.();
  }
}

export function ImageUpload({
  id,
  name,
  multiple,
  required,
}: {
  id?: string;
  name: string;
  multiple?: boolean;
  required?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function onChange() {
    const input = ref.current;
    const chosen = input?.files ? [...input.files] : [];
    setProblem(null);
    if (!input || !chosen.length) return;

    setBusy(true);
    let files = chosen;
    try {
      const shrunk = await Promise.all(chosen.map((f) => shrinkImage(f).catch(() => null)));
      files = shrunk.map((s, i) => s ?? chosen[i]);
      // DataTransfer is how a FileList is rebuilt; if this browser lacks it,
      // the original selection stays put and the size check below still runs.
      if (typeof DataTransfer === "function") {
        const dt = new DataTransfer();
        for (const f of files) dt.items.add(f);
        input.files = dt.files;
      } else {
        files = chosen;
      }
    } catch {
      files = chosen;
    } finally {
      setBusy(false);
    }

    const fit = uploadFits(files.map((f) => f.size));
    if (!fit.ok) {
      setProblem(
        fit.reason === "file"
          ? `That picture is too big to send, even after shrinking — the limit is ${uploadLimitLabel(
              MAX_UPLOAD_BYTES,
            )}. Try a different picture.`
          : `Those pictures are too big to send together — the limit is ${uploadLimitLabel(
              MAX_UPLOAD_TOTAL_BYTES,
            )} for one upload. Send a few now and the rest after.`,
      );
    }
  }

  return (
    <>
      <input
        ref={ref}
        id={id}
        name={name}
        type="file"
        accept="image/*"
        multiple={multiple}
        required={required}
        onChange={onChange}
      />
      {busy && (
        <p className="fine" role="status">
          Getting your picture ready…
        </p>
      )}
      {problem && (
        <p className="notice" role="alert">
          {problem}
        </p>
      )}
    </>
  );
}

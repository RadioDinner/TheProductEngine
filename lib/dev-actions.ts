"use server";

import { redirect } from "next/navigation";
import { handleInbound } from "@/lib/engine";
import { runDueDigests } from "@/lib/digest-engine";
import { approveAd, rejectAd } from "@/lib/moderation";
import { normalizePhone } from "@/lib/phone";
import { smsDevEcho } from "@/lib/sms";

/** All simulator actions are dev-only; with a real SMS provider they vanish. */
function guard(): void {
  if (!smsDevEcho) redirect("/");
}

const SAMPLE_PHOTO = "/ads/1037.jpg";

export async function simSend(formData: FormData): Promise<void> {
  guard();
  const from = normalizePhone(String(formData.get("from") ?? ""));
  if (!from) redirect("/dev/sms");
  const text = String(formData.get("text") ?? "").trim();
  const withPhoto = formData.get("photo") === "on";
  await handleInbound({ from, text, ...(withPhoto && { media: [SAMPLE_PHOTO] }) });
  redirect(`/dev/sms?from=${from}`);
}

export async function simApprove(formData: FormData): Promise<void> {
  guard();
  const id = Number(formData.get("id"));
  if (Number.isInteger(id)) await approveAd(id);
  redirect(backTo(formData));
}

export async function simRejectBenign(formData: FormData): Promise<void> {
  guard();
  const id = Number(formData.get("id"));
  if (Number.isInteger(id)) {
    await rejectAd(id, "Please include a price and a way to reach you, then send it again.", "benign");
  }
  redirect(backTo(formData));
}

export async function simRejectViolation(formData: FormData): Promise<void> {
  guard();
  const id = Number(formData.get("id"));
  if (Number.isInteger(id)) {
    await rejectAd(id, "It offers an item we can't run.", "violation");
  }
  redirect(backTo(formData));
}

export async function simRunDigests(formData: FormData): Promise<void> {
  guard();
  const results = await runDueDigests();
  const ran = results
    .map((r) => `${r.slotKey.split("#")[1]}h:${r.skipped ? "empty" : `${r.items} ads to ${r.recipients}`}`)
    .join(", ");
  const from = normalizePhone(String(formData.get("from") ?? ""));
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  params.set("ran", ran || "nothing due");
  redirect(`/dev/sms?${params.toString()}`);
}

function backTo(formData: FormData): string {
  const from = normalizePhone(String(formData.get("from") ?? ""));
  return from ? `/dev/sms?from=${from}` : "/dev/sms";
}

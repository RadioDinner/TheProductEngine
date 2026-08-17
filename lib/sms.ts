/**
 * Outbound SMS transport. The dev implementation logs to the server console;
 * when Telnyx is provisioned, a TelnyxTransport replaces `sms` and the
 * on-screen dev echo disappears (it is keyed off the missing API key).
 */
export interface SmsTransport {
  send(to: string, body: string, media?: string[]): Promise<void>;
}

/** True while no real SMS provider is configured — enables on-screen code echo. */
export const smsDevEcho = !process.env.TELNYX_API_KEY;

const devTransport: SmsTransport = {
  async send(to, body, media) {
    console.log(`[sms:dev] to ${to}${media?.length ? ` +media(${media.length})` : ""}: ${body}`);
  },
};

/** A message create is a fast API call; a Telnyx stall must fail in bounded
 * time — senders run inside the 60 s cron/webhook budget, and one hung fetch
 * would otherwise eat it (mirrors FETCH_TIMEOUT_MS in lib/photos.ts). */
const SEND_TIMEOUT_MS = 10_000;

/** Real Telnyx sending — active once TELNYX_API_KEY + TELNYX_FROM_NUMBER exist. */
const telnyxTransport: SmsTransport = {
  async send(to, body, media) {
    const response = await fetch("https://api.telnyx.com/v2/messages", {
      method: "POST",
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      headers: {
        Authorization: `Bearer ${process.env.TELNYX_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.TELNYX_FROM_NUMBER,
        to: `+1${to}`,
        text: body,
        ...(media?.length && { media_urls: media, type: "MMS" }),
        ...(process.env.TELNYX_MESSAGING_PROFILE_ID && {
          messaging_profile_id: process.env.TELNYX_MESSAGING_PROFILE_ID,
        }),
      }),
    });
    if (!response.ok) {
      throw new Error(`Telnyx send failed (${response.status}): ${await response.text()}`);
    }
  },
};

export const sms: SmsTransport = smsDevEcho ? devTransport : telnyxTransport;

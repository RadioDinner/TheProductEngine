// Phone normalization — ownership + admin checks depend on any format of the
// same number normalizing to the identical 10 digits.
import { normalizePhone, formatPhone } from "../lib/phone.ts";

export const name = "phone";

export function run(t) {
  const canon = "3306001834";
  t.eq("bare 10", normalizePhone("3306001834"), canon);
  t.eq("parens + dashes", normalizePhone("(330) 600-1834"), canon);
  t.eq("dashes", normalizePhone("330-600-1834"), canon);
  t.eq("dots", normalizePhone("330.600.1834"), canon);
  t.eq("spaces", normalizePhone("330 600 1834"), canon);
  t.eq("+1 prefix", normalizePhone("+13306001834"), canon);
  t.eq("1- prefix", normalizePhone("1-330-600-1834"), canon);
  t.eq("+1 with formatting", normalizePhone("+1 (330) 600-1834"), canon);
  t.eq("leading/trailing space", normalizePhone("  3306001834  "), canon);
  t.eq("Telnyx E.164", normalizePhone("+13306001834"), canon);
  // Rejections.
  t.eq("too short", normalizePhone("330600"), null);
  t.eq("extension (13 digits) -> reject", normalizePhone("3306001834x123"), null);
  t.eq("11 digits not starting 1 -> reject", normalizePhone("23306001834"), null);
  t.eq("12 digits -> reject", normalizePhone("233060018340"), null);
  t.eq("letters only -> reject", normalizePhone("CALLME"), null);
  t.eq("empty -> reject", normalizePhone(""), null);
  t.eq("1-800-FLOWERS (only 1800) -> reject", normalizePhone("1-800-FLOWERS"), null);
  // Round-trip.
  t.eq("formatPhone", formatPhone("3306001834"), "(330) 600-1834");
  t.eq("normalize(format(x)) === x", normalizePhone(formatPhone(canon)), canon);
}

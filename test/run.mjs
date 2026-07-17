// Unit-test runner for the pure/near-pure correctness logic (cost math, command
// parsing, DST slot scheduling, phone normalization). No framework — run with:
//   npm test            (node --experimental-strip-types test/run.mjs)
// A test file exports `name` and `run(t)`, where t.eq(label, got, want) records
// a check. Exit code is non-zero if any check fails.
const SUITES = [
  "segments",
  "commands",
  "dst",
  "phone",
  "pic-quota",
  "image-sniff",
  "ads",
  "email-subject",
  "user-id",
  "email-photos",
  "unread",
  "post-ad",
  "chat",
  "myads",
  "reveal-quota",
  "business",
];

let totalPass = 0;
let totalFail = 0;

for (const suite of SUITES) {
  const mod = await import(`./${suite}.test.mjs`);
  const results = [];
  const t = {
    eq(label, got, want) {
      results.push({ ok: JSON.stringify(got) === JSON.stringify(want), label, got, want });
    },
  };
  mod.run(t);
  const pass = results.filter((r) => r.ok).length;
  const fail = results.length - pass;
  console.log(`${mod.name ?? suite}: ${pass}/${results.length}${fail ? "  ❌" : "  ✓"}`);
  for (const r of results) {
    if (!r.ok) console.log(`  FAIL — ${r.label}  got=${JSON.stringify(r.got)} want=${JSON.stringify(r.want)}`);
  }
  totalPass += pass;
  totalFail += fail;
}

console.log(`\n==== ${totalPass}/${totalPass + totalFail} checks passed ====`);
process.exitCode = totalFail ? 1 : 0;

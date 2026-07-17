/**
 * Fixture seed data — the demo sellers and ads. In fixtures mode this seeds
 * the mutable file store on first run (so texted-in ads persist beside them);
 * supabase/seed.sql is the SQL twin of this file.
 */

export interface FixtureAd {
  id: number;
  ownerPhone: string;
  body: string;
  status: "approved" | "sold" | "expired";
  daysAgo: number;
  slotHour: 7 | 12 | 16 | 20;
  photo?: { src: string; alt: string; width: number; height: number };
}

export const FIXTURE_ADS: FixtureAd[] = [
  { id: 1042, ownerPhone: "3305550190", body: "Sweet corn by the dozen or bushel. Ready now at the produce stand, CR 77 south of Berlin. Yoder family.", status: "approved", daysAgo: 0, slotHour: 12 },
  { id: 1041, ownerPhone: "3305550171", body: "Driving horse, $2,800. Standardbred gelding, 9 years, traffic safe and sound. Jonas S., 330-555-0171, Fredericksburg.", status: "approved", daysAgo: 0, slotHour: 7 },
  { id: 1040, ownerPhone: "3305550177", body: "Laying hens, $8 each. Two dozen Rhode Island Reds, laying steady. Katie H., 330-555-0177, New Bedford.", status: "approved", daysAgo: 0, slotHour: 7, photo: { src: "/ads/1040.jpg", alt: "Rhode Island Red laying hens", width: 960, height: 1075 } },
  { id: 1039, ownerPhone: "3305550163", body: "First cutting hay, $5.50 a bale. About 400 bales, stored dry in the barn. Mervin Y., 330-555-0163, Walnut Creek.", status: "approved", daysAgo: 1, slotHour: 20, photo: { src: "/ads/1039.jpg", alt: "Hay bales in a barn", width: 640, height: 480 } },
  { id: 1038, ownerPhone: "3305550166", body: "Puppies to good homes, $50. Australian shepherd cross, ready August 1. Verna M., 330-555-0166, Big Prairie.", status: "approved", daysAgo: 1, slotHour: 20 },
  { id: 1037, ownerPhone: "3305550142", body: "Horse cart for sale, $1,000 OBO. Good shape, new wheel bearings last spring. Leroy P., 330-555-0142, Mt. Hope.", status: "approved", daysAgo: 1, slotHour: 16, photo: { src: "/ads/1037.jpg", alt: "Two-wheeled horse cart", width: 960, height: 640 } },
  { id: 1036, ownerPhone: "3305550104", body: "Canning jars wanted. Quarts and pints, fair price paid. Emma W., 330-555-0104, Sugarcreek.", status: "approved", daysAgo: 1, slotHour: 12 },
  { id: 1035, ownerPhone: "3305550151", body: "Wood cook stove, $850. Pioneer Maid, used four winters, good baker. David M., 330-555-0151, Millersburg.", status: "approved", daysAgo: 1, slotHour: 7, photo: { src: "/ads/1035.jpg", alt: "Wood-fired cook stove", width: 960, height: 640 } },
  { id: 1034, ownerPhone: "3305550182", body: "Firewood, $70 a cord, split and delivered within 10 miles of Millersburg. Menno S., 330-555-0182.", status: "approved", daysAgo: 2, slotHour: 20 },
  { id: 1033, ownerPhone: "3305550129", body: "Treadle sewing machine, $225. Singer, oiled and sewing well, with attachments. Ada S., 330-555-0129, Charm.", status: "approved", daysAgo: 2, slotHour: 16, photo: { src: "/ads/1033.jpg", alt: "Singer treadle sewing machine", width: 960, height: 660 } },
  { id: 1032, ownerPhone: "3305550148", body: "Pallet forks for skid loader, $425. Heavy built, 48 inch. Aden R., 330-555-0148, Baltic.", status: "approved", daysAgo: 2, slotHour: 12 },
  { id: 1031, ownerPhone: "3305550124", body: "Shop heater, $200. Waste oil, works good, selling because we went to coal. Marcus Y., 330-555-0124, Millersburg.", status: "sold", daysAgo: 2, slotHour: 12 },
  { id: 1030, ownerPhone: "3305550138", body: "Boer cross goats, $150 each. Five wethers, ready end of July. Reuben T., 330-555-0138, Berlin.", status: "approved", daysAgo: 2, slotHour: 7, photo: { src: "/ads/1030.jpg", alt: "Boer cross goats in a pen", width: 960, height: 720 } },
  { id: 1029, ownerPhone: "3305550186", body: "Quilting frame, $120. Oak, full size, folds for storage. Mary K., 330-555-0186, Charm.", status: "approved", daysAgo: 3, slotHour: 20 },
  { id: 1028, ownerPhone: "3305550119", body: "Wheel Horse garden tiller, $340. Rebuilt engine this year, runs strong. Norman B., 330-555-0119, Walnut Creek.", status: "approved", daysAgo: 3, slotHour: 16 },
  { id: 1027, ownerPhone: "3305550157", body: "Maple syrup equipment, $600 for all. 2x6 evaporator pan, buckets, spiles. Andy M., 330-555-0157, Killbuck.", status: "approved", daysAgo: 3, slotHour: 12 },
  { id: 1026, ownerPhone: "3305550132", body: "Bulk food shelving, $75 a section. Six sections, sturdy pine. Lizzie T., 330-555-0132, Berlin.", status: "approved", daysAgo: 3, slotHour: 7 },
  { id: 1025, ownerPhone: "3305550195", body: "Farrowing crates, $90 each. Three available, good condition. Sam H., 330-555-0195, Baltic.", status: "approved", daysAgo: 4, slotHour: 20 },
  { id: 1024, ownerPhone: "3305550116", body: "Buggy harness, $375. Complete set, good leather, fits standard driver. Eli B., 330-555-0116, Mt. Hope.", status: "sold", daysAgo: 4, slotHour: 16 },
  { id: 1023, ownerPhone: "3305550109", body: "Post driver wanted, hydraulic, for 3-point hitch. Call or text Levi W., 330-555-0109, Apple Creek.", status: "approved", daysAgo: 4, slotHour: 7 },
  { id: 1022, ownerPhone: "3305550187", body: "Garden produce cart, $180. Sturdy built, needs paint. Alvin D., 330-555-0187, Winesburg.", status: "expired", daysAgo: 36, slotHour: 12 },
];

export function fixtureDate(daysAgo: number, slotHour: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(slotHour, 0, 0, 0);
  return d;
}

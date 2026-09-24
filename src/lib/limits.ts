// Guards for the public deployment, where anyone who opens the page spends Bedrock tokens.
// Checked before every turn in the web route; the terminal scripts don't go through them.
import type { Db } from "mongodb";

const PER_VISITOR_PER_HOUR = Number(process.env.RATE_PER_HOUR ?? 15);
const PER_IP_PER_HOUR = Number(process.env.RATE_PER_IP_HOUR ?? 40); // cookies are easy to clear
const DAILY_BUDGET_USD = Number(process.env.DAILY_BUDGET_USD ?? 1);
export const MAX_MESSAGE_CHARS = 1000;
export const MAX_CHAT_MESSAGES = 20;

/** Returns why this request is refused, or null. Records the request when it is allowed. */
export async function refuse(
  d: Db,
  userId: string,
  ip: string,
): Promise<string | null> {
  const hourAgo = new Date(Date.now() - 3_600_000);
  const midnight = new Date();
  midnight.setUTCHours(0, 0, 0, 0);
  const requests = d.collection("requests");
  const [byVisitor, byIp, spent] = await Promise.all([
    requests.countDocuments({ user_id: userId, ts: { $gte: hourAgo } }),
    requests.countDocuments({ ip, ts: { $gte: hourAgo } }),
    d
      .collection("llm_calls")
      .aggregate<{ usd: number }>([
        { $match: { ts: { $gte: midnight } } },
        { $group: { _id: null, usd: { $sum: "$cost_usd" } } },
      ])
      .next(),
  ]);
  if ((spent?.usd ?? 0) >= DAILY_BUDGET_USD) {
    return "The demo has used today's model budget. It resets at 00:00 UTC; the saved example chat still works.";
  }
  if (byVisitor >= PER_VISITOR_PER_HOUR || byIp >= PER_IP_PER_HOUR) {
    return `Limit of ${PER_VISITOR_PER_HOUR} messages an hour reached. Try again later.`;
  }
  await requests.insertOne({ user_id: userId, ip, ts: new Date() });
  return null;
}

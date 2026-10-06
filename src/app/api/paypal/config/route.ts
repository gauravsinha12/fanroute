import { paypalMode } from "@/lib/paypal/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The client ID is public by design (it loads the PayPal JS SDK); the secret
// never leaves the server.
export async function GET() {
  return Response.json({ mode: paypalMode(), clientId: paypalMode() === "demo" ? null : process.env.PAYPAL_CLIENT_ID });
}

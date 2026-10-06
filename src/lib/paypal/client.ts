// PayPal Orders v2 + Payments v2, sandbox by default. Pledges use intent
// AUTHORIZE: the fan's money is held, not taken, until the artist confirms the
// show in that city. Without credentials every call is simulated so the flow
// can be demoed end to end; the UI labels that mode.

const BASE = process.env.PAYPAL_API_BASE ?? "https://api-m.sandbox.paypal.com";

export function paypalMode(): "sandbox" | "live" | "demo" {
  if (!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_CLIENT_SECRET) return "demo";
  return BASE.includes("sandbox") ? "sandbox" : "live";
}

export class PayPalError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly debugId?: string,
  ) {
    super(message);
  }
}

let token: { value: string; expiresAt: number } | undefined;

async function accessToken(): Promise<string> {
  if (token && Date.now() < token.expiresAt - 60_000) return token.value;
  const basic = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString("base64");
  const res = await fetch(`${BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
    cache: "no-store",
  });
  if (!res.ok) throw new PayPalError(`PayPal auth failed (${res.status})`, res.status);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  token = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return token.value;
}

async function call<T>(path: string, body: unknown, idempotencyKey: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${await accessToken()}`,
      "Content-Type": "application/json",
      // Safe retries: PayPal returns the original result for a repeated key.
      "PayPal-Request-Id": idempotencyKey,
      Prefer: "return=representation",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as T & { message?: string; debug_id?: string };
  if (!res.ok) throw new PayPalError(data.message ?? `PayPal ${path} failed (${res.status})`, res.status, data.debug_id);
  return data;
}

const fakeId = (prefix: string) => `${prefix}-DEMO-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;

export async function createPledgeOrder(input: {
  amount: number;
  currency: string;
  customId: string;
  description: string;
  requestId: string;
}): Promise<{ id: string }> {
  if (paypalMode() === "demo") return { id: fakeId("ORDER") };
  return call<{ id: string }>(
    "/v2/checkout/orders",
    {
      intent: "AUTHORIZE",
      purchase_units: [
        {
          reference_id: input.customId,
          custom_id: input.customId,
          description: input.description.slice(0, 127),
          amount: { currency_code: input.currency, value: input.amount.toFixed(2) },
        },
      ],
    },
    input.requestId,
  );
}

interface AuthorizedOrder {
  id: string;
  status: string;
  payer?: { name?: { given_name?: string }; email_address?: string };
  purchase_units?: { custom_id?: string; payments?: { authorizations?: { id: string; status: string; expiration_time?: string }[] } }[];
}

export async function authorizeOrder(orderId: string): Promise<{ authorizationId: string; status: string; payerName?: string; expiresAt?: string }> {
  if (paypalMode() === "demo") return { authorizationId: fakeId("AUTH"), status: "CREATED", payerName: "Demo fan" };
  const order = await call<AuthorizedOrder>(`/v2/checkout/orders/${encodeURIComponent(orderId)}/authorize`, {}, `authorize-${orderId}`);
  const auth = order.purchase_units?.[0]?.payments?.authorizations?.[0];
  if (!auth) throw new PayPalError("PayPal returned no authorization", 502);
  return { authorizationId: auth.id, status: auth.status, payerName: order.payer?.name?.given_name, expiresAt: auth.expiration_time };
}

export async function captureAuthorization(authorizationId: string): Promise<{ id: string; status: string }> {
  if (paypalMode() === "demo") return { id: fakeId("CAPTURE"), status: "COMPLETED" };
  return call<{ id: string; status: string }>(
    `/v2/payments/authorizations/${encodeURIComponent(authorizationId)}/capture`,
    { final_capture: true },
    `capture-${authorizationId}`,
  );
}

export async function voidAuthorization(authorizationId: string): Promise<void> {
  if (paypalMode() === "demo") return;
  await call(`/v2/payments/authorizations/${encodeURIComponent(authorizationId)}/void`, undefined, `void-${authorizationId}`);
}

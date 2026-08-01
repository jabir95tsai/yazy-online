import { clearAccountCookie, revokeAccountSession } from "@/lib/auth";
import { apiError } from "@/lib/server";

export async function POST(request: Request) {
  try {
    await revokeAccountSession(request);
    return Response.json({ ok: true }, { headers: { "set-cookie": clearAccountCookie() } });
  } catch (error) {
    return apiError(error);
  }
}

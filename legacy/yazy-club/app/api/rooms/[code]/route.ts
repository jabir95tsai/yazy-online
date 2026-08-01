import { getRoomState, apiError, cleanCode } from "@/lib/server";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  try {
    const code = cleanCode((await params).code);
    const state = await getRoomState(code);
    if (!state) {
      return Response.json({ error: "找不到這個房間。" }, { status: 404 });
    }
    return Response.json(state);
  } catch (error) {
    return apiError(error);
  }
}

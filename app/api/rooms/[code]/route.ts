import { getRoomState, apiError, cleanCode } from "@/lib/server";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  try {
    const code = cleanCode((await params).code);
    const result = await getRoomState(
      code,
      request.headers.get("if-none-match"),
    );
    if (result.notModified && result.etag) {
      return new Response(null, {
        status: 304,
        headers: {
          "cache-control": "private, no-cache",
          etag: result.etag,
        },
      });
    }
    if (!result.state) {
      return Response.json({ error: "找不到這個房間。" }, { status: 404 });
    }
    return Response.json(result.state, {
      headers: {
        "cache-control": "private, no-cache",
        etag: result.etag ?? "",
      },
    });
  } catch (error) {
    return apiError(error);
  }
}

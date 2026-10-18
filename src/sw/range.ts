// A cached file answered as a media element asks for it: whole, or the byte
// range in its Range header. Safari plays audio only from ranged responses.
export async function ranged(
  cached: Response,
  range: string | null,
): Promise<Response> {
  if (!range) return cached;
  const body = await cached.blob();
  const size = body.size;
  const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  let start = NaN;
  let end = NaN;
  if (m && m[1] !== "") {
    start = Number(m[1]);
    end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  } else if (m && m[2] !== "") {
    // A suffix: the last n bytes.
    start = Math.max(0, size - Number(m[2]));
    end = size - 1;
  }
  if (!(start <= end)) {
    return new Response(null, {
      status: 416,
      headers: { "Content-Range": `bytes */${size}` },
    });
  }
  const headers = new Headers(cached.headers);
  headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
  headers.set("Content-Length", String(end - start + 1));
  return new Response(body.slice(start, end + 1), {
    status: 206,
    statusText: "Partial Content",
    headers,
  });
}

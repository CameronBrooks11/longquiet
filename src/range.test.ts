import { describe, expect, it } from "vitest";
import { ranged } from "./sw/range";

const bytes = new Uint8Array(1000).map((_, i) => i % 256);
const cached = () =>
  new Response(bytes, { headers: { "Content-Type": "audio/mpeg" } });

async function body(r: Response) {
  return new Uint8Array(await r.arrayBuffer());
}

describe("ranged", () => {
  it("answers no Range header with the whole file", async () => {
    const r = await ranged(cached(), null);
    expect(r.status).toBe(200);
    expect(await body(r)).toEqual(bytes);
  });

  it("answers an open range from its start to the end", async () => {
    const r = await ranged(cached(), "bytes=0-");
    expect(r.status).toBe(206);
    expect(r.headers.get("Content-Range")).toBe("bytes 0-999/1000");
    expect(r.headers.get("Content-Length")).toBe("1000");
    expect(r.headers.get("Content-Type")).toBe("audio/mpeg");
    expect(await body(r)).toEqual(bytes);
  });

  it("answers a closed range with exactly those bytes", async () => {
    const r = await ranged(cached(), "bytes=100-199");
    expect(r.status).toBe(206);
    expect(r.headers.get("Content-Range")).toBe("bytes 100-199/1000");
    expect(await body(r)).toEqual(bytes.slice(100, 200));
  });

  it("clips a range running past the end", async () => {
    const r = await ranged(cached(), "bytes=900-5000");
    expect(r.headers.get("Content-Range")).toBe("bytes 900-999/1000");
    expect(await body(r)).toEqual(bytes.slice(900));
  });

  it("answers a suffix range with the last bytes", async () => {
    const r = await ranged(cached(), "bytes=-10");
    expect(r.headers.get("Content-Range")).toBe("bytes 990-999/1000");
    expect(await body(r)).toEqual(bytes.slice(990));
  });

  it.each(["bytes=1000-", "bytes=500-100", "items=0-1", "bytes=-"])(
    "refuses %s with 416",
    async (range) => {
      const r = await ranged(cached(), range);
      expect(r.status).toBe(416);
      expect(r.headers.get("Content-Range")).toBe("bytes */1000");
    },
  );
});

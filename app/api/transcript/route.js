import { fetchTranscript } from "./youtube-transcript.js";

/**
 * Next.js API Route — fetches YouTube transcript SERVER-SIDE
 * using a custom implementation with consent-cookie bypass.
 *
 * This works on Vercel/cloud platforms where npm libraries fail
 * because YouTube blocks data-center IPs with consent pages.
 */
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const videoId = searchParams.get("v");

  if (!videoId) {
    return Response.json(
      { error: "Missing video ID. Pass ?v=VIDEO_ID" },
      { status: 400 }
    );
  }

  try {
    const data = await fetchTranscript(videoId);
    return Response.json(data);
  } catch (err) {
    return Response.json(
      {
        error: err.message || "Failed to fetch transcript",
        hint: "The video may not have captions, or the video ID is invalid.",
      },
      { status: 500 }
    );
  }
}

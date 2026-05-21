import { YoutubeTranscript } from "youtube-transcript";

/**
 * Next.js API Route — fetches YouTube transcript SERVER-SIDE
 * using the youtube-transcript library (JS version of Python's youtube-transcript-api).
 *
 * ★ WHY THIS SOLVES THE BAN PROBLEM ★
 *   - This code runs on whatever server hosts your Next.js app
 *   - When deployed to Vercel (free), requests come from VERCEL's IPs
 *   - Your own banned server IP is never used
 *   - No API key needed!
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
    const transcript = await YoutubeTranscript.fetchTranscript(videoId);

    // Combine all transcript lines into one full text
    const fullText = transcript.map((line) => line.text).join(" ");

    // Try to get video title from YouTube oEmbed (lightweight, no API key)
    let title = "";
    let channelTitle = "";
    try {
      const oembedRes = await fetch(
        `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`
      );
      if (oembedRes.ok) {
        const oembed = await oembedRes.json();
        title = oembed.title || "";
        channelTitle = oembed.author_name || "";
      }
    } catch {
      // oEmbed is optional, ignore errors
    }

    return Response.json({
      videoId,
      title,
      channelTitle,
      lines: transcript,
      fullText,
      lineCount: transcript.length,
    });
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

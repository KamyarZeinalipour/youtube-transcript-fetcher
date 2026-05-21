/**
 * Custom YouTube transcript fetcher using the InnerTube API.
 *
 * The InnerTube API is YouTube's internal API used by mobile apps.
 * It works from data-center IPs (Vercel, AWS, etc.) because it
 * doesn't have the same bot-detection as the web pages.
 *
 * This is the same approach the youtube-transcript npm library uses,
 * but we implement it directly to have full control.
 */

const INNERTUBE_API_URL =
  "https://www.youtube.com/youtubei/v1/player?prettyPrint=false";

// Multiple InnerTube clients to try — different clients may work
// from different IPs, so we try them all
const INNERTUBE_CLIENTS = [
  {
    name: "IOS",
    context: { client: { clientName: "IOS", clientVersion: "20.10.4" } },
    userAgent:
      "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_2_1 like Mac OS X)",
  },
  {
    name: "ANDROID",
    context: { client: { clientName: "ANDROID", clientVersion: "20.10.38" } },
    userAgent:
      "com.google.android.youtube/20.10.38 (Linux; U; Android 14)",
  },
  {
    name: "WEB",
    context: { client: { clientName: "WEB", clientVersion: "2.20250101.00.00" } },
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/85.0.4183.83 Safari/537.36",
  },
];
/**
 * Decode common HTML entities in transcript text
 */
function decodeEntities(text) {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) =>
      String.fromCodePoint(parseInt(hex, 16))
    )
    .replace(/&#(\d+);/g, (_, dec) =>
      String.fromCodePoint(parseInt(dec, 10))
    );
}

/**
 * Parse transcript XML — supports both srv3 format and classic format
 */
function parseTranscriptXml(xml, lang) {
  const results = [];

  // Try srv3 format first: <p t="ms" d="ms"><s>word</s>...</p>
  const pRegex = /<p\s+t="(\d+)"\s+d="(\d+)"[^>]*>([\s\S]*?)<\/p>/g;
  let match;
  while ((match = pRegex.exec(xml)) !== null) {
    const startMs = parseInt(match[1], 10);
    const durMs = parseInt(match[2], 10);
    const inner = match[3];

    let text = "";
    const sRegex = /<s[^>]*>([^<]*)<\/s>/g;
    let sMatch;
    while ((sMatch = sRegex.exec(inner)) !== null) {
      text += sMatch[1];
    }
    if (!text) {
      text = inner.replace(/<[^>]+>/g, "");
    }
    text = decodeEntities(text).trim();
    if (text) {
      results.push({ text, duration: durMs, offset: startMs, lang });
    }
  }

  if (results.length > 0) return results;

  // Fall back to classic format: <text start="s" dur="s">content</text>
  const classicRegex = /<text start="([^"]*)" dur="([^"]*)"[^>]*>([\s\S]*?)<\/text>/g;
  while ((match = classicRegex.exec(xml)) !== null) {
    const text = decodeEntities(match[3].replace(/<[^>]+>/g, "")).trim();
    if (text) {
      results.push({
        text,
        offset: Math.round(parseFloat(match[1]) * 1000),
        duration: Math.round(parseFloat(match[2]) * 1000),
        lang,
      });
    }
  }

  return results;
}

/**
 * Fetch transcript using InnerTube API — tries multiple clients
 */
async function fetchViaInnerTube(videoId) {
  for (const client of INNERTUBE_CLIENTS) {
    try {
      const resp = await fetch(INNERTUBE_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": client.userAgent,
        },
        body: JSON.stringify({
          context: client.context,
          videoId,
        }),
      });

      if (!resp.ok) continue;

      const data = await resp.json();
      const captionTracks =
        data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;

      if (!Array.isArray(captionTracks) || captionTracks.length === 0) continue;

      // Pick the best track (prefer English)
      const track =
        captionTracks.find((t) => t.languageCode === "en") ||
        captionTracks.find((t) => t.languageCode?.startsWith("en")) ||
        captionTracks[0];

      // Verify the XML URL actually returns content
      const xmlResp = await fetch(track.baseUrl, {
        headers: { "User-Agent": client.userAgent },
      });
      if (!xmlResp.ok) continue;

      const xml = await xmlResp.text();
      if (!xml || xml.length < 10) continue; // Empty XML, try next client

      const videoDetails = data?.videoDetails || {};
      return { track, xml, videoDetails, client: client.name };
    } catch {
      continue;
    }
  }

  return null;
}

/**
 * Fetch transcript by scraping the web page (fallback)
 */
async function fetchViaWebPage(videoId) {
  const resp = await fetch(
    `https://www.youtube.com/watch?v=${videoId}`,
    {
      headers: {
        "User-Agent": INNERTUBE_CLIENTS[2].userAgent,
        "Accept-Language": "en-US,en;q=0.9",
        Cookie: "CONSENT=PENDING+999",
      },
    }
  );

  if (!resp.ok) return null;

  const html = await resp.text();

  if (html.includes('class="g-recaptcha"')) {
    throw new Error("YouTube is requesting a captcha. Too many requests.");
  }

  // Parse ytInitialPlayerResponse using balanced braces (more robust)
  const startToken = "var ytInitialPlayerResponse = ";
  const startIdx = html.indexOf(startToken);
  if (startIdx === -1) return null;

  const jsonStart = startIdx + startToken.length;
  let depth = 0;
  for (let i = jsonStart; i < html.length; i++) {
    if (html[i] === "{") depth++;
    else if (html[i] === "}") {
      depth--;
      if (depth === 0) {
        try {
          const data = JSON.parse(html.slice(jsonStart, i + 1));
          const captionTracks =
            data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
          if (!Array.isArray(captionTracks) || captionTracks.length === 0) {
            return null;
          }
          return { captionTracks, videoDetails: data.videoDetails || {} };
        } catch {
          return null;
        }
      }
    }
  }

  return null;
}

/**
 * Main export: fetch transcript for a video
 */
export async function fetchTranscript(videoId) {
  // Try InnerTube API first (tries IOS, ANDROID, WEB clients)
  const innerTubeResult = await fetchViaInnerTube(videoId);

  if (innerTubeResult) {
    const { track, xml, videoDetails } = innerTubeResult;
    const lang = track.languageCode || "en";
    const lines = parseTranscriptXml(xml, lang);

    if (lines.length > 0) {
      return {
        lines,
        fullText: lines.map((l) => l.text).join(" "),
        lineCount: lines.length,
        language: track.name?.simpleText || track.languageCode,
        title: videoDetails.title || "",
        channelTitle: videoDetails.author || "",
      };
    }
  }

  // Fall back to web scraping
  const webResult = await fetchViaWebPage(videoId);

  if (!webResult) {
    throw new Error(
      "Could not find captions for this video. It may not have subtitles, or the video is unavailable."
    );
  }

  const { captionTracks, videoDetails } = webResult;

  const track =
    captionTracks.find((t) => t.languageCode === "en") ||
    captionTracks.find((t) => t.languageCode?.startsWith("en")) ||
    captionTracks[0];

  const xmlResp = await fetch(track.baseUrl, {
    headers: {
      "User-Agent": INNERTUBE_CLIENTS[0].userAgent,
      Cookie: "CONSENT=PENDING+999",
    },
  });

  if (!xmlResp.ok) {
    throw new Error(`Failed to fetch caption data: HTTP ${xmlResp.status}`);
  }

  const xml = await xmlResp.text();
  const lang = track.languageCode || "en";
  const lines = parseTranscriptXml(xml, lang);

  if (lines.length === 0) {
    throw new Error(
      "Captions were found but returned empty content. Try a different video."
    );
  }

  return {
    lines,
    fullText: lines.map((l) => l.text).join(" "),
    lineCount: lines.length,
    language: track.name?.simpleText || track.languageCode,
    title: videoDetails.title || "",
    channelTitle: videoDetails.author || "",
  };
}


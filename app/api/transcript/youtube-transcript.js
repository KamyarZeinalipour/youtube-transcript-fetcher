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

const INNERTUBE_CLIENT_VERSION = "20.10.38";

const INNERTUBE_CONTEXT = {
  client: {
    clientName: "ANDROID",
    clientVersion: INNERTUBE_CLIENT_VERSION,
  },
};

const INNERTUBE_USER_AGENT = `com.google.android.youtube/${INNERTUBE_CLIENT_VERSION} (Linux; U; Android 14)`;

const WEB_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/85.0.4183.83 Safari/537.36";

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
 * Fetch transcript using InnerTube API (primary method)
 */
async function fetchViaInnerTube(videoId) {
  const resp = await fetch(INNERTUBE_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": INNERTUBE_USER_AGENT,
    },
    body: JSON.stringify({
      context: INNERTUBE_CONTEXT,
      videoId,
    }),
  });

  if (!resp.ok) return null;

  const data = await resp.json();
  const captionTracks =
    data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;

  if (!Array.isArray(captionTracks) || captionTracks.length === 0) {
    return null;
  }

  // Also grab video details
  const videoDetails = data?.videoDetails || {};

  return { captionTracks, videoDetails };
}

/**
 * Fetch transcript by scraping the web page (fallback)
 */
async function fetchViaWebPage(videoId) {
  const resp = await fetch(
    `https://www.youtube.com/watch?v=${videoId}`,
    {
      headers: {
        "User-Agent": WEB_USER_AGENT,
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
  // Try InnerTube API first (works on cloud/data-center IPs)
  let result = await fetchViaInnerTube(videoId);

  // Fall back to web scraping
  if (!result) {
    result = await fetchViaWebPage(videoId);
  }

  if (!result) {
    throw new Error(
      "Could not find captions for this video. It may not have subtitles, or the video is unavailable."
    );
  }

  const { captionTracks, videoDetails } = result;

  // Pick the best track (prefer English)
  const track =
    captionTracks.find((t) => t.languageCode === "en") ||
    captionTracks.find((t) => t.languageCode?.startsWith("en")) ||
    captionTracks[0];

  // Fetch the caption XML/data
  const captionUrl = new URL(track.baseUrl);
  if (!captionUrl.hostname.endsWith(".youtube.com")) {
    throw new Error("Invalid caption URL");
  }

  const xmlResp = await fetch(track.baseUrl, {
    headers: { "User-Agent": WEB_USER_AGENT },
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

"use client";

import { useState, useCallback } from "react";

// ─── YouTube URL parser ─────────────────────────────────────────────
function extractVideoId(url) {
  if (!url) return null;
  const patterns = [
    /(?:youtube\.com\/watch\?.*v=)([a-zA-Z0-9_-]{11})/,
    /(?:youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/v\/)([a-zA-Z0-9_-]{11})/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  if (/^[a-zA-Z0-9_-]{11}$/.test(url.trim())) return url.trim();
  return null;
}

// ─── Format timestamp ───────────────────────────────────────────────
function formatTime(ms) {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, "0")}`;
}

// ─── Component ──────────────────────────────────────────────────────
export default function Home() {
  const [url, setUrl] = useState("");
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [viewMode, setViewMode] = useState("full");

  const handleFetch = useCallback(async () => {
    setError("");
    setResult(null);
    setCopied(false);

    const videoId = extractVideoId(url);
    if (!videoId) {
      setError(
        "Could not extract a video ID. Paste a valid YouTube URL like:\nhttps://www.youtube.com/watch?v=dQw4w9WgXcQ"
      );
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`/api/transcript?v=${videoId}`);
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error + (data.hint ? `\n${data.hint}` : ""));
      }

      setResult({
        videoId,
        title: data.title,
        channelTitle: data.channelTitle,
        fullText: data.fullText,
        lines: data.lines,
        lineCount: data.lineCount,
        thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [url]);

  const handleCopy = useCallback(() => {
    if (!result) return;
    const text =
      viewMode === "full"
        ? result.fullText
        : result.lines
            .map((l) => `[${formatTime(l.offset)}] ${l.text}`)
            .join("\n");
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [result, viewMode]);

  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === "Enter" && !loading) handleFetch();
    },
    [handleFetch, loading]
  );

  return (
    <>
      <div className="bg-orb bg-orb--purple" />
      <div className="bg-orb bg-orb--pink" />
      <div className="bg-orb bg-orb--blue" />

      <main className="main">
        <header className="header">
          <div className="header__icon">🎬</div>
          <h1 className="header__title">YouTube Transcript Fetcher</h1>
          <p className="header__subtitle">
            Paste a video URL → get the full transcript — no API key needed
            <br />
            <span className="header__badge">
              🟢 Deploy to Vercel (free) → uses Vercel&apos;s IPs, not your server
            </span>
          </p>
        </header>

        <div className="card">
          <label className="label" htmlFor="videoUrlInput">
            YouTube Video URL
          </label>
          <div className="input-wrapper">
            <input
              id="videoUrlInput"
              className="input"
              type="text"
              placeholder="https://www.youtube.com/watch?v=..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={handleKeyDown}
              autoFocus
            />
          </div>

          <button
            id="fetchBtn"
            className="btn"
            onClick={handleFetch}
            disabled={loading}
          >
            {loading ? (
              <>
                <span className="spinner" /> Fetching transcript…
              </>
            ) : (
              "Get Transcript"
            )}
          </button>

          {error && <div className="error">{error}</div>}

          {result && (
            <div className="result">
              <div className="result__header">
                <img
                  className="result__thumbnail"
                  src={result.thumbnail}
                  alt={result.title}
                />
                <div>
                  <div className="result__title">{result.title}</div>
                  <div className="result__channel">{result.channelTitle}</div>
                  <div className="result__meta">
                    {result.lineCount} lines of transcript
                  </div>
                </div>
              </div>

              <div className="toggle-row">
                <button
                  className={`toggle-btn ${viewMode === "full" ? "toggle-btn--active" : ""}`}
                  onClick={() => setViewMode("full")}
                >
                  Full Text
                </button>
                <button
                  className={`toggle-btn ${viewMode === "timestamped" ? "toggle-btn--active" : ""}`}
                  onClick={() => setViewMode("timestamped")}
                >
                  With Timestamps
                </button>
              </div>

              <div className="result__description">
                {viewMode === "full"
                  ? result.fullText
                  : result.lines.map((line, i) => (
                      <div key={i} className="transcript-line">
                        <span className="transcript-time">
                          {formatTime(line.offset)}
                        </span>
                        <span>{line.text}</span>
                      </div>
                    ))}
              </div>

              <button className="copy-btn" onClick={handleCopy}>
                {copied ? "✓ Copied!" : "📋 Copy Transcript"}
              </button>
            </div>
          )}

          <p className="info-note">
            ✨ Uses <strong>youtube-transcript</strong> (JS version of
            Python&apos;s youtube-transcript-api). No API key needed.
            <br />
            Deploy to{" "}
            <a
              href="https://vercel.com"
              target="_blank"
              rel="noopener noreferrer"
            >
              Vercel
            </a>{" "}
            (free) so YouTube requests come from Vercel&apos;s IPs — your banned
            server is never used.
          </p>
        </div>
      </main>
    </>
  );
}

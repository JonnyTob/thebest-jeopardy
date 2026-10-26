/**
 * Converts a YouTube watch/short URL into an embeddable, autoplaying URL.
 * Falls back to returning the original URL if no video id can be parsed.
 */
export function getYouTubeEmbedUrl(url: string): string {
  const match = url.match(/(?:v=|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return match ? `https://www.youtube.com/embed/${match[1]}?autoplay=1` : url;
}

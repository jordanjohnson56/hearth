// The configured zone reaches the browser inside index.html, so the header
// clock shows the household's time on a device set to another zone, with no
// extra request and no endpoint. The client reads it back from
// <meta name="hearth-zone"> (src/client/zone.ts; keep the name in sync).

const ZONE_META_NAME = 'hearth-zone';

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Escapes text for an HTML attribute value or text node. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);
}

/**
 * Returns `html` with a `<meta name="hearth-zone">` tag carrying `zone`,
 * placed just before `</head>` (or first, if the document has no head).
 * The zone is escaped here even though the config loader only accepts IANA
 * names: this function must stay safe for whatever string it is given.
 */
export function injectZone(html: string, zone: string): string {
  const meta = `<meta name="${ZONE_META_NAME}" content="${escapeHtml(zone)}">`;
  const headEnd = html.search(/<\/head>/i);
  if (headEnd === -1) return meta + html;
  return html.slice(0, headEnd) + meta + html.slice(headEnd);
}

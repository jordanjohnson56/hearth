// Wire format of a live-update change hint: the `data:` payload of an SSE
// message on GET /api/events. A hint names the feature that changed and
// nothing else; clients refetch that feature's data from /api/<id>.

/** The JSON text of a hint for `feature`: `{"feature":"<id>"}`. */
export function encodeChangeHint(feature: string): string {
  return JSON.stringify({ feature });
}

/**
 * The feature a hint names, or null when the text is not a hint for one of
 * `ids` (malformed, unknown feature, wrong shape). Never throws.
 */
export function decodeChangeHint<Id extends string>(
  data: string,
  ids: readonly Id[],
): Id | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || !('feature' in parsed)) {
    return null;
  }
  const { feature } = parsed;
  return ids.find((id) => id === feature) ?? null;
}

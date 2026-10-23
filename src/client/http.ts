// Wire-trust policy of the client, in one place: the server is Hearth's
// own, and the wire types (src/features/calendar/types.ts, the admin and
// settings bodies) are the contract, so a JSON body is taken as its
// declared type with no runtime validation. The one exception is the theme
// times (src/client/theme.ts), checked before use because a malformed pair
// would throw on every minute tick.

/** The JSON body of `res` as `T`, trusted as above. */
export async function readJson<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

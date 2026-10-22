/**
 * Response bodies in tests are checked with expect(), not trusted, so `any` is the honest type:
 * a wrong shape fails the assertion, which is the point.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Json = any;

export const body = async (res: Response): Promise<Json> => res.json();

import { NextResponse, type NextRequest } from 'next/server';

/** /agent/<token> is both a human page and an agent endpoint (agent-links
 *  design): JSON accepts are rewritten to the manifest route so a plain
 *  `fetch(url)` works with no docs. Browsers send text/html and stay on the
 *  page. The exact-path check lives here, not in the matcher — Next 14
 *  compiles a bare `/agent/:token` matcher into a regexp that drops the
 *  param (only `/agent` and data-route `.json` forms matched). */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const accept = req.headers.get('accept') ?? '';
  if (
    /^\/agent\/[^/]+$/.test(pathname) &&
    accept.includes('application/json') &&
    !accept.includes('text/html')
  ) {
    return NextResponse.rewrite(new URL(`${pathname}/api`, req.url));
  }
  return NextResponse.next();
}

export const config = { matcher: '/agent/:path*' };

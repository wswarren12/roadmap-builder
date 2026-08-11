import { NextResponse, type NextRequest } from 'next/server';

/** /agent/<token> is both a human page and an agent endpoint (agent-links
 *  design): JSON accepts are rewritten to the manifest route so a plain
 *  `fetch(url)` works with no docs. Browsers send text/html and stay on the
 *  page. */
export function middleware(req: NextRequest) {
  const accept = req.headers.get('accept') ?? '';
  if (accept.includes('application/json') && !accept.includes('text/html')) {
    return NextResponse.rewrite(new URL(`${req.nextUrl.pathname}/api`, req.url));
  }
  return NextResponse.next();
}

export const config = { matcher: '/agent/:token' };

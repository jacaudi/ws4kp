// Package web embeds the browser app the binary serves: dist/, the output of
// `npm --prefix web run build`, and server/scripts/, served at /scripts/. Both always hold
// tracked files (dist/readme.txt, server/scripts/ws.mjs), so the patterns match before a
// build too; a binary built that way refuses to start for want of dist/index.html.
package web

import "embed"

// Files holds dist/ and server/scripts/, with paths relative to web/.
//
//go:embed dist server/scripts
var Files embed.FS

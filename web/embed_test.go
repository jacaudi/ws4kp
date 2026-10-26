package web

import (
	"io/fs"
	"testing"
)

func TestEmbedsBothTrees(t *testing.T) {
	for _, name := range []string{"dist/readme.txt", "server/scripts/ws.mjs", "server/scripts/modules/navigation.mjs"} {
		if _, err := fs.Stat(Files, name); err != nil {
			t.Errorf("%s is not embedded: %v", name, err)
		}
	}
	for _, name := range []string{"server/music", "views", "node_modules"} {
		if _, err := fs.Stat(Files, name); err == nil {
			t.Errorf("%s is embedded; only dist/ and server/scripts/ should be", name)
		}
	}
}

//go:build integration

package playlist

import (
	"bytes"
	"encoding/json/v2"
	"log/slog"
	"math"
	"os"
	"path/filepath"
	"slices"
	"testing"
)

// TestBundledTracksMatchNode compares the 23 bundled tracks against the playlist the Node
// server produced at 5db6464 (testdata/playlist-node.json): the same files, the same
// title/artist/album, and durations within one second. It needs the real Git LFS content:
//
//	git lfs pull && go test -tags integration -run TestBundledTracksMatchNode -v ./internal/playlist
func TestBundledTracksMatchNode(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("testdata", "playlist-node.json"))
	if err != nil {
		t.Fatal(err)
	}
	var want Playlist
	if err := json.Unmarshal(raw, &want); err != nil {
		t.Fatal(err)
	}
	dir := filepath.Join("..", "..", "web", "server", "music", "default")
	var unusable []string
	for _, name := range want.AvailableFiles {
		data, err := os.ReadFile(filepath.Join(dir, filepath.Base(name)))
		if err != nil || bytes.HasPrefix(data, []byte("version https://git-lfs")) {
			unusable = append(unusable, name)
		}
	}
	if len(unusable) > 0 {
		t.Fatalf("Git LFS pointers or unreadable files (run git lfs pull): %v", unusable)
	}

	got := Load(t.Context(), slog.New(slog.DiscardHandler), Source{FS: os.DirFS(dir), Dir: ".", Prefix: "default/"})
	if !slices.Equal(got.AvailableFiles, want.AvailableFiles) {
		t.Fatalf("AvailableFiles differ:\n got %v\nwant %v", got.AvailableFiles, want.AvailableFiles)
	}
	for _, file := range want.AvailableFiles {
		g, w := got.MetaData[file], want.MetaData[file]
		t.Logf("%-58s node %3ds  go %3ds  %q / %q / %q", file, w.Duration, g.Duration, g.Title, g.Artist, g.Album)
		if g.Title != w.Title || g.Artist != w.Artist || g.Album != w.Album {
			t.Errorf("%s tags = %q/%q/%q, want %q/%q/%q", file, g.Title, g.Artist, g.Album, w.Title, w.Artist, w.Album)
		}
		if math.Abs(float64(g.Duration-w.Duration)) > 1 {
			t.Errorf("%s duration = %ds, want %ds ± 1", file, g.Duration, w.Duration)
		}
	}
}

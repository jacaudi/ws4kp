package playlist

import (
	"bytes"
	"encoding/binary"
	"encoding/json/v2"
	"log/slog"
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"strings"
	"testing"
	"testing/fstest"
	"unicode/utf8"
)

// frames returns n MPEG-1 Layer III frames (32 kbit/s, 44.1 kHz, mono, no CRC): 104 bytes
// and 1152 samples (26.12 ms) each, with silent payloads.
func frames(n int) []byte {
	frame := make([]byte, 104)
	copy(frame, []byte{0xFF, 0xFB, 0x10, 0xC0})
	return bytes.Repeat(frame, n)
}

// id3 returns an ID3v2 tag (version 3 or 4) holding text frames given as id, value pairs.
// v2.3 frames are ISO-8859-1 with plain sizes; v2.4 frames are UTF-8 with syncsafe sizes.
func id3(version byte, pairs ...string) []byte {
	var body bytes.Buffer
	for i := 0; i+1 < len(pairs); i += 2 {
		enc := byte(0)
		if version == 4 {
			enc = 3
		}
		data := append([]byte{enc}, pairs[i+1]...)
		body.WriteString(pairs[i])
		if version == 4 {
			body.Write(syncsafe(len(data)))
		} else {
			body.Write(binary.BigEndian.AppendUint32(nil, uint32(len(data))))
		}
		body.Write([]byte{0, 0})
		body.Write(data)
	}
	header := append([]byte{'I', 'D', '3', version, 0, 0}, syncsafe(body.Len())...)
	return append(header, body.Bytes()...)
}

func syncsafe(n int) []byte {
	return []byte{byte(n >> 21 & 0x7f), byte(n >> 14 & 0x7f), byte(n >> 7 & 0x7f), byte(n & 0x7f)}
}

func writeFile(t *testing.T, dir, name string, data []byte) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(filepath.Join(dir, name)), 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, name), data, 0o600); err != nil {
		t.Fatal(err)
	}
}

func load(t *testing.T, sources ...Source) Playlist {
	t.Helper()
	return Load(t.Context(), slog.New(slog.DiscardHandler), sources...)
}

func TestLoadReadsTagsAndDuration(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, dir, "b.mp3", append(id3(4, "TIT2", "Café ☀", "TPE1", "Artist B", "TALB", "Album B"), frames(38)...))
	writeFile(t, dir, "a.mp3", append(id3(3, "TIT2", "Title A", "TPE1", "Artist A", "TALB", "Album A"), frames(115)...))
	writeFile(t, dir, "notes.txt", []byte("not music"))
	writeFile(t, dir, "LOUD.MP3", frames(10)) // the match is case-sensitive, as /\.mp3$/ was

	got := load(t, Source{FS: os.DirFS(dir), Dir: "."})
	if want := []string{"a.mp3", "b.mp3"}; !slices.Equal(got.AvailableFiles, want) {
		t.Errorf("AvailableFiles = %v, want %v", got.AvailableFiles, want)
	}
	want := map[string]Track{
		"a.mp3": {Title: "Title A", Artist: "Artist A", Album: "Album A", Duration: 3}, // 115 frames = 3.004 s
		"b.mp3": {Title: "Café ☀", Artist: "Artist B", Album: "Album B", Duration: 1},  // 38 frames = 0.993 s
	}
	for file, track := range want {
		if got.MetaData[file] != track {
			t.Errorf("MetaData[%q] = %+v, want %+v", file, got.MetaData[file], track)
		}
	}
}

func TestAbsentTagsAreOmitted(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, dir, "plain.mp3", frames(115))
	got := load(t, Source{FS: os.DirFS(dir), Dir: "."})
	body, err := json.Marshal(got.MetaData["plain.mp3"])
	if err != nil {
		t.Fatal(err)
	}
	if string(body) != `{"duration":3}` {
		t.Errorf("untagged track = %s, want {\"duration\":3}", body)
	}
}

func TestUnreadableFileIsListedWithoutMetaData(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, dir, "broken.mp3", []byte("this is not an mp3 file at all"))
	writeFile(t, dir, "ok.mp3", frames(38))
	got := load(t, Source{FS: os.DirFS(dir), Dir: "."})
	if !slices.Equal(got.AvailableFiles, []string{"broken.mp3", "ok.mp3"}) {
		t.Errorf("AvailableFiles = %v", got.AvailableFiles)
	}
	if _, ok := got.MetaData["broken.mp3"]; ok {
		t.Error("broken.mp3 has a MetaData entry")
	}
	if _, ok := got.MetaData["ok.mp3"]; !ok {
		t.Error("ok.mp3 has no MetaData entry")
	}
}

// The server's chain (Task 7): the music dir, its default/ subfolder, then the binary's
// music/ folder (tracks that were in web/server/music at build time), then its default/.
func TestFallbackChain(t *testing.T) {
	bundled := fstest.MapFS{"music/default/bundled.mp3": {Data: frames(38)}}
	builtOwn := fstest.MapFS{"music/built-in.mp3": {Data: frames(38)}, "music/default/bundled.mp3": {Data: frames(38)}}
	chain := func(dir string, embedded fstest.MapFS) []Source {
		return []Source{
			{FS: os.DirFS(dir), Dir: "."},
			{FS: os.DirFS(dir), Dir: "default", Prefix: "default/"},
			{FS: embedded, Dir: "music"},
			{FS: embedded, Dir: "music/default", Prefix: "default/"},
		}
	}
	tests := []struct {
		name     string
		files    []string
		embedded fstest.MapFS
		want     []string
	}{
		{"own tracks win", []string{"mine.mp3", "default/disk.mp3"}, builtOwn, []string{"mine.mp3"}},
		{"then the folder's default/", []string{"readme.txt", "default/disk.mp3"}, builtOwn, []string{"default/disk.mp3"}},
		{"then the tracks built into music/", []string{"readme.txt"}, builtOwn, []string{"built-in.mp3"}},
		{"then the built-in default/, only when music/ has none", []string{"readme.txt"}, bundled, []string{"default/bundled.mp3"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			dir := t.TempDir()
			for _, f := range tt.files {
				writeFile(t, dir, f, frames(38))
			}
			if got := load(t, chain(dir, tt.embedded)...).AvailableFiles; !slices.Equal(got, tt.want) {
				t.Errorf("AvailableFiles = %v, want %v", got, tt.want)
			}
		})
	}
	t.Run("a missing music dir falls back too", func(t *testing.T) {
		if got := load(t, chain(filepath.Join(t.TempDir(), "absent"), bundled)...).AvailableFiles; !slices.Equal(got, []string{"default/bundled.mp3"}) {
			t.Errorf("AvailableFiles = %v", got)
		}
	})
	t.Run("nothing anywhere is an empty playlist", func(t *testing.T) {
		body, err := json.Marshal(load(t, Source{FS: fstest.MapFS{}, Dir: "."}))
		if err != nil {
			t.Fatal(err)
		}
		if string(body) != `{"availableFiles":[],"metaData":{}}` {
			t.Errorf("empty playlist = %s", body)
		}
	})
}

// A mounted music folder may hold symlinks to tracks elsewhere; fs.readdir listed them.
func TestSymlinkedTrackIsListedAndRead(t *testing.T) {
	outside, dir := t.TempDir(), t.TempDir()
	writeFile(t, outside, "real.mp3", append(id3(3, "TIT2", "Linked"), frames(38)...))
	if err := os.Symlink(filepath.Join(outside, "real.mp3"), filepath.Join(dir, "linked.mp3")); err != nil {
		t.Fatal(err)
	}
	got := load(t, Source{FS: os.DirFS(dir), Dir: "."})
	if got.MetaData["linked.mp3"].Title != "Linked" {
		t.Errorf("linked.mp3 = %+v", got.MetaData["linked.mp3"])
	}
}

// Names with spaces and non-ASCII characters are listed as they are on disk; the browser
// percent-encodes them when it builds the music/<name> URL.
func TestNamesAreListedVerbatim(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, dir, "Rainy Day – Ö.mp3", frames(38))
	if got := load(t, Source{FS: os.DirFS(dir), Dir: "."}).AvailableFiles; !slices.Equal(got, []string{"Rainy Day – Ö.mp3"}) {
		t.Errorf("AvailableFiles = %q", got)
	}
}

// Under the image's uid 65532, a mounted folder that is not world-readable cannot be
// listed: the playlist falls back and says why.
func TestUnreadableMusicFolderFallsBackWithAWarning(t *testing.T) {
	if runtime.GOOS == "windows" || os.Geteuid() == 0 {
		t.Skip("needs POSIX permissions and a non-root user")
	}
	dir := filepath.Join(t.TempDir(), "music")
	writeFile(t, dir, "mine.mp3", frames(38))
	if err := os.Chmod(dir, 0o300); err != nil { // write and search, no read: the listing fails
		t.Fatal(err)
	}
	t.Cleanup(func() { // lets t.TempDir remove it
		if err := os.Chmod(dir, 0o700); err != nil {
			t.Error(err)
		}
	})
	var logs bytes.Buffer
	got := Load(t.Context(), slog.New(slog.NewTextHandler(&logs, nil)),
		Source{FS: os.DirFS(dir), Dir: "."},
		Source{FS: fstest.MapFS{"music/default/bundled.mp3": {Data: frames(38)}}, Dir: "music/default", Prefix: "default/"})
	if !slices.Equal(got.AvailableFiles, []string{"default/bundled.mp3"}) {
		t.Errorf("AvailableFiles = %v", got.AvailableFiles)
	}
	if !strings.Contains(logs.String(), "mounted files must be world-readable") {
		t.Errorf("no warning logged:\n%s", logs.String())
	}
}

// A file name that is not UTF-8 (possible on Linux) is listed with U+FFFD and no metadata,
// as Node listed it, instead of breaking the playlist's JSON for every other track.
func TestNonUTF8NameIsListedWithReplacementCharacter(t *testing.T) {
	music := fstest.MapFS{
		"a.mp3":     {Data: frames(38)},
		"b\xff.mp3": {Data: frames(38)},
		"c.mp3":     {Data: frames(38)},
	}
	got := load(t, Source{FS: music, Dir: "."})
	bad := "b" + string(utf8.RuneError) + ".mp3"
	if want := []string{"a.mp3", bad, "c.mp3"}; !slices.Equal(got.AvailableFiles, want) {
		t.Errorf("AvailableFiles = %q, want %q", got.AvailableFiles, want)
	}
	if _, ok := got.MetaData[bad]; ok {
		t.Errorf("%q has metadata; its file cannot be opened by that name", bad)
	}
	if len(got.MetaData) != 2 {
		t.Errorf("MetaData has %d entries, want 2", len(got.MetaData))
	}
	if _, err := json.Marshal(got); err != nil {
		t.Errorf("playlist does not encode: %v", err)
	}
}

func TestCleanStripsPaddingAndInvalidUTF8(t *testing.T) {
	if got := clean("Title\x00\x00"); got != "Title" {
		t.Errorf("clean = %q", got)
	}
	if got := clean("bad \xff byte"); !strings.ContainsRune(got, utf8.RuneError) {
		t.Errorf("clean kept invalid UTF-8: %q", got)
	}
}

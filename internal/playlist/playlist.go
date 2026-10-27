// Package playlist builds /playlist.json: the .mp3 files of the first music source that
// has any, with each file's title, artist, album and duration.
package playlist

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"math"
	"path"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/dhowden/tag"
	"github.com/tcolgate/mp3"
)

// Source is a directory of tracks. Prefix is prepended to each file name in the playlist,
// so the browser's music/<name> URL reaches the file.
type Source struct {
	FS     fs.FS
	Dir    string
	Prefix string
}

// Track is the metadata the browser reads (media.mjs); an absent tag is omitted.
type Track struct {
	Title    string `json:"title,omitempty"`
	Artist   string `json:"artist,omitempty"`
	Album    string `json:"album,omitempty"`
	Duration int64  `json:"duration"` // seconds, rounded
}

// Playlist is the /playlist.json body. A file whose tags or frames cannot be read is
// listed in AvailableFiles with no MetaData entry.
type Playlist struct {
	AvailableFiles []string         `json:"availableFiles"`
	MetaData       map[string]Track `json:"metaData"`
}

// Load lists the first source holding at least one name ending in ".mp3" (case-sensitive;
// directories and symlinks count, as fs.readdir's names did), then reads every listed file.
// A missing directory is skipped like an empty one.
func Load(ctx context.Context, logger *slog.Logger, sources ...Source) Playlist {
	p := Playlist{AvailableFiles: []string{}, MetaData: map[string]Track{}}
	for _, src := range sources {
		names, err := mp3Names(src)
		if errors.Is(err, fs.ErrPermission) {
			// The image runs as uid 65532: a mounted folder it cannot list is the usual cause.
			logger.Warn("playlist: cannot list music folder; mounted files must be world-readable", "dir", src.Dir, "error", err)
		} else if err != nil {
			logger.Warn("playlist: cannot list music folder", "dir", src.Dir, "error", err)
		}
		if len(names) == 0 {
			continue
		}
		for _, name := range names {
			if ctx.Err() != nil {
				return p
			}
			file := src.Prefix + name
			p.AvailableFiles = append(p.AvailableFiles, file)
			track, err := read(src.FS, path.Join(src.Dir, name))
			if err != nil {
				logger.Warn("playlist: listing a track without metadata", "file", file, "error", err)
				continue
			}
			p.MetaData[file] = track
		}
		logger.Debug("playlist loaded", "dir", src.Dir, "prefix", src.Prefix, "tracks", len(names))
		return p
	}
	logger.Debug("playlist: no .mp3 files in any music source")
	return p
}

// mp3Names lists the .mp3 names in src, sorted. A missing directory is not an error. A name
// that is not UTF-8 is listed with U+FFFD in place of the bad bytes, as Node's fs.readdir
// decoded it: its file then cannot be opened by that name, so it gets no metadata, as in
// Node. Without this the whole playlist would fail to encode as JSON.
func mp3Names(src Source) ([]string, error) {
	entries, err := fs.ReadDir(src.FS, src.Dir)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read dir: %w", err)
	}
	var names []string
	for _, e := range entries {
		if strings.HasSuffix(e.Name(), ".mp3") {
			names = append(names, e.Name())
		}
	}
	slices.Sort(names)
	for i, name := range names {
		names[i] = strings.ToValidUTF8(name, string(utf8.RuneError))
	}
	return names, nil
}

func read(fsys fs.FS, name string) (Track, error) {
	f, err := fsys.Open(name)
	if err != nil {
		return Track{}, fmt.Errorf("open: %w", err)
	}
	defer f.Close() //nolint:errcheck // read-only
	rs, ok := f.(io.ReadSeeker)
	if !ok {
		return Track{}, fmt.Errorf("open %s: not seekable", name)
	}
	var t Track
	m, err := tag.ReadFrom(rs)
	if err != nil && !errors.Is(err, tag.ErrNoTagsFound) {
		return Track{}, fmt.Errorf("read tags: %w", err)
	}
	if m != nil {
		t.Title, t.Artist, t.Album = clean(m.Title()), clean(m.Artist()), clean(m.Album())
	}
	d, err := duration(rs)
	if err != nil {
		return Track{}, err
	}
	t.Duration = int64(math.Round(d.Seconds()))
	return t, nil
}

func clean(s string) string {
	return strings.ToValidUTF8(strings.TrimRight(s, "\x00"), string(utf8.RuneError))
}

// duration sums the duration of every MPEG audio frame after the ID3v2 tag.
func duration(rs io.ReadSeeker) (time.Duration, error) {
	start, err := id3v2Size(rs)
	if err != nil {
		return 0, err
	}
	if _, err := rs.Seek(start, io.SeekStart); err != nil {
		return 0, fmt.Errorf("seek past ID3v2 tag: %w", err)
	}
	dec := mp3.NewDecoder(bufio.NewReader(rs))
	var (
		frame   mp3.Frame
		skipped int
		total   time.Duration
		frames  int
	)
	for {
		err := dec.Decode(&frame, &skipped)
		if errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) {
			break
		}
		if err != nil {
			return 0, fmt.Errorf("decode frame %d: %w", frames+1, err)
		}
		total += frame.Duration()
		frames++
	}
	if frames == 0 {
		return 0, errors.New("no MPEG audio frames")
	}
	return total, nil
}

// id3v2Size returns the length of a leading ID3v2 tag (header, body and footer), or 0.
func id3v2Size(rs io.ReadSeeker) (int64, error) {
	if _, err := rs.Seek(0, io.SeekStart); err != nil {
		return 0, fmt.Errorf("seek to start: %w", err)
	}
	var h [10]byte
	_, err := io.ReadFull(rs, h[:])
	if errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) {
		return 0, nil // too short to hold a tag
	}
	if err != nil {
		return 0, fmt.Errorf("read ID3v2 header: %w", err)
	}
	if string(h[:3]) != "ID3" {
		return 0, nil
	}
	size := int64(h[6]&0x7f)<<21 | int64(h[7]&0x7f)<<14 | int64(h[8]&0x7f)<<7 | int64(h[9]&0x7f)
	size += 10
	if h[5]&0x10 != 0 { // footer present
		size += 10
	}
	return size, nil
}

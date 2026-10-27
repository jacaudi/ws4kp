package config

import (
	"regexp"
	"strings"
)

// js is JavaScript's \s: Go's \s is ASCII-only, while JavaScript's also covers \v and the
// Unicode spaces, the byte order mark (U+FEFF) among them.
const js = `[\t\n\v\f\r \x{A0}\x{1680}\x{2000}-\x{200A}\x{2028}\x{2029}\x{202F}\x{205F}\x{3000}\x{FEFF}]`

// dotenvLine is dotenv 18's LINE expression (lib/main.js), with \s spelled as js and `.`
// as "not a line terminator". RE2 picks the same leftmost-first match a backtracking
// engine does, so each match, and each skipped stretch, is dotenv's.
var dotenvLine = regexp.MustCompile(`(?m)^` + js + `*(?:export` + js + `+)?([\w.-]+)(?:` + js + `*=` + js + `*?|:` + js + `+?)(` +
	js + `*'(?:\\'|[^'])*'|` +
	js + `*"(?:\\"|[^"])*"|` +
	js + "*`(?:\\\\`|[^`])*`|" +
	`[^#\r\n]+)?` + js + `*(?:#[^\n\r\x{2028}\x{2029}]*)?$`)

// envVar is one KEY=value line of a .env file.
type envVar struct{ Key, Value string }

// parseDotenv parses .env text exactly as dotenv 18's parse() does. CRLF and lone CR become
// LF. A line that is not KEY=value (or KEY: value, optionally after "export ") is skipped.
// An unquoted value ends at "#". One layer of matching single, double or backtick quotes is
// removed, and inside double quotes the two-character escapes \n and \r become a newline
// and a carriage return. Nothing else is expanded (no $VAR). The variables come back in
// file order; a key given twice keeps its first position and its last value, as a
// JavaScript object does.
func parseDotenv(text string) []envVar {
	text = strings.ReplaceAll(text, "\r\n", "\n")
	text = strings.ReplaceAll(text, "\r", "\n")
	var env []envVar
	index := map[string]int{}
	for _, m := range dotenvLine.FindAllStringSubmatch(text, -1) {
		value := strings.TrimFunc(m[2], isJSSpace)
		quoted := len(value) >= 2 && strings.ContainsRune("'\"`", rune(value[0])) && value[len(value)-1] == value[0]
		first := ""
		if value != "" {
			first = value[:1]
		}
		if quoted {
			value = value[1 : len(value)-1]
		}
		if first == `"` {
			value = strings.ReplaceAll(value, `\n`, "\n")
			value = strings.ReplaceAll(value, `\r`, "\r")
		}
		if i, seen := index[m[1]]; seen {
			env[i].Value = value
			continue
		}
		index[m[1]] = len(env)
		env = append(env, envVar{m[1], value})
	}
	return env
}

// isJSSpace is the set String.prototype.trim removes: js, as runes.
func isJSSpace(r rune) bool {
	switch {
	case r == '\t', r == '\n', r == '\v', r == '\f', r == '\r', r == ' ':
		return true
	case r == 0xA0, r == 0x1680, r >= 0x2000 && r <= 0x200A:
		return true
	case r == 0x2028, r == 0x2029, r == 0x202F, r == 0x205F, r == 0x3000, r == 0xFEFF:
		return true
	}
	return false
}

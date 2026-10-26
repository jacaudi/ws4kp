package proxy

import (
	"cmp"
	"regexp"
)

// DefaultRadarHost is the mesonet host used unless OVERRIDE_RADAR_HOST names another.
const DefaultRadarHost = "mesonet.agron.iastate.edu"

// Upstream is one proxied service.
type Upstream struct {
	// Mount is the path prefix the service is served under, with a trailing slash.
	Mount string
	// Base is the scheme and host the rest of the path is appended to.
	Base string
	// Service names the upstream in the 500 error body.
	Service string
	// SkipParams are query parameters that are not forwarded.
	SkipParams []string
	// Binary reports whether a path (relative to Mount) is sent in binary mode; nil means
	// text mode. Text mode gives the response a utf-8 charset, binary mode only a default
	// type.
	Binary func(path string) bool
}

func always(string) bool { return true }

var imagePath = regexp.MustCompile(`(?i)\.(png|jpg|jpeg|gif|webp|ico)$`)

// Upstreams returns the seven proxied services. radarHost replaces the mesonet host
// (OVERRIDE_RADAR_HOST); empty means DefaultRadarHost.
func Upstreams(radarHost string) []Upstream {
	radarHost = cmp.Or(radarHost, DefaultRadarHost)
	return []Upstream{
		{Mount: "/api/", Base: "https://api.weather.gov", Service: "Weather.gov", SkipParams: []string{"u"}},
		{Mount: "/radar/", Base: "https://radar.weather.gov", Service: "Radar", SkipParams: []string{"u"}, Binary: always},
		{Mount: "/hrrr/", Base: "https://hrrrzarr.s3.amazonaws.com", Service: "HRRR S3 bucket", Binary: always},
		{Mount: "/spc/", Base: "https://www.spc.noaa.gov", Service: "SPC Outlook", SkipParams: []string{"u"}},
		{Mount: "/airquality/", Base: "https://air-quality-api.open-meteo.com", Service: "Open-Meteo Air Quality"},
		{Mount: "/mesonet/", Base: "https://" + radarHost, Service: "Iowa State Mesonet (" + radarHost + ")", Binary: imagePath.MatchString},
		{Mount: "/forecast/", Base: "https://forecast.weather.gov", Service: "Forecast.weather.gov", SkipParams: []string{"u"}},
	}
}

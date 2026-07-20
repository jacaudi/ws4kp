# Changelog

## [7.1.2](https://github.com/jacaudi/ws4kp/compare/v7.1.1...v7.1.2) (2026-07-20)


### Miscellaneous

* **deps:** update dependency sass to v1.101.0 ([e29ca32](https://github.com/jacaudi/ws4kp/commit/e29ca3259574d45cb0fe94d91f9d4acb87b5c404))
* **deps:** update dependency terser-webpack-plugin to v5.6.1 ([d10d764](https://github.com/jacaudi/ws4kp/commit/d10d764965908ab5ea60acf51d9ded64c916f590))

## [7.1.1](https://github.com/jacaudi/ws4kp/compare/v7.1.0...v7.1.1) (2026-07-20)


### Bug Fixes

* **proxy:** strip hop-by-hop headers so chunked upstreams don't 502 ([33e0512](https://github.com/jacaudi/ws4kp/commit/33e0512503521cf55cd4f03c9ccaaa49a71ea3bd))
* **proxy:** strip hop-by-hop headers so chunked upstreams don't 502 ([6edd430](https://github.com/jacaudi/ws4kp/commit/6edd430dfcbc46b28687be60d198537dbe8f7ce8))

## [7.1.0](https://github.com/jacaudi/ws4kp/compare/v7.0.3...v7.1.0) (2026-07-20)


### Features

* add Air Quality display (Open-Meteo, dual-mode) ([f86d5e7](https://github.com/jacaudi/ws4kp/commit/f86d5e7d298eb4c38569761aaf13ebf0131ed2a0))
* **air-quality:** add 4-band health-protective AQI category mapping + node --test runner ([1776150](https://github.com/jacaudi/ws4kp/commit/1776150d52860a086319c03fe4bd5be4f85f6966))
* **air-quality:** add AirQuality display class with getData + noData self-disable ([956c3c0](https://github.com/jacaudi/ws4kp/commit/956c3c09fea6abaa86fc1268cfb334bec64dd86c))
* **air-quality:** add dominant-pollutant argmax, response parse, and band-center bar-tip helper ([e446c1b](https://github.com/jacaudi/ws4kp/commit/e446c1b93ce176e4c1c147589a51f936055d80f5))
* **air-quality:** add EJS partial and SCSS for the canvas display ([1e4fce8](https://github.com/jacaudi/ws4kp/commit/1e4fce8656ee993401b92d9e7cad698fd4c82550))
* **air-quality:** add host-pinned /airquality proxy route and url-rewrite clause ([9c4de3c](https://github.com/jacaudi/ws4kp/commit/9c4de3cf1c3f7a578a498e3f405a29c343f27aad))
* **air-quality:** register display in navigation and wire index.ejs ([020c20b](https://github.com/jacaudi/ws4kp/commit/020c20b343e6401aac351002fead7c3904bfd8c0))
* **air-quality:** render full WS4000 canvas (bands, notches, growing bar that stops at band center, title) ([4e3c027](https://github.com/jacaudi/ws4kp/commit/4e3c027f3b346be6751aa4781e9ff45298314aa0))
* **calc:** add geoDistance (cos-lat equirectangular) ([bdec371](https://github.com/jacaudi/ws4kp/commit/bdec3719937eb35455ad1920307b9bef17986884))
* **music:** bundle the ws4kp-music library via Git LFS ([e563446](https://github.com/jacaudi/ws4kp/commit/e56344624ae13254754037a4b7b3539b457060e8))
* **regional:** filterJunkStations drops priority&gt;=50 non-towns ([2780711](https://github.com/jacaudi/ws4kp/commit/27807117d102cb6b3eb32a25dab02b535d9bf266))
* **regional:** resolveLabelCollisions (real-width, nearest-kept) ([dbf4935](https://github.com/jacaudi/ws4kp/commit/dbf493546b6a1e255406c08147f4835cbe31ea53))
* **regional:** selectRegionalCities (nearest-N + minSpacing + count + priority tiebreaker) ([7b142e6](https://github.com/jacaudi/ws4kp/commit/7b142e60cc266e5fbc9621b97278925ede36c6cd))
* **regional:** wire ranked selection + junk filter + collision declutter into display ([44a96f8](https://github.com/jacaudi/ws4kp/commit/44a96f802b41a6d610851287777751d98d55dd5b))


### Bug Fixes

* **air-quality:** guard non-finite us_aqi in parseAirQuality ([61ab50f](https://github.com/jacaudi/ws4kp/commit/61ab50f9610425d590885fe4b082ced33a1acf06))
* **air-quality:** preserve last-good render on transient refresh failure ([ec7e751](https://github.com/jacaudi/ws4kp/commit/ec7e75164f0f8e3bcef385351d23a6cee1d606d3))
* **air-quality:** remove dead skipParams from airQualityProxy ([99b3195](https://github.com/jacaudi/ws4kp/commit/99b31953b2b050cb7897dcebc9be2e2934ed34d0))
* **air-quality:** restore loaded status when keeping data on refresh failure ([8c32767](https://github.com/jacaudi/ws4kp/commit/8c32767c4f05c89fd0b080381c5ba365a2a1d931))
* **datagen:** exclude AK/HI ICAO P-prefix airports from weather_station misclassification ([dd77464](https://github.com/jacaudi/ws4kp/commit/dd77464dc565a32df17d363e3e07565f4eb6d412))
* **datagen:** stations .features filter + name-regex interpolation; bake station grid points + regenerate stations.json ([faf328b](https://github.com/jacaudi/ws4kp/commit/faf328b728c72b6c73a0432e0b1aeb4d874fd0ac))
* **regional:** getXYForCity AK/HI missing-return; extract pure regionalforecast-select module + node --test runner ([450cd6e](https://github.com/jacaudi/ws4kp/commit/450cd6ee27965b6356562986da2409331d135483))
* **regional:** guard getRegionalObservation when a grid has no 4-letter station ([2f3d2ac](https://github.com/jacaudi/ws4kp/commit/2f3d2acbf72a56ac62be9d5d0b14a47ffb10f85b))
* **regional:** single-source marker px/deg from scaled basemap; unify AK/HI getXYForCity; wire scale at call site ([76ae9a2](https://github.com/jacaudi/ws4kp/commit/76ae9a2ba29bcd8b1ce88bea1ce7ee2d3c5b99be))
* **release:** tag releases as vX.Y.Z (include-component-in-tag false) ([e3b6d4a](https://github.com/jacaudi/ws4kp/commit/e3b6d4afee5de12c10048c7934b355490b9c79df))


### Documentation

* **k8s:** add Gateway API HTTPRoute above Ingress; mark Ingress legacy ([93b1be6](https://github.com/jacaudi/ws4kp/commit/93b1be65a8cc1a0233ee41b63121ca7c10eba48e))
* README conciseness pass + Kubernetes (bjw-s app-template) guide ([b529cf9](https://github.com/jacaudi/ws4kp/commit/b529cf94c38d5ecf601b31adaf3dbcdf0582f345))
* restructure README as a quickstart + move deep-dives to /docs ([c027384](https://github.com/jacaudi/ws4kp/commit/c027384012d109b80212a87a0b1dc3eb0272b710))
* tighten README (conciseness pass) + add Kubernetes (app-template) guide ([78a57be](https://github.com/jacaudi/ws4kp/commit/78a57be06ff2332e27c2cdc98d94f2d609097f30))


### Miscellaneous

* **deps:** update dependency @eslint/eslintrc to v3.3.6 ([61ede9c](https://github.com/jacaudi/ws4kp/commit/61ede9ce57e6fd4c4d4654c72b969ae8173c0659))
* **deps:** update dependency @eslint/eslintrc to v3.3.6 ([0384b1b](https://github.com/jacaudi/ws4kp/commit/0384b1b2eac47277a121c11088840b25cf8a023d))
* **deps:** update dependency eslint to v9.39.5 ([c6e91b5](https://github.com/jacaudi/ws4kp/commit/c6e91b5f0387efccf1c90b9f0ef5f81934e54fd8))
* **deps:** update dependency eslint to v9.39.5 ([af7efeb](https://github.com/jacaudi/ws4kp/commit/af7efeb01b20942cd5a3a02e578dd7ef91a98fac))
* **docker:** make server deployment the default; archive static (nginx) ([23bfa03](https://github.com/jacaudi/ws4kp/commit/23bfa032e7fbb42a13fa9669fb2c588296d2a78a))
* harden .dockerignore and .gitignore ([856bced](https://github.com/jacaudi/ws4kp/commit/856bced66e10984c3bc0304f51a0ea9615d55978))

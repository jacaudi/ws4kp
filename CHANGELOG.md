# Changelog

## [7.5.0](https://github.com/jacaudi/ws4kp/compare/v7.4.0...v7.5.0) (2026-10-25)


### Features

* adopt upstream v8.0.1 ([de73728](https://github.com/jacaudi/ws4kp/commit/de73728af90fc973d6399f0b625f0c06d0dda422))
* Air Quality charts PM2.5 on the six EPA categories ([51fce7a](https://github.com/jacaudi/ws4kp/commit/51fce7a2debc384b67e49c3dc162b288b25437b4))
* Air Quality portrait layout to match SPC Outlook's ([7bcaf60](https://github.com/jacaudi/ws4kp/commit/7bcaf602bdd03c4dfe4543d8db59d6f71e58bbbf))
* bundle the Latest Observations album from ws4kp-music ([602498c](https://github.com/jacaudi/ws4kp/commit/602498cc9145b8324ffc0265e33478f76e8501cd))
* port density-aware regional selection onto v8's map ([995e917](https://github.com/jacaudi/ws4kp/commit/995e9173ca090e3bd592089a54ae15260da651fd))


### Bug Fixes

* Air Quality built on SPC Outlook's geometry; portrait tables clear of the box ([68db842](https://github.com/jacaudi/ws4kp/commit/68db842930bf7d3859d8ada3b8531b916a2ea17a))
* **deps:** update dependency ejs to v7 ([4996459](https://github.com/jacaudi/ws4kp/commit/499645957e5eda846da70909e70ea5b4954603a7))
* give Air Quality its own clean background; put it back on the progress list ([8c0953e](https://github.com/jacaudi/ws4kp/commit/8c0953e4548a0da83b54373b4d8d91a5c0cbc383))
* give the current conditions icon a fixed slot ([90db353](https://github.com/jacaudi/ws4kp/commit/90db3534a8e598bdf013bd4a338f4da084f8c75e))
* hourly and travel forecast lists inside the blue box, like the other slides ([6b17ad7](https://github.com/jacaudi/ws4kp/commit/6b17ad7d54d8f617ed47deb095b99e377a462b43))
* hourly and travel forecast rows in white, like the other slides' body text ([95cfaae](https://github.com/jacaudi/ws4kp/commit/95cfaae3f58595afc2d0c8a4801d9709027b1913))
* keep tall current-conditions icons off the condition text ([083c3cc](https://github.com/jacaudi/ws4kp/commit/083c3cc85bfd699c19f21bdb9fe3ef061767d679))
* lay Air Quality out like the other slides ([e481b83](https://github.com/jacaudi/ws4kp/commit/e481b83e81c2c14dff85ce28262a3c45ff0f47f8))
* pillarbox Air Quality in widescreen; keep it off the 10-row progress list ([f5eada3](https://github.com/jacaudi/ws4kp/commit/f5eada3edfe55c4b262d3023270d9fbdf94dc86e))
* restore the MapClick fallback for blank observations ([e02c152](https://github.com/jacaudi/ws4kp/commit/e02c1520dda47cbb7f1593593f3946702308a266))
* stop shipping the music twice in the Docker image ([93d25e0](https://github.com/jacaudi/ws4kp/commit/93d25e0a161507d5db959ae9652c47285a5998f6))


### Miscellaneous

* **deps:** update actions/create-github-app-token action to v3.3.0 ([99c3f0c](https://github.com/jacaudi/ws4kp/commit/99c3f0c1396e98dddcaa1864422588702b1eb5e0))
* **deps:** update actions/setup-node action to v7.1.0 ([fc16630](https://github.com/jacaudi/ws4kp/commit/fc16630baf591ecaa6103191e116623b958b71b7))
* **deps:** update dependency del to v9 ([c283236](https://github.com/jacaudi/ws4kp/commit/c28323601efec89d9a3fd3bd9217b7a544d9fdf7))
* **deps:** update dependency dotenv to v18.0.8 ([309d9c9](https://github.com/jacaudi/ws4kp/commit/309d9c966b5a79296317f115d0aa55989c22c04b))
* **deps:** update dependency express to v5.3.0 ([84ce859](https://github.com/jacaudi/ws4kp/commit/84ce859bddb35bbdfea94e507aeae16358396cb5))
* **deps:** update dependency music-metadata to v12.2.3 ([80bba94](https://github.com/jacaudi/ws4kp/commit/80bba948d21121b0d989708e7005d0444eb91817))
* **deps:** update dependency sass to v1.106.1 ([60c9558](https://github.com/jacaudi/ws4kp/commit/60c95582fa14235e0207bb173873e7a79455ac8f))
* **deps:** update dependency webpack to v5.112.0 ([53abfff](https://github.com/jacaudi/ws4kp/commit/53abfff78668c9f5b2c699dab941889834a51812))
* **deps:** update ghcr.io/bjw-s-labs/helm/app-template docker tag to v5.3.0 ([d2bbd8f](https://github.com/jacaudi/ws4kp/commit/d2bbd8fba1df872f18ab93075b201df10ffabe6a))
* drop upstream's security.txt ([cae329b](https://github.com/jacaudi/ws4kp/commit/cae329bb5f946385c5b523984204336027308dd7))
* **music:** name the bundled tracks &lt;album&gt;--&lt;song&gt; ([97b8f67](https://github.com/jacaudi/ws4kp/commit/97b8f677407806e9b15dbae2cc60f4f9072ab429))
* **music:** tag Current Conditions with its album and the shared artist ([7adbd62](https://github.com/jacaudi/ws4kp/commit/7adbd62d6405026d9fb8417b1af621531af57764))
* **upstream-review:** record keeping the 192 kbps Current Conditions tracks ([126db8c](https://github.com/jacaudi/ws4kp/commit/126db8ca512306b513c392a0b2201db103a41150))
* **upstream-review:** track each upstream separately, and record why files differ ([a60a54a](https://github.com/jacaudi/ws4kp/commit/a60a54ae720d8a1a63180e4bd25a2a96f8c492ae))

## [7.4.0](https://github.com/jacaudi/ws4kp/compare/v7.3.0...v7.4.0) (2026-09-19)


### Features

* adopt upstream v7.1.6, add scroll regression tests, tidy the root ([#84](https://github.com/jacaudi/ws4kp/issues/84)) ([7dc2e48](https://github.com/jacaudi/ws4kp/commit/7dc2e489a4f01f49067efae6cb629bc3816866a5))


### Miscellaneous

* **deps:** update dependency @eslint/eslintrc to v3.3.7 ([38bc18f](https://github.com/jacaudi/ws4kp/commit/38bc18faab6dc9e420f1c0e091bcb8b878ddd86c))
* **deps:** update dependency eslint to v10.10.0 ([2cfce7b](https://github.com/jacaudi/ws4kp/commit/2cfce7bd26d40eb0abd1bfc9eb0caeff68bc53d3))
* **deps:** update dependency p-limit to v7.3.2 ([8d144ad](https://github.com/jacaudi/ws4kp/commit/8d144ad43ab2c51e910e9f8a5343cd8a4d915777))
* **deps:** update dependency sass to v1.104.1 ([fe42c60](https://github.com/jacaudi/ws4kp/commit/fe42c60bb30ed3890a8a4bdf20459d2957949a1e))
* **deps:** update dependency suncalc to v2.0.2 ([9c5d331](https://github.com/jacaudi/ws4kp/commit/9c5d33191e4e686cfeeb69a2e3e4a103329c4d03))
* **deps:** update dependency webpack to v5.111.0 ([ae1fc7e](https://github.com/jacaudi/ws4kp/commit/ae1fc7e94b080ab9662dfde2e2880726c299d989))
* **deps:** update docker/build-push-action action to v7.4.0 ([0df8d7a](https://github.com/jacaudi/ws4kp/commit/0df8d7adb26e2f92ff59d929d903cd1e4137c436))
* **deps:** update docker/login-action action to v4.6.0 ([cf62555](https://github.com/jacaudi/ws4kp/commit/cf62555c1dd609d30349ec1e5777f8a0034e6b16))
* **deps:** update docker/setup-buildx-action action to v4.4.1 ([e2a30da](https://github.com/jacaudi/ws4kp/commit/e2a30da215ae746a0d7fb612cf0d8e0b4756631c))
* **deps:** update docker/setup-qemu-action action to v4.4.0 ([7b82467](https://github.com/jacaudi/ws4kp/commit/7b82467cdaa821630ae4b34a705ae06e4e216edb))
* **deps:** update ghcr.io/bjw-s-labs/helm/app-template docker tag to v5.2.1 ([225e4fc](https://github.com/jacaudi/ws4kp/commit/225e4fcd8b6cd7dcfdd75c0e6fb53dc267707e2b))

## [7.3.0](https://github.com/jacaudi/ws4kp/compare/v7.2.2...v7.3.0) (2026-07-30)


### Features

* **logo:** SVG corner logo + user-customizable PNG logo ([#70](https://github.com/jacaudi/ws4kp/issues/70)) ([20b28d9](https://github.com/jacaudi/ws4kp/commit/20b28d91d430b33e76ca175ea5e400368bd98d0a))


### Bug Fixes

* **vendor:** stop updateVendor drifting from the lockfile ([#71](https://github.com/jacaudi/ws4kp/issues/71)) ([2f347a7](https://github.com/jacaudi/ws4kp/commit/2f347a748f553a9ef457a50a505fe9a8ee7d974b)), closes [#42](https://github.com/jacaudi/ws4kp/issues/42)

## [7.2.2](https://github.com/jacaudi/ws4kp/compare/v7.2.1...v7.2.2) (2026-07-29)


### Bug Fixes

* **regional:** space labels by their real pixel box and let stations yield to cities ([#65](https://github.com/jacaudi/ws4kp/issues/65)) ([bef34db](https://github.com/jacaudi/ws4kp/commit/bef34dbcc8a98b1e4ae4d13ebfb856926df5b0ae))

## [7.2.1](https://github.com/jacaudi/ws4kp/compare/v7.2.0...v7.2.1) (2026-07-29)


### Bug Fixes

* **ci:** build the release image from the tagged commit, not the triggering one ([300eea1](https://github.com/jacaudi/ws4kp/commit/300eea11fa7e1c5016a8c5d0e0b12685feb68a5c))

## [7.2.0](https://github.com/jacaudi/ws4kp/compare/v7.1.5...v7.2.0) (2026-07-29)


### Features

* pull in upstream 7.1.3 fixes and the expanded regional city list ([f9078ed](https://github.com/jacaudi/ws4kp/commit/f9078ed4694bbcfa6e0f100d158b90574dd7c53e))


### Bug Fixes

* **regional:** drop off-map cities and make label decluttering actually run ([d1abcc1](https://github.com/jacaudi/ws4kp/commit/d1abcc15e72012b11ff554d4f3ebd5ca7da53408))

## [7.1.5](https://github.com/jacaudi/ws4kp/compare/v7.1.4...v7.1.5) (2026-07-29)


### Bug Fixes

* **deps:** update dependency ejs to v6 ([6dfbf8d](https://github.com/jacaudi/ws4kp/commit/6dfbf8df2af34abf9e61f3a7a8cebea822e7bd5a))


### Miscellaneous

* **deps:** update dependency sass to v1.101.7 ([55b0008](https://github.com/jacaudi/ws4kp/commit/55b000894e7b3f0bcca7f16af5fe7fc4a255d28d))
* **deps:** update dependency webpack to v5.109.0 ([bbb67f8](https://github.com/jacaudi/ws4kp/commit/bbb67f8b85748e43bd5c8a457bd238bef1ff36bf))
* **deps:** update docker/build-push-action action to v7 ([84a293d](https://github.com/jacaudi/ws4kp/commit/84a293d32c8bbb0d5bcc1a83d84269c551d37b2b))
* **deps:** update docker/login-action action to v4 ([1ff2816](https://github.com/jacaudi/ws4kp/commit/1ff28169541fe45be1aa7f613ff8a779cb22f405))
* **deps:** update docker/metadata-action action to v6 ([e190830](https://github.com/jacaudi/ws4kp/commit/e1908301cec49a28dfc709d85f541dafb084b75a))
* **deps:** update docker/setup-buildx-action action to v4 ([fc2a3e1](https://github.com/jacaudi/ws4kp/commit/fc2a3e16307639ed1343b39e7c1ac86590f0ba5e))
* **deps:** update docker/setup-qemu-action action to v4 ([2883286](https://github.com/jacaudi/ws4kp/commit/2883286eca8e1d7c7fb69faeda88253c91a967d8))
* **deps:** update github/codeql-action action to v4 ([3e40501](https://github.com/jacaudi/ws4kp/commit/3e40501f3f099ed4c87dd21b3fb84f0ae4cc9e62))
* **deps:** update googleapis/release-please-action action to v5 ([ae5e0de](https://github.com/jacaudi/ws4kp/commit/ae5e0deb164aa4f06159c7aa0a43cc367b63d954))

## [7.1.4](https://github.com/jacaudi/ws4kp/compare/v7.1.3...v7.1.4) (2026-07-21)


### Bug Fixes

* **almanac:** adapt to suncalc v2 and re-vendor the UMD build ([1bacd9a](https://github.com/jacaudi/ws4kp/commit/1bacd9acc94bd9ef5fad777777d9645c4f906585))
* **css:** regenerate stale ws.min.css and repoint the build:css script ([c6741ab](https://github.com/jacaudi/ws4kp/commit/c6741ab1933feff62338202cb5022c9d4caa43dc))
* **css:** regenerate stale ws.min.css and repoint the build:css script ([f01f3dc](https://github.com/jacaudi/ws4kp/commit/f01f3dc16699c79962e24e245f7901e51963735c)), closes [#35](https://github.com/jacaudi/ws4kp/issues/35)
* **proxy:** stop relaying upstream set-cookie headers ([be68a71](https://github.com/jacaudi/ws4kp/commit/be68a71f4f8ee4cf37ebc6b3f52f93e43983c88d)), closes [#35](https://github.com/jacaudi/ws4kp/issues/35)


### Miscellaneous

* **deps:** update dependency eslint to v10 ([02cee4c](https://github.com/jacaudi/ws4kp/commit/02cee4c7266cae9389d828876e5af0a302e5a481))
* **deps:** update dependency eslint to v10 ([525c9fa](https://github.com/jacaudi/ws4kp/commit/525c9fa034c417cffb0971065541516c33b0b991))
* **deps:** update dependency suncalc to v2 ([abaf3dd](https://github.com/jacaudi/ws4kp/commit/abaf3dd384126b3b7970e2dcfcee12a19251c3fb))
* **deps:** update dependency suncalc to v2 ([944f191](https://github.com/jacaudi/ws4kp/commit/944f1910f42a40403888a0241260252a69d884d1))
* drop dead utils/cache.mjs and the unused ajv devDependency ([6ff015a](https://github.com/jacaudi/ws4kp/commit/6ff015a9c5b0f02b0c02b02507497d61fcce255a))
* drop dead utils/cache.mjs and the unused ajv devDependency ([fd7f798](https://github.com/jacaudi/ws4kp/commit/fd7f7989cacffbee811c4e209acfa7e475e83fde)), closes [#35](https://github.com/jacaudi/ws4kp/issues/35)
* **renovate:** wait 3 days before raising npm updates ([9c2885f](https://github.com/jacaudi/ws4kp/commit/9c2885fd6876c2ca5f70898bd2ab0e996192f375))
* **renovate:** wait 3 days before raising npm updates ([6306db7](https://github.com/jacaudi/ws4kp/commit/6306db7e5593e8e69b09b7957eea8e599e59af62)), closes [#35](https://github.com/jacaudi/ws4kp/issues/35)

## [7.1.3](https://github.com/jacaudi/ws4kp/compare/v7.1.2...v7.1.3) (2026-07-21)


### Bug Fixes

* **build:** bundle airquality.mjs so Air Quality appears in dist builds ([6616688](https://github.com/jacaudi/ws4kp/commit/6616688fbc57c1d79890d189896d6b8be930fc6f))
* **build:** bundle airquality.mjs so Air Quality appears in dist builds ([6c52e8f](https://github.com/jacaudi/ws4kp/commit/6c52e8f175d77c90ffdc12b860b47a9bd17e4766))


### Miscellaneous

* **deps:** update actions/checkout action to v7 ([b6bfdb4](https://github.com/jacaudi/ws4kp/commit/b6bfdb40c58732d579086e07a43acd33c637c3de))
* **deps:** update actions/checkout action to v7 ([62f5600](https://github.com/jacaudi/ws4kp/commit/62f56009b40c08f170e56f7063c055ba79c82b44))
* **deps:** update actions/setup-node action to v7 ([22d18c9](https://github.com/jacaudi/ws4kp/commit/22d18c90c86ad421764ff5924b872baa900dffb7))
* **deps:** update actions/setup-node action to v7 ([1140f29](https://github.com/jacaudi/ws4kp/commit/1140f2915de0fe5d5a8a7e67b8e54597ad0b0f9b))
* **deps:** update dependency sass to v1.101.3 ([035e79e](https://github.com/jacaudi/ws4kp/commit/035e79e999f3dddb56e2647c88201671923416dd))
* **deps:** update dependency sass to v1.101.3 ([f07ea1f](https://github.com/jacaudi/ws4kp/commit/f07ea1f59a34e8278d65a367de5247cff59b357a))
* **deps:** update dependency webpack to v5.108.4 ([7966d36](https://github.com/jacaudi/ws4kp/commit/7966d36a46c10c4019946f3590a29d3f15aacfa3))
* **deps:** update dependency webpack to v5.108.4 ([08c8d4f](https://github.com/jacaudi/ws4kp/commit/08c8d4fbcab38ad0182bce62336b954a14af70a8))

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

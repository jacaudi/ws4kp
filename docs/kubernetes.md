# Kubernetes (bjw-s app-template)

Deploy WeatherStar 4000+ to a cluster with the [bjw-s **app-template**](https://github.com/bjw-s-labs/helm-charts) Helm chart — a thin, well-maintained wrapper for running a single container as a Deployment + Service (+ an optional Gateway API `HTTPRoute` or a legacy Ingress).

The default `ghcr.io/jacaudi/ws4kp` image is the **server deployment** (Node/Express + caching proxy), which is what you want here — it listens on **port 8080** and needs no persistent storage (the music is baked into the image).

- [values.yaml](#valuesyaml)
- [Exposing it (Gateway API / Ingress)](#exposing-it)
- [Install with Helm](#install-with-helm)
- [Install with Flux (GitOps)](#install-with-flux-gitops)
- [Notes](#notes)

## values.yaml

```yaml
controllers:
  ws4kp:
    replicas: 1 # the server keeps an in-process cache; see Notes before scaling up
    containers:
      app:
        image:
          repository: ghcr.io/jacaudi/ws4kp
          tag: v7.1.1 # x-release-please-version — pin a release; auto-bumped on each release
        env:
          # Seed a default location / displays with WSQS_ vars (any permalink
          # parameter: replace '-' with '_' and prefix WSQS_). Optional.
          WSQS_latLonQuery: "Orlando International Airport Orlando FL USA"
          WSQS_kiosk: "true"
        probes:
          liveness: { enabled: true }
          readiness: { enabled: true }
          startup: { enabled: true }
        resources:
          requests:
            cpu: 10m
            memory: 128Mi
          limits:
            memory: 512Mi

service:
  app:
    controller: ws4kp
    ports:
      http:
        port: 8080
```

> Default probes are TCP checks against port 8080, which suits the Express server.

## Exposing it

Pick one and add it to `values.yaml`. The modern **Gateway API** is preferred; **Ingress** is the legacy Kubernetes networking API. (You can also skip both and use a `LoadBalancer`/`NodePort` service, Tailscale, etc.)

### Gateway API (`HTTPRoute`) — recommended

app-template renders an `HTTPRoute` from a `route:` block. Point `parentRefs` at an existing Gateway + listener in your cluster:

```yaml
route:
  app:
    hostnames:
      - ws4kp.example.com
    parentRefs:
      - name: external          # your Gateway
        namespace: kube-system  # the Gateway's namespace
        sectionName: https      # the listener name
    rules:
      - backendRefs:
          - identifier: app
            port: http
```

### Ingress (legacy `networking.k8s.io/v1` API)

If your cluster still exposes apps through an Ingress controller:

```yaml
ingress:
  app:
    className: nginx
    hosts:
      - host: ws4kp.example.com
        paths:
          - path: /
            pathType: Prefix
            service:
              identifier: app
              port: http
```

## Install with Helm

```bash
helm install ws4kp \
  oci://ghcr.io/bjw-s-labs/helm/app-template --version 5.0.1 \
  -n ws4kp --create-namespace \
  -f values.yaml
```

## Install with Flux (GitOps)

```yaml
---
apiVersion: source.toolkit.fluxcd.io/v1
kind: OCIRepository
metadata:
  name: app-template
  namespace: ws4kp
spec:
  interval: 1h
  url: oci://ghcr.io/bjw-s-labs/helm/app-template
  ref:
    tag: 5.0.1
---
apiVersion: helm.toolkit.fluxcd.io/v2
kind: HelmRelease
metadata:
  name: ws4kp
  namespace: ws4kp
spec:
  interval: 1h
  chartRef:
    kind: OCIRepository
    name: app-template
  values:
    # ... paste the values.yaml body from above here ...
    controllers:
      ws4kp:
        containers:
          app:
            image:
              repository: ghcr.io/jacaudi/ws4kp
              tag: v7.1.1 # x-release-please-version
    service:
      app:
        controller: ws4kp
        ports:
          http:
            port: 8080
```

## Notes

- **Image tags:** pin a release (`v7.1.1`) for reproducible rollouts. The registry also publishes `:latest` (from `main`) and `:sha-<short>` for every build; all images are multi-arch (amd64 + arm64), so they run on ARM nodes too. <!-- x-release-please-version -->
- **Replicas / caching:** the server's request de-dup + cache is **in-process (per-pod)**. One replica gives the best cache hit rate. Running more replicas still works, but each pod caches independently (more upstream calls); there's no shared cache to configure. For a single household/kiosk, keep `replicas: 1`.
- **No storage needed:** music ships baked into the image. To override it, mount your own tracks over `/app/server/music` (e.g. an app-template `persistentVolumeClaim` or `configMap` volume) — see [music.md](music.md).
- **Config:** everything is driven by `WSQS_` environment variables (above) — see [deployment.md](deployment.md#default-parameters-via-environment-variables) for the full list. No secrets or API keys are required (all data sources are key-free).
- **Chart version:** `5.0.1` is current at the time of writing; check the [helm-charts repo](https://github.com/bjw-s-labs/helm-charts) for newer app-template releases (the values schema is stable across recent 3.x–5.x).
```

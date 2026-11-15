"""Small web helper: one try per request, a timeout, and the raw response saved to data/raw/.

Rule from CLAUDE.md: never loop on retries. A failure is reported, not repeated.
"""

import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request

USER_AGENT = "efcg-land-dev-packager/1.0"
DEFAULT_TIMEOUT_S = 45


class FetchError(Exception):
    """A data source could not be reached or returned something unusable."""


class Fetcher:
    def __init__(self, raw_dir, simulate_failures=()):
        self.raw_dir = raw_dir
        self.simulate_failures = set(simulate_failures)
        os.makedirs(raw_dir, exist_ok=True)

    def get(self, url, params=None, *, save_as=None, timeout=DEFAULT_TIMEOUT_S, data=None, layer=None):
        """Fetch a URL once. Returns (bytes, content_type, full_url). Saves the bytes to data/raw/."""
        if layer and layer in self.simulate_failures:
            raise FetchError("simulated failure (test run with --simulate-failure)")
        full = url + ("?" + urllib.parse.urlencode(params) if params else "")
        body = None
        headers = {"User-Agent": USER_AGENT}
        if data is not None:
            body = urllib.parse.urlencode(data).encode()
            headers["Content-Type"] = "application/x-www-form-urlencoded"
        req = urllib.request.Request(full, data=body, headers=headers)
        t0 = time.time()
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                content = r.read()
                ctype = r.headers.get("Content-Type", "")
        except urllib.error.HTTPError as e:
            raise FetchError(f"the server answered HTTP {e.code} ({e.reason})") from None
        except urllib.error.URLError as e:
            raise FetchError(f"could not connect ({e.reason})") from None
        except TimeoutError:
            raise FetchError(f"no answer within {timeout} seconds") from None
        except OSError as e:
            raise FetchError(f"network error ({e})") from None
        if save_as:
            with open(os.path.join(self.raw_dir, save_as), "wb") as f:
                f.write(content)
        self.last_seconds = round(time.time() - t0, 1)
        return content, ctype, full

    def get_json(self, url, params=None, **kw):
        content, _, full = self.get(url, params, **kw)
        try:
            j = json.loads(content)
        except ValueError:
            raise FetchError("the server's answer was not valid data (expected JSON)") from None
        if isinstance(j, dict) and j.get("error"):
            err = j["error"]
            raise FetchError(f"the service reported an error: {err.get('message') or err}")
        return j, full

    def arcgis_query(self, layer_url, params, *, save_as, layer=None, timeout=DEFAULT_TIMEOUT_S):
        """ArcGIS REST /query returning GeoJSON features (coordinates in outSR)."""
        p = {"outFields": "*", "f": "geojson", "returnGeometry": "true"}
        p.update(params)
        j, full = self.get_json(layer_url + "/query", p, save_as=save_as, layer=layer, timeout=timeout)
        feats = j.get("features") or []
        truncated = bool(j.get("exceededTransferLimit") or (j.get("properties") or {}).get("exceededTransferLimit"))
        return feats, full, truncated


def envelope_params(xmin, ymin, xmax, ymax, epsg=2272):
    return {
        "geometry": f"{xmin},{ymin},{xmax},{ymax}",
        "geometryType": "esriGeometryEnvelope",
        "inSR": epsg,
        "spatialRel": "esriSpatialRelIntersects",
        "outSR": epsg,
        "where": "1=1",
    }

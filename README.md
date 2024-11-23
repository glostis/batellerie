## Basemap

[Protomaps v4 is not (yet?) supported by protomaps-leaflet](https://github.com/protomaps/protomaps-leaflet/issues/177), so we stick to the latest v3 basemap available:
```bash
pmtiles extract https://build.protomaps.com/20240812.pmtiles static/map.pmtiles --bbox 2.6,49.25,3.1,49.55
```

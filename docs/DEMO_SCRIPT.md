# 3-minute demo script

Setup: `python scripts/dev.py --prod`, browser at http://127.0.0.1:8000, volume at about 50%. If real data is not loaded yet, say so up front: "the numbers you'll see are synthetic, the pipeline is real".

| Time | Show | Say |
|---|---|---|
| 0:00 | Home page, satellites orbiting | "Twenty-five years of satellite fire data, from two generations of sensors that can't be compared directly. KELVIN fixes that." |
| 0:15 | Leaderboard cards | "First screen for an emergency manager: which region is most unusual *right now*, compared with the same days in every earlier year." Click the top card. |
| 0:30 | Status banner | Read the headline aloud: "…1.4 times the historical median, 88th percentile, above normal." Point at the provisional flag and the k chip. |
| 0:45 | **Fire Jukebox → Hear the sensor jump** | "Listen to the raw record…" (the pitch leaps at 2012) "…now harmonized." (it flows). "That leap was a satellite change, not fire. Our harmonization removes it." |
| 1:15 | Harmonization tab | 12-month-sum chart: the grey raw stitch steps up at 2012, the red harmonized line doesn't. Scatter: scaled points on the 1:1 line. "Leave-one-year-out validation: about 3% error, rank correlation 0.99." |
| 1:40 | Calendar tab | "Every cell has its number, the colors are colorblind-safe, hatched means Terra-only estimate." Toggle **Anomaly**. Press arrow keys with **Tones on arrow keys** enabled to show it works with no mouse. |
| 2:05 | Click Nov of the peak year | Daily drill-down with the historical envelope; hotspots for that month light up on the map. Hit **Crackle** for two seconds. |
| 2:20 | Draw a rectangle on the map | New area analyzed in under a second. |
| 2:30 | Briefing & downloads | Plain-language briefing; click **Hotspots CSV** and show the header with the query and attribution; mention the print report. |
| 2:45 | Limitations panel | "A hotspot is not burned area or a cause; clouds hide fires; recent data is provisional. We show this everywhere." |
| 2:55 | Close | "KELVIN: one consistent calendar of Earth's fires, built on NASA FIRMS." |

Backup plan, if the network drops: map tiles go blank, but everything else (calendar, charts, sound, CSV) runs locally.

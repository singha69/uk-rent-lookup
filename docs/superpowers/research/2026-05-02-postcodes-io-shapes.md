# postcodes.io API response shapes — captured 2026-05-02

All three endpoints were hit live with `curl` from the dev machine on 2026-04-29
(filename uses the spec's logical date 2026-05-02). Response excerpts below are
verbatim from the live API, not invented.

## /postcodes/{prefix}/autocomplete
- Endpoint: https://api.postcodes.io/postcodes/IG1/autocomplete
- HTTP status: 200
- Response shape: `{ status: 200, result: string[] }`
- `result` is: an **array of full postcode strings** (e.g. `"IG1 1AR"`). NOT objects, NOT outward codes — full postcodes including incode.
- Default count: **10 entries** (no `limit` param sent).

Sample (full default response):
```json
{
    "status": 200,
    "result": [
        "IG1 1AR",
        "IG1 1AS",
        "IG1 1AT",
        "IG1 1BA",
        "IG1 1BE",
        "IG1 1BF",
        "IG1 1BH",
        "IG1 1BN",
        "IG1 1BP",
        "IG1 1BT"
    ]
}
```

Caveat: the spec assumed autocomplete would suggest distinct outward codes
(`IG1`, `IG10`, `IG11`). It does **not** — it returns 10 full postcodes that all
share the same outward code as the prefix (in this case all 10 start with
`IG1 1`). To produce outward-code suggestions the frontend must either:
(a) deduplicate by outward (which here yields just `IG1`), or
(b) issue a different query strategy (e.g. calling autocomplete for
`IG10`, `IG11` separately when the user types `IG1`), or
(c) accept the API's behaviour and show full postcodes in the dropdown.

## /outcodes/{code}
- Endpoint: https://api.postcodes.io/outcodes/IG1
- HTTP status: 200
- LA-code accessor (for our v2 code): **NOT AVAILABLE — this endpoint does not
  return GSS codes.** The response contains only display-name strings.
- LA-name accessor (display): `data.result.admin_district[0]`
- Multi-LA outcodes: when an outcode spans multiple LAs, response gives
  **array of values** (e.g. `E1` → `["Hackney", "City of London", "Tower Hamlets"]`).
  Decision for v2: **use first**.
  Justification: simpler, matches "primary LA" intuition for typeahead UX; we
  don't have population data to pick "largest" without another lookup.

Full response excerpt (note: NO `codes` sub-object here):
```json
{
    "status": 200,
    "result": {
        "outcode": "IG1",
        "longitude": 0.07342061470911103,
        "latitude": 51.559461927552,
        "admin_district": ["Redbridge"],
        "parish": ["Redbridge, unparished area"],
        "admin_county": [],
        "admin_ward": ["Cranbrook", "Loxford", "Valentines", "Mayfield",
                       "Wanstead Park", "Ilford Town", "Newbury", "Clementswood"],
        "country": ["England"],
        "parliamentary_constituency": ["Leyton and Wanstead", "Ilford North", "Ilford South"]
    }
}
```

Multi-LA confirmation (E1):
```json
{ "result": { "admin_district": ["Hackney", "City of London", "Tower Hamlets"] } }
```

**Workaround for getting a GSS code from an outcode**: hit
`/postcodes/{full_postcode}` for one of the postcodes returned by autocomplete,
then read `data.result.codes.admin_district`. Verified live with
`/postcodes/IG11AR` → `result.codes.admin_district == "E09000026"`.

Sample of that fallback path:
```json
{
    "status": 200,
    "result": {
        "postcode": "IG1 1AR",
        "admin_district": "Redbridge",
        "outcode": "IG1",
        "codes": {
            "admin_district": "E09000026",
            "admin_ward": "E05011246",
            "...": "..."
        }
    }
}
```

## /places?q={term}
- Endpoint: https://api.postcodes.io/places?q=ilford&limit=5
- HTTP status: 200
- LA-code accessor per place: **NOT AVAILABLE — this endpoint does not return
  a GSS code.** `place.code` is an OS Open Names identifier
  (e.g. `"osgb4000000074579136"`), not an LA GSS code.
- Place display-name accessor: `place.name_1`
- Place secondary text accessor (county/region): `place.county_unitary` (e.g.
  `"Greater London"`) or, when the place is finer-grained,
  `place.district_borough` (e.g. `"Redbridge"`). For LA-level UX,
  `place.district_borough || place.county_unitary` is the closest free-text
  match for "the LA this place lives in."

Sample (first 2 of 5 results for `q=ilford`):
```json
{
    "status": 200,
    "result": [
        {
            "code": "osgb4000000074574229",
            "name_1": "Ilford",
            "local_type": "Hamlet",
            "outcode": "TA19",
            "county_unitary": "Somerset",
            "county_unitary_type": "UnitaryAuthority",
            "district_borough": null,
            "district_borough_type": null,
            "region": "South West",
            "country": "England"
        },
        {
            "code": "osgb4000000074579136",
            "name_1": "Ilford",
            "local_type": "Other Settlement",
            "outcode": "IG1",
            "county_unitary": "Greater London",
            "county_unitary_type": "GreaterLondonAuthority",
            "district_borough": "Redbridge",
            "district_borough_type": "LondonBorough",
            "region": "London",
            "country": "England"
        }
    ]
}
```

Full set of keys per place object (verified):
`code, name_1, name_1_lang, name_2, name_2_lang, local_type, outcode,
county_unitary, county_unitary_type, district_borough, district_borough_type,
region, country, longitude, latitude, eastings, northings, min_eastings,
min_northings, max_eastings, max_northings`

No `local_authority_district_id`, no `codes` sub-object — the spec's guess at
those field names was wrong.

## Decisions for the suggestions.js implementation
- For outward codes (autocomplete results): NO direct accessor exists.
  Resolution path is two-step:
  1. From `/postcodes/{prefix}/autocomplete` take `data.result[i]` (a full
     postcode string).
  2. For one representative full postcode per outward, call
     `/postcodes/{postcode}` and read `data.result.codes.admin_district` →
     `area_code` (9-char GSS).
  Display string: the outward code (`postcode.split(" ")[0]`).
  Secondary string: `data.result.admin_district` (string, not array, on the
  postcodes endpoint).
- For places: NO direct GSS accessor exists. Use `place.outcode` to fall back
  through the postcode path: hit `/outcodes/{place.outcode}` → take
  `result.admin_district[0]` (LA name), then resolve LA name → GSS via the
  `REGIONS` table our Worker already owns. Alternatively, take a known postcode
  in that outcode (via autocomplete) and use the postcode path above.
- For places: `place.name_1` → display string.
- For places: `place.district_borough || place.county_unitary` → secondary string.

## Surprises / caveats
- **Major**: `/outcodes/{code}` does not return a `codes` object at all. The
  spec assumed `result.codes.admin_district` would yield a 9-char GSS — that
  field does not exist on this endpoint. Only the `/postcodes/{postcode}`
  endpoint returns GSS codes.
- **Major**: `/places` does not return a GSS code under any name
  (`local_authority_district_id`, `codes.admin_district`, etc. — none exist).
  The only LA signal is the `district_borough` name string. The Worker will
  need to map LA name → GSS via the existing `REGIONS` table.
- `/postcodes/{prefix}/autocomplete` returns 10 **full** postcodes by default,
  not outward codes. Typing `IG1` does not surface `IG10` and `IG11` as the
  spec assumed; it surfaces 10 postcodes whose outward all equals `IG1`. To
  show distinct outward suggestions the frontend has to do its own variant
  generation or accept full-postcode rows in the dropdown.
- An outcode lookup for `SW1` returns 404 ("Outcode not found"). Only fully
  qualified outcodes (`SW1A`, `SW1H`, …) exist. The `q` user enters may not
  always be a real outcode — frontend must tolerate 404s gracefully.
- Some postcodes returned by autocomplete are terminated (e.g. `IG1 1AA`,
  `IG1 1AB` are both `status: 404, terminated: {...}` on full lookup). Only
  some entries in the autocomplete list are live. The frontend must skip
  terminated postcodes when picking a representative for the GSS resolution.
- `/places` results are noisy: `q=ilford` returns Ilford (Somerset, hamlet)
  AS THE FIRST RESULT before Ilford (London). The frontend cannot blindly
  take `result[0]` — it should prefer entries with `district_borough_type`
  populated (i.e. urban LA-level) or otherwise rank by population/relevance.

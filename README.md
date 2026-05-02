# UK Rent Lookup

**Live:** https://rent-lookup.sap09777.workers.dev/

A free site that returns the average monthly rent for any UK postcode, sourced from the ONS Price Index of Private Rents and refreshed monthly.

## How it works

- **Frontend** ([`web/`](web/)) — static HTML/CSS/JS deployed on Cloudflare.
- **Worker** ([`worker/`](worker/)) — TypeScript Cloudflare Worker exposing `GET /lookup?postcode=…` at `https://uk-rent-lookup.sap09777.workers.dev`. Validates the postcode, resolves it to an area code via [postcodes.io](https://postcodes.io), then reads from a bundled JSON lookup table. Falls back from local-authority → region → country when finer-grained data isn't available for the postcode's area.
- **Data pipeline** ([`data/`](data/)) — Python script that scrapes the ONS PIPR landing page for the latest workbook URL, downloads the `.xlsx`, parses it, and writes [`worker/data/rents.json`](worker/data/rents.json). Also fetches the ONS Open Geography Portal LAD-to-Region lookup. Runs monthly via [GitHub Actions](.github/workflows/refresh-data.yml).

See [the design spec](docs/superpowers/specs/2026-04-29-uk-rent-lookup-design.md) and [implementation plan](docs/superpowers/plans/2026-04-29-uk-rent-lookup.md) for the full architecture.

## Local development

### Worker

```bash
cd worker
npm install
npm test
npx wrangler dev
```

### Data pipeline

```bash
cd data
python3.11 -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
pytest
python pipeline.py  # downloads the live PIPR workbook
```

### Frontend

```bash
cd web
python3 -m http.server 8000
```

## Deploying

- **Worker** — `cd worker && npx wrangler deploy`.
- **Data refresh** — runs automatically on the 1st of each month via [.github/workflows/refresh-data.yml](.github/workflows/refresh-data.yml). Manual run: `gh workflow run "Refresh rent data"`.

## Data sources

- **ONS Price Index of Private Rents (PIPR)** — monthly £ rental figures, Jan 2015 onwards, at local-authority granularity (England + Wales) and country-level for Scotland and Northern Ireland.
- **ONS Open Geography Portal** — Local Authority District to Region lookup (Dec 2024).
- **postcodes.io** — free public postcode-to-area resolver.

## License

MIT — see [LICENSE](LICENSE). (The repository owner's name is currently a placeholder; update before redistribution.)

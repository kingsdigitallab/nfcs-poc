# Demonstration Fixtures

> **These materials are held for demonstration and workshop purposes only.** The JSON search results are snapshots captured at a point in time from live federated services; they do not represent current service output and should not be cited as such. The collection texts are reproduced here solely to illustrate local-file workflows in the iDAH Federation Workflow PoC.

---

## Search result fixtures (`*.json`)

Pre-baked API responses loaded by the node's fixture toggle (📦) when live services are unavailable or inaccessible. Each file holds a `UnifiedRecord[]` array in the same format produced by a live run.

| File | Service | Query | Source |
|------|---------|-------|--------|
| `ariadneSearch-stonehenge.json` | ARIADNE | stonehenge | [portal.ariadne-infrastructure.eu](https://portal.ariadne-infrastructure.eu/) |
| `ariadneSearch-wordsworth.json` | ARIADNE | wordsworth | [portal.ariadne-infrastructure.eu](https://portal.ariadne-infrastructure.eu/) |
| `ariadneSearch-roman-coin.json` | ARIADNE | roman coin | [portal.ariadne-infrastructure.eu](https://portal.ariadne-infrastructure.eu/) |
| `europeanaSearch-stonehenge.json` | Europeana | stonehenge | [europeana.eu](https://www.europeana.eu/) |
| `europeanaSearch-wordsworth.json` | Europeana | wordsworth | [europeana.eu](https://www.europeana.eu/) |
| `europeanaSearch-roman-coin.json` | Europeana | roman coin | [europeana.eu](https://www.europeana.eu/) |
| `gbifSearch-stonehenge.json` | GBIF | stonehenge | [gbif.org](https://www.gbif.org/) |
| `gbifSearch-wordsworth.json` | GBIF | wordsworth | [gbif.org](https://www.gbif.org/) |
| `gbifSearch-roman-coin.json` | GBIF | roman coin | [gbif.org](https://www.gbif.org/) |
| `lldsSearch-stonehenge.json` | LLDS | stonehenge | [llds.ling-phil.ox.ac.uk](https://llds.ling-phil.ox.ac.uk/) |
| `mdsSearch-stonehenge.json` | Museum Data Service | stonehenge | [museumdata.uk](https://museumdata.uk/) |
| `mdsSearch-wordsworth.json` | Museum Data Service | wordsworth | [museumdata.uk](https://museumdata.uk/) |
| `mdsSearch-roman-coin.json` | Museum Data Service | roman coin | [museumdata.uk](https://museumdata.uk/) |

**Service acknowledgements**

- **ARIADNE Research Infrastructure** — pan-European portal aggregating archaeological research infrastructures. Data © respective contributing institutions.
- **Europeana** — aggregator for European cultural heritage institutions. Records © respective contributing institutions; made available under Europeana Data Exchange Agreement.
- **GBIF** (Global Biodiversity Information Facility) — open-access biodiversity occurrence data. Records published under a range of Creative Commons licences; see individual record metadata.
- **LLDS** (Language, Linguistics and DH Service, University of Oxford) — federated access to language and literary datasets.
- **Museum Data Service** — aggregator for UK museum collections. Records © respective contributing institutions.

---

## LLDS Collections (`LLDS Collections/`)

Sample collection items retrieved from the Language, Linguistics and DH Service (LLDS) and the Oxford Text Archive (OTA, University of Oxford). Provided here to demonstrate local-file ingestion via the **Local Folder Source** node.

### Stonehenge — `LLDS Collections/stonehenge/`

| Item | Title | Author(s) | Date | Rights |
|------|-------|-----------|------|--------|
| `ITEM@20.500.12024-A47049` | *The most notable antiquity of Great Britain, vulgarly called Stone-Heng on Salisbury Plain, restored* | Inigo Jones (1573–1652); ed. John Webb | 1655 (digitised 2003) | CC0 1.0 Universal |
| `ITEM@20.500.12024-A69727` | *Chorea gigantum, or, The most famous antiquity of Great-Britan, vulgarly called Stone-Heng, standing on Salisbury Plain, restored to the Danes* | Walter Charleton (1619–1707), with poems by Robert Howard and John Dryden | 1663 (digitised 2005) | CC0 1.0 Universal |

Both items are from the Early English Books Online Text Creation Partnership (EEBO-TCP Phase 1) and are published by the University of Oxford under the Creative Commons CC0 1.0 Universal licence. OTA persistent URLs: [purl.ox.ac.uk/ota/A47049](http://purl.ox.ac.uk/ota/A47049) · [purl.ox.ac.uk/ota/A69727](http://purl.ox.ac.uk/ota/A69727)

Each item folder contains: TEI-XML transcript, HTM rendering, EPUB, TSV (tab-separated text), METS manifest, Dublin Core metadata, OTA metadata, and local metadata.

### Wordsworth — `LLDS Collections/wordsworth/`

| Item | Title | Author | Rights |
|------|-------|--------|--------|
| `ota_20.500.14106_3137` | *The Excursion* | William Wordsworth (1770–1850) | See item metadata |
| `ota_20.500.14106_3138` | *The Prelude: an autobiographical poem* | William Wordsworth (1770–1850) | See item metadata |
| `ota_20.500_14106_0151` | *Lines Left upon a Seat in a Yew-Tree* (Lyrical Ballads) | William Wordsworth | See item metadata |
| `ota_20.500_14106_1704` | *Lyrical Ballads* | William Wordsworth & Samuel Taylor Coleridge | See item metadata |

Items deposited with the Oxford Text Archive by Jeffery Triggs (North American Reading Project / Oxford University Press). Distributed by the University of Oxford Text Archive.

---

## Usage at workshops

The JSON fixtures are loaded automatically by the workflow when a search node's 📦 fixture toggle is enabled — no manual file handling needed. Simply wire up a query, check 📦, and click **▶ Load fixture**.

The `LLDS Collections/` content is intended to be opened with the **Local Folder Source** node. Point the node at the relevant subdirectory (e.g. `public/fixtures/LLDS Collections/stonehenge`) after cloning this repository.

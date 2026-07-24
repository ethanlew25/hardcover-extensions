# Hardcover Extensions

A Paperback 0.8-compatible repository containing a deliberately small set of
readable, non-adult sources. It uses the same TypeScript source layout and
Paperback toolchain as Netsky's repository.

This repository is separate from the Hardcover iOS app. Hardcover does not
silently bundle or install it; a user must add the published repository URL
and approve each extension and its network hosts.

## Included sources

All included sources retain their upstream `MATURE` rating. They are not
relabeled as safe.

| Source | Website | Live audit |
| --- | --- | --- |
| Atsu | `atsu.moe` | Sort, status, type, and include/exclude genre filters through chapter pages |
| Public Domain Comics | `archive.org` | Six curated pre-1930 works with title, year, creator, and format filters through BookReader pages |
| MangaBall | `mangaball.net` | Sort, status, origin, demographic, match mode, and include/exclude catalog filters through chapter pages |
| MangaDemon | `demonicscans.org` | Sort, status, and include/exclude genre filters through chapter pages |
| MangaFox | `fanfox.net` | Type, completion, rating, and include/exclude genre filters through chapter pages |
| MangaHere | `mangahere.cc` | Type, completion, rating, and include/exclude genre filters through chapter pages |
| MangaKatana | `mangakatana.com` | Sort, status, minimum chapters, match mode, and include/exclude genre filters through chapter pages |
| McReader | `mgeko.cc` | Sort, status, type, rating, chapter count, availability, and include/exclude genre filters through chapter pages |
| Pepper&Carrot | `peppercarrot.com` | All complete English episodes and pages through the official documented API |
| WeebCentral | `weebcentral.com` | Adult-disabled sort, order, official, anime, status, type, and include/exclude genre filters through chapter pages |

Audit date: July 23, 2026. These websites are independently operated and can
change or stop working without notice.

Catalog-only sources are not published. MKissa was removed because its public
site does not provide manga chapter reading.

Pepper&Carrot uses the project's official episode index and image layout. The
comic is licensed CC BY 4.0, and the extension preserves creator and license
attribution in title details.

The Public Domain Comics source does not trust Internet Archive's uploader-set
license field as a general catalog filter. Its discovery list is restricted to
six manually curated works first published before 1930, and only those fixed
identifiers can be opened. Historical works may contain outdated or offensive
portrayals, so the source retains a `MATURE` rating even though explicit
material is not included.

MangaHasu was intentionally removed during the audit because its domain now
serves a parked advertising page. Upstream sources marked `ADULT`, sources
whose sites were unreachable, and sources that could not complete a live
content flow are also omitted.

Comix and MangaDot were evaluated on July 23, 2026 but are not included.
Comix's reader API requires a rotating client token that is not present in its
public server-rendered pages. MangaDot's public HTML does not expose a complete
chapter list, and its `robots.txt` explicitly disallows the API used by its web
client for that list. This repository does not reproduce access-control tokens
or call paths that a site has opted out of automated access.

MangaFire, MangaGo, and the requested `mmangafire.to` spelling were also
evaluated on July 23, 2026 but are not included. `mmangafire.to` does not
resolve, MangaFire's catalog and reader APIs require a private client token,
and `mangogo.me` is a parked domain rather than a working manga site.

## Local development

Requirements:

- Node.js 22.13 or newer
- pnpm 11.9

```sh
pnpm install
pnpm test
pnpm run serve
```

`pnpm test` type-checks the source, creates the Paperback repository under
`bundles/0.8`, and verifies the exact readable source set and generated files.
`pnpm run verify:live` additionally checks the current Pepper&Carrot API,
curated Internet Archive metadata/page maps, and a sample reader image.

## Publishing

Push `main` to a GitHub repository and enable GitHub Pages for the
`gh-pages` branch. The included workflow type-checks, bundles, and publishes
the `0.8` folder.

This repository publishes to:

```text
https://ethanlew25.github.io/hardcover-extensions/0.8
```

Add that HTTPS URL from Hardcover's Settings → Repositories screen.

## Adding another website

Create a folder under `src` with:

```text
src/Example/
├── Example.ts
├── ExampleParser.ts
└── includes/
    └── icon.png
```

The main source class should export its `SourceInfo` and implement the
Paperback interfaces it supports. Keep parsing in the parser file, declare an
accurate content rating, use HTTPS endpoints, and keep every runtime network
host as a literal in the compiled source so Hardcover can disclose it before
installation.

Before publishing a new source, verify:

1. Discover sections and pagination.
2. Search and tag filters.
3. Title metadata and chapter parsing.
4. Chapter page URLs and CDN hosts.
5. Cloudflare/login behavior.
6. The website's terms and your authorization to access and redistribute its
   content.

## Attribution and rights

The Netsky-derived source implementations retain their original author fields.
The Pepper&Carrot and Public Domain Comics implementations are original to
this repository. See `THIRD_PARTY_NOTICES.md` and `LICENSE`.

Extension code licensing does not grant rights to third-party website
content, names, logos, or services. Confirm those rights before publishing or
submitting an app that uses these extensions.

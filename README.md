# Hardcover Extensions

A Paperback 0.8-compatible repository containing a deliberately small set of
readable, non-explicit sources, including mature catalogs. It uses the same
TypeScript source layout and Paperback toolchain as Netsky's repository.

This repository is separate from the Hardcover iOS app. Hardcover does not
silently bundle or install it; a user must add the published repository URL
and approve each extension and its network hosts.

## Included sources

Source ratings are kept conservative: broad third-party catalogs are marked
`MATURE`, explicit-adult extensions are excluded, and sources are not relabeled
merely to make them easier to install.

| Source | Website | Live audit |
| --- | --- | --- |
| Atsu | `atsu.moe` | Comics and text novels; format, sort, status, type, and include/exclude genre filters |
| MangaDemon | `demonicscans.org` | Sort, status, and include/exclude genre filters through chapter pages |
| MangaDex | `mangadex.org` | Public API with popularity/latest/year/status/origin/demographic sorting and include/exclude tag filters through chapter pages |
| McReader | `mgeko.cc` | Sort, status, type, rating, chapter count, availability, and include/exclude genre filters through chapter pages |
| Pepper&Carrot | `peppercarrot.com` | All complete English episodes and pages through the official documented API |
| WeebCentral | `weebcentral.com` | Adult-disabled sort, order, official, anime, status, type, and include/exclude genre filters through its rotating page CDNs |

Audit date: August 10, 2026. These websites are independently operated and can
change or stop working without notice.

Atsu 1.2.1 routes page images, covers, and banners through Atsu's current image
CDN instead of the old site URLs that return HTTP 410. It also publishes text
novel support, which was missing from the previously published 1.1.2 bundle.

Text novels require Hardcover builds that advertise text-chapter
support. Older app builds continue to show comics only and display an update
message if a saved novel is opened. In supported builds, use Explore's **Format
→ Text novels** filter; genre and sorting selections can be combined with it.
This changes the reading format, not the source's existing content-rating policy.

Existing users should refresh this repository and update the installed Atsu
extension to **1.2.1**. Review and approve its disclosed network hosts if prompted,
then close and reopen the affected chapter to fetch fresh page addresses.

Atsu live verification on September 24, 2026 passed for sampled images from
Revenge of the Baskerville Bloodhound chapters 1 and 181, Shadow Slave chapter 1,
and both previously reported Lord of Mysteries chapter IDs (`1pNA5W`, `5nDftC`).
The checks cover novel discovery, title metadata, chapter lists, text parsing,
and opening a chapter in a fresh runtime without a prior title-details request.

Catalog-only sources are not published. MKissa was removed because its public
site does not provide manga chapter reading.

Pepper&Carrot uses the project's official episode index and image layout. The
comic is licensed CC BY 4.0, and the extension preserves creator and license
attribution in title details.

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

MangaBall, MangaFox, MangaHere, and MangaKatana were removed after the August
10 reader audit. MangaBall failed its title flow with HTTP 403, MangaFox's
first reader image returned HTTP 403, MangaHere returned no chapter pages, and
MangaKatana was removed because its repeated throttling made library covers and
refreshes unreliable in normal app use. MangaDex replaces them with a public,
JSON API-backed source restricted to English chapters and MangaDex's `safe`
and `suggestive` content ratings. The `erotica` and `pornographic` ratings stay
excluded.

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
`pnpm run verify:live` additionally checks the current Pepper&Carrot API and
MangaDex discovery through an actual reader image.
`pnpm run verify:atsu:live` checks Atsu comic CDN images, novel discovery and
text chapters, fresh-runtime resume, and the older-client update message.

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
The Pepper&Carrot and MangaDex implementations are original to this repository.
See `THIRD_PARTY_NOTICES.md` and `LICENSE`.

Extension code licensing does not grant rights to third-party website
content, names, logos, or services. Confirm those rights before publishing or
submitting an app that uses these extensions.

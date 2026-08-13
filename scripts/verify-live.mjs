const pepperDomain = 'https://www.peppercarrot.com'
const archiveDomain = 'https://archive.org'
const mangaDexAPI = 'https://api.mangadex.org'
const curatedArchiveIDs = [
    'LittleNemo1905-1914ByWinsorMccay',
    'BringingUpFatherSeries1',
    'gri_33125014432740',
    'socialladd00gibs',
    'cartoonsselected00tenn',
    'comichistoryofro01be'
]

const episodes = await getJSON(`${pepperDomain}/0_sources/episodes.json`)
const englishEpisodes = episodes.filter(episode =>
    Array.isArray(episode.translated_languages)
    && episode.translated_languages.includes('en')
)
if (englishEpisodes.length === 0) {
    throw new Error('Pepper&Carrot returned no complete English episodes')
}
const firstEpisode = englishEpisodes[0]
const episodeNumber = Number(/^ep(\d+)_/.exec(firstEpisode.name)?.[1])
const firstPage = `${pepperDomain}/0_sources/${firstEpisode.name}/low-res/`
    + `en_Pepper-and-Carrot_by-David-Revoy_E${String(episodeNumber).padStart(2, '0')}P00.jpg`
await expectImage(firstPage)

let sampleArchivePage
for (const identifier of curatedArchiveIDs) {
    const metadata = await getJSON(`${archiveDomain}/metadata/${encodeURIComponent(identifier)}`)
    if (metadata.metadata?.identifier !== identifier || metadata.metadata?.mediatype !== 'texts') {
        throw new Error(`Invalid Internet Archive metadata for ${identifier}`)
    }
    const scandata = metadata.files?.find(file => file.name?.endsWith('_scandata.xml'))
    if (!scandata) throw new Error(`Missing BookReader page map for ${identifier}`)
    const xml = await getText(
        `${archiveDomain}/download/${encodeURIComponent(identifier)}/${encodeURIComponent(scandata.name)}`
    )
    const leaves = readableLeaves(xml)
    if (leaves.length === 0) throw new Error(`No readable BookReader leaves for ${identifier}`)
    sampleArchivePage ??= `${archiveDomain}/download/${encodeURIComponent(identifier)}/page/n${leaves[0]}_w800.jpg`
}

await expectImage(sampleArchivePage)
const mangaDexPage = await readableMangaDexPage()
await expectImage(mangaDexPage)
console.log(
    `Live verification passed for ${englishEpisodes.length} Pepper&Carrot episodes `
    + `${curatedArchiveIDs.length} public-domain works, and MangaDex discovery through reader pages.`
)

async function getJSON(url) {
    const response = await fetchWithRetry(url)
    if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`)
    return response.json()
}

async function getText(url) {
    const response = await fetchWithRetry(url)
    if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`)
    return response.text()
}

async function expectImage(url) {
    const response = await fetchWithRetry(url)
    if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`)
    const contentType = response.headers.get('content-type') ?? ''
    if (!contentType.startsWith('image/')) {
        throw new Error(`${url} returned ${contentType || 'an unknown content type'}`)
    }
}

async function readableMangaDexPage() {
    const parameters = new URLSearchParams([
        ['limit', '10'],
        ['availableTranslatedLanguage[]', 'en'],
        ['contentRating[]', 'safe'],
        ['contentRating[]', 'suggestive'],
        ['hasAvailableChapters', 'true'],
        ['includes[]', 'cover_art'],
        ['order[latestUploadedChapter]', 'desc']
    ])
    const catalog = await getJSON(`${mangaDexAPI}/manga?${parameters}`)
    for (const manga of catalog.data ?? []) {
        if (!['safe', 'suggestive'].includes(manga.attributes?.contentRating)) continue
        const feedParameters = new URLSearchParams([
            ['limit', '10'],
            ['translatedLanguage[]', 'en'],
            ['contentRating[]', 'safe'],
            ['contentRating[]', 'suggestive'],
            ['includeExternalUrl', '0'],
            ['order[publishAt]', 'desc']
        ])
        const feed = await getJSON(`${mangaDexAPI}/manga/${manga.id}/feed?${feedParameters}`)
        const chapter = feed.data?.find(item =>
            Number(item.attributes?.pages) > 0 && !item.attributes?.externalUrl
        )
        if (!chapter) continue

        const server = await getJSON(`${mangaDexAPI}/at-home/server/${chapter.id}?forcePort443=true`)
        const baseURL = String(server.baseUrl ?? '').replace(/\/$/, '')
        const hash = server.chapter?.hash
        const file = server.chapter?.data?.[0]
        if (!/^https:\/\/([a-z0-9-]+\.)*mangadex\.network(?=[:/]|$)/i.test(baseURL)) continue
        if (hash && file) return `${baseURL}/data/${hash}/${file}`
    }
    throw new Error('MangaDex returned no readable non-explicit English chapter pages')
}

async function fetchWithRetry(url) {
    let response
    for (let attempt = 0; attempt < 2; attempt += 1) {
        response = await fetch(url, {
            headers: { 'user-agent': 'Hardcover extension live verifier/1.0' },
            redirect: 'follow'
        })
        if (response.ok || (response.status !== 429 && response.status < 500)) return response
    }
    return response
}

function readableLeaves(xml) {
    const leaves = []
    const pagePattern = /<page\b[^>]*\bleafNum="(\d+)"[^>]*>([\s\S]*?)<\/page>/gi
    let match
    while ((match = pagePattern.exec(xml)) !== null) {
        if (/<addToAccessFormats>\s*false\s*<\/addToAccessFormats>/i.test(match[2] ?? '')) continue
        leaves.push(Number(match[1]))
    }
    return leaves.filter(Number.isFinite)
}

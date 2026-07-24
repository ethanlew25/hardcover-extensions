const pepperDomain = 'https://www.peppercarrot.com'
const archiveDomain = 'https://archive.org'
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
console.log(
    `Live verification passed for ${englishEpisodes.length} Pepper&Carrot episodes `
    + `and ${curatedArchiveIDs.length} public-domain works.`
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

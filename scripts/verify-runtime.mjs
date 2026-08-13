import {
    createRequire
} from 'node:module'
import path from 'node:path'
import {
    fileURLToPath
} from 'node:url'

const require = createRequire(import.meta.url)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'bundles', '0.8')
const identity = value => value ?? {}

globalThis.App = {
    createChapter: identity,
    createChapterDetails: identity,
    createHomeSection: identity,
    createMangaInfo: identity,
    createPagedResults: value => ({ results: [], ...(value ?? {}) }),
    createPartialSourceManga: identity,
    createRequest: value => ({ headers: {}, ...(value ?? {}) }),
    createSourceManga: identity,
    createTag: identity,
    createTagSection: identity,
    createRequestManager: () => ({
        getDefaultUserAgent: async () => 'Hardcover runtime verifier/1.0',
        schedule: async () => {
            throw new Error('Unexpected live request in bundle runtime verification')
        }
    })
}

await verifyPepperCarrot()
await verifyInternetArchive()
await verifyMangaDex()
await verifyAtsu()
console.log('Verified bundled discovery and reader flows for the tested sources.')

async function verifyAtsu() {
    const bundle = require(path.join(root, 'Atsu', 'source.js')).Sources
    const source = new bundle.Atsu()
    const releasedAt = Date.UTC(2026, 7, 10, 12, 34, 56)
    source.requestManager.schedule = async request => {
        assert(
            request.url.includes('/api/manga/allChapters?'),
            `Atsu used an unexpected chapter endpoint: ${request.url}`
        )
        return {
            status: 200,
            data: JSON.stringify({
                chapters: [{
                    id: 'fixture-chapter',
                    title: 'Chapter 12',
                    number: 12,
                    index: 11,
                    createdAt: releasedAt
                }]
            })
        }
    }

    const chapters = await source.getChapters('fixture-manga')
    assert(chapters.length === 1, 'Atsu chapter parsing failed')
    assert(
        chapters[0].time instanceof Date && chapters[0].time.getTime() === releasedAt,
        'Atsu did not preserve the chapter release date'
    )
}

async function verifyPepperCarrot() {
    const bundle = require(path.join(root, 'PepperCarrot', 'source.js')).Sources
    const source = new bundle.PepperCarrot()
    const episodes = [{
        name: 'ep01_Potion-of-Flight',
        total_pages: 4,
        translated_languages: ['en']
    }]
    source.requestManager.schedule = async () => ({
        status: 200,
        data: JSON.stringify(episodes)
    })

    const sections = []
    await source.getHomePageSections(section => sections.push(section))
    assert(sections.length === 1 && sections[0].items.length === 1, 'Pepper&Carrot home section is invalid')

    const results = await source.getSearchResults({ title: 'Pepper' }, undefined)
    assert(results.results.length === 1, 'Pepper&Carrot search did not find the title')
    const chapters = await source.getChapters('pepper-and-carrot')
    assert(chapters.length === 1 && chapters[0].id === episodes[0].name, 'Pepper&Carrot chapter parsing failed')
    const details = await source.getChapterDetails('pepper-and-carrot', episodes[0].name)
    assert(details.pages.length === 5, 'Pepper&Carrot page parsing failed')
}

async function verifyInternetArchive() {
    const bundle = require(path.join(root, 'InternetArchiveComics', 'source.js')).Sources
    const source = new bundle.InternetArchiveComics()
    const identifier = 'LittleNemo1905-1914ByWinsorMccay'
    const scandataName = `${identifier}_scandata.xml`
    const metadata = {
        metadata: {
            identifier,
            title: 'Little Nemo',
            creator: 'Winsor McCay',
            mediatype: 'texts',
            language: 'eng'
        },
        files: [{ name: scandataName }]
    }
    const scandata = [
        '<book><pageData>',
        '<page leafNum="0"><addToAccessFormats>true</addToAccessFormats></page>',
        '<page leafNum="1"><addToAccessFormats>false</addToAccessFormats></page>',
        '<page leafNum="2"><pageType>Normal</pageType></page>',
        '</pageData></book>'
    ].join('')
    source.requestManager.schedule = async request => ({
        status: 200,
        data: request.url.includes('/metadata/') ? JSON.stringify(metadata) : scandata
    })

    const sections = []
    await source.getHomePageSections(section => sections.push(section))
    const homeIDs = new Set(sections.flatMap(section => section.items.map(item => item.mangaId)))
    assert(homeIDs.size === 6, 'Public Domain Comics home discovery is incomplete')

    const results = await source.getSearchResults({ title: 'Little Nemo' }, undefined)
    assert(results.results.length === 1 && results.results[0].mangaId === identifier, 'Curated archive search failed')
    const chapters = await source.getChapters(identifier)
    assert(chapters.length === 1 && chapters[0].id === 'full-issue', 'Curated archive chapter parsing failed')
    const details = await source.getChapterDetails(identifier, 'full-issue')
    assert(details.pages.length === 2, 'Curated archive page-map parsing failed')
    assert(details.pages.every(page => page.startsWith('https://archive.org/')), 'Archive returned an unapproved page host')
}

async function verifyMangaDex() {
    const bundle = require(path.join(root, 'MangaDex', 'source.js')).Sources
    const source = new bundle.MangaDex()
    const mangaID = '11111111-1111-4111-8111-111111111111'
    const chapterID = '22222222-2222-4222-8222-222222222222'
    const safeManga = {
        id: mangaID,
        type: 'manga',
        attributes: {
            title: { en: 'Fixture Manga' },
            altTitles: [{ 'ja-ro': 'Fixture Romanized' }],
            description: { en: 'Fixture description' },
            contentRating: 'safe',
            originalLanguage: 'ja',
            publicationDemographic: 'shounen',
            status: 'ongoing',
            year: 2026,
            lastChapter: '12',
            tags: [{
                id: '33333333-3333-4333-8333-333333333333',
                attributes: { group: 'genre', name: { en: 'Adventure' } }
            }]
        },
        relationships: [
            { type: 'cover_art', id: 'cover', attributes: { fileName: 'cover.jpg' } },
            { type: 'author', id: 'author', attributes: { name: 'Fixture Author' } }
        ]
    }
    const blockedManga = {
        ...safeManga,
        id: '44444444-4444-4444-8444-444444444444',
        attributes: { ...safeManga.attributes, contentRating: 'pornographic' }
    }
    const suggestiveManga = {
        ...safeManga,
        id: '66666666-6666-4666-8666-666666666666',
        attributes: {
            ...safeManga.attributes,
            title: { en: 'Fixture Mature Manga' },
            contentRating: 'suggestive'
        }
    }
    const chapter = {
        id: chapterID,
        type: 'chapter',
        attributes: {
            chapter: '12',
            volume: '2',
            pages: 2,
            translatedLanguage: 'en',
            publishAt: '2026-08-10T00:00:00Z'
        },
        relationships: [{ type: 'scanlation_group', id: 'group', attributes: { name: 'Fixture Group' } }]
    }
    const externalChapter = {
        ...chapter,
        id: '55555555-5555-4555-8555-555555555555',
        attributes: { ...chapter.attributes, chapter: '13', pages: 0, externalUrl: 'https://example.com' }
    }

    source.requestManager.schedule = async request => {
        if (request.url.includes('/manga/tag')) {
            return { status: 200, data: JSON.stringify({ result: 'ok', data: safeManga.attributes.tags }) }
        }
        if (request.url.includes('/feed?')) {
            const ratings = new URL(request.url).searchParams.getAll('contentRating[]')
            assert(
                ratings.includes('safe') && ratings.includes('suggestive'),
                'MangaDex chapter requests do not include both non-explicit ratings'
            )
            return {
                status: 200,
                data: JSON.stringify({ result: 'ok', data: [chapter, externalChapter], total: 2 })
            }
        }
        if (request.url.includes('/at-home/server/')) {
            return {
                status: 200,
                data: JSON.stringify({
                    baseUrl: 'https://reader.mangadex.network',
                    chapter: { hash: 'fixture-hash', data: ['001.jpg', '002.jpg'] }
                })
            }
        }
        if (request.url.includes(`/manga/${mangaID}?`)) {
            return { status: 200, data: JSON.stringify({ result: 'ok', data: safeManga }) }
        }
        if (request.url.includes(`/manga/${suggestiveManga.id}?`)) {
            return { status: 200, data: JSON.stringify({ result: 'ok', data: suggestiveManga }) }
        }
        if (request.url.includes(`/manga/${blockedManga.id}?`)) {
            return { status: 200, data: JSON.stringify({ result: 'ok', data: blockedManga }) }
        }
        if (request.url.includes('/manga?')) {
            const ratings = new URL(request.url).searchParams.getAll('contentRating[]')
            assert(
                ratings.includes('safe') && ratings.includes('suggestive'),
                'MangaDex discovery requests do not include both non-explicit ratings'
            )
            return {
                status: 200,
                data: JSON.stringify({
                    result: 'ok',
                    data: [safeManga, suggestiveManga, blockedManga],
                    total: 3
                })
            }
        }
        throw new Error(`Unexpected MangaDex fixture request: ${request.url}`)
    }

    const sections = []
    await source.getHomePageSections(section => sections.push(section))
    assert(sections.every(section => section.items.length === 2), 'MangaDex home did not allow non-explicit mature results')

    const tags = await source.getSearchTags()
    assert(tags.some(section => section.label === 'Genres'), 'MangaDex genre discovery filters are missing')
    const results = await source.getSearchResults({ title: 'Fixture' }, undefined)
    assert(results.results.length === 2, 'MangaDex search did not enforce non-explicit mature results')
    const details = await source.getMangaDetails(mangaID)
    assert(details.mangaInfo.author === 'Fixture Author', 'MangaDex title relationship parsing failed')
    const suggestiveDetails = await source.getMangaDetails(suggestiveManga.id)
    assert(
        suggestiveDetails.mangaInfo.titles[0] === 'Fixture Mature Manga',
        'MangaDex suggestive title details were rejected'
    )
    let blockedDetails = false
    try {
        await source.getMangaDetails(blockedManga.id)
    } catch {
        blockedDetails = true
    }
    assert(blockedDetails, 'MangaDex explicit title details were not rejected')
    const chapters = await source.getChapters(mangaID)
    assert(chapters.length === 1 && chapters[0].id === chapterID, 'MangaDex readable chapter filtering failed')
    const chapterDetails = await source.getChapterDetails(mangaID, chapterID)
    assert(chapterDetails.pages.length === 2, 'MangaDex at-home page parsing failed')
    assert(
        chapterDetails.pages.every(page => page.startsWith('https://reader.mangadex.network/data/fixture-hash/')),
        'MangaDex returned an unapproved page host'
    )
}

function assert(condition, message) {
    if (!condition) throw new Error(message)
}

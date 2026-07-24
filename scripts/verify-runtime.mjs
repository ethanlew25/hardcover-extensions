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
console.log('Verified bundled discovery and reader flows for the new sources.')

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

function assert(condition, message) {
    if (!condition) throw new Error(message)
}

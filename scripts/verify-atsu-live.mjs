import { createRequire } from 'node:module'
import { strict as assert } from 'node:assert'

// Opt-in network test: validate the built extension against current API data,
// without printing novel text or downloading every chapter image.
const require = createRequire(import.meta.url)
const identity = value => value ?? {}
const requests = []
globalThis.App = {
    supportsTextChapters: true,
    ...Object.fromEntries([
        'createChapter', 'createChapterDetails', 'createHomeSection',
        'createMangaInfo', 'createPartialSourceManga', 'createSourceManga',
        'createTag', 'createTagSection'
    ].map(name => [name, identity])),
    createPagedResults: value => ({ results: [], ...value }),
    createRequest: value => ({ headers: {}, ...value }),
    createRequestManager: () => ({
        getDefaultUserAgent: async () => 'Hardcover extension live verifier/1.0',
        schedule: async request => {
            const url = new URL(request.url)
            assert.equal(url.origin, 'https://atsu.moe')
            requests.push(url.pathname)
            const response = await fetch(url, {
                headers: { accept: 'application/json', referer: 'https://atsu.moe/' },
                signal: AbortSignal.timeout(20000)
            })
            return { status: response.status, data: await response.text() }
        }
    })
}

const { Atsu, AtsuInfo } = require('../bundles/0.8/Atsu/source.js').Sources
const source = new Atsu()
const comicID = 'OaKBx'
const comic = await source.getMangaDetails(comicID)
assert.equal(comic.mangaInfo.titles[0], 'Revenge of the Baskerville Bloodhound')
await expectImage(comic.mangaInfo.image)
const chapters = await source.getChapters(comicID)
for (const chapterID of ['sEXa53', 'Qhw_Kr']) {
    assert(chapters.some(chapter => chapter.id === chapterID), `Missing comic chapter ${chapterID}`)
    const details = await source.getChapterDetails(comicID, chapterID)
    assert(details.pages.length > 0)
    assert(details.pages.every(url => new URL(url).origin === 'https://cdn.atsu.moe'))
    await expectImage(details.pages[0])
    await expectImage(details.pages.at(-1))
    console.log(`Comic ${chapterID}: ${details.pages.length} pages; sampled images available.`)
}

for (const [title, mangaID, reportedChapterID] of [
    ['Shadow Slave', '8kL3', 'H51rMO'],
    ['Lord of Mysteries', 'slh2', '1pNA5W'],
    ['Lord of Mysteries', 'slh2', '5nDftC']
]) {
    const novel = new Atsu()
    const tags = await novel.getSearchTags()
    const format = tags.find(section => section.label === 'Format')
    const novelTag = format?.tags.find(tag => tag.label === 'Text novels')
    assert(novelTag, 'Text-novel discovery filter missing')
    const search = await novel.getSearchResults({ title, includedTags: [novelTag] })
    assert(search.results.some(result => result.mangaId === mangaID), `Novel search missed ${title}`)
    const metadata = await novel.getMangaDetails(mangaID)
    assert.equal(metadata.mangaInfo.additionalInfo.Type, 'Text Novel')
    const novelChapters = await novel.getChapters(mangaID)
    assert(novelChapters.some(chapter => chapter.id === reportedChapterID), `Reported chapter missing from ${title}`)

    const start = requests.length
    const details = await novel.getChapterDetails(mangaID, reportedChapterID)
    assert.equal(requests.length - start, 1, 'Known novel must go directly to the text endpoint')
    assert.equal(details.type, 'text')
    assert(details.paragraphs.length > 0 && details.paragraphs.every(p => typeof p === 'string' && p.trim()))
    assert.equal(details.pages.length, 0)

    // Continue Reading may initialize a runtime without fetching title metadata.
    const fresh = new Atsu()
    const resumed = await fresh.getChapterDetails(mangaID, reportedChapterID)
    assert.deepEqual(resumed, details)
    console.log(`${title}: discovery, chapter list, ${details.paragraphs.length} text paragraphs, and fresh-runtime resume passed.`)
}

App.supportsTextChapters = false
const legacy = new Atsu()
assert(!(await legacy.getSearchTags()).some(section => section.label === 'Format'))
await assert.rejects(legacy.getChapterDetails('slh2', '5nDftC'), /text novel.*[Uu]pdate Hardcover/)
console.log(`Atsu ${AtsuInfo.version}: live comic, novel and older-client checks passed.`)

async function expectImage(url) {
    assert.equal(new URL(url).origin, 'https://cdn.atsu.moe')
    const response = await fetch(url, {
        method: 'HEAD', headers: { referer: 'https://atsu.moe/' },
        signal: AbortSignal.timeout(20000)
    })
    assert(response.ok, `Image returned HTTP ${response.status}: ${url}`)
    assert(response.headers.get('content-type')?.startsWith('image/'), `Not an image: ${url}`)
}

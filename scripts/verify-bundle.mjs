import { access, readFile } from 'node:fs/promises'
import path from 'node:path'

const root = path.resolve('bundles/0.8')
const manifest = JSON.parse(await readFile(path.join(root, 'versioning.json'), 'utf8'))
const expectedIDs = [
    'Atsu',
    'MKissa',
    'MangaBall',
    'MangaDemon',
    'MangaFox',
    'MangaHere',
    'MangaKatana',
    'McReader',
    'WeebCentral'
]
const actualIDs = manifest.sources.map((source) => source.id).sort()

if (JSON.stringify(actualIDs) !== JSON.stringify(expectedIDs)) {
    throw new Error(`Unexpected source set: ${actualIDs.join(', ')}`)
}
if (manifest.builtWith?.types !== '0.8.7') {
    throw new Error(`Expected Paperback types 0.8.7, found ${manifest.builtWith?.types ?? 'unknown'}`)
}

for (const source of manifest.sources) {
    if (source.contentRating === 'ADULT') {
        throw new Error(`${source.id} is marked ADULT and must not be published`)
    }
    if (!source.websiteBaseURL?.startsWith('https://')) {
        throw new Error(`${source.id} does not declare an HTTPS websiteBaseURL`)
    }
    await access(path.join(root, source.id, 'source.js'))
    await access(path.join(root, source.id, 'includes', source.icon))
}

const requiredRuntimeHosts = {
    Atsu: 'https://atsu.moe',
    MKissa: 'https://aln.youtube-anime.com',
    MangaBall: 'https://poke-black-and-white.net',
    MangaDemon: 'https://cdn.demoniclibs.com',
    MangaFox: 'https://zjcdn.mangafox.me',
    MangaHere: 'https://zjcdn.mangahere.org',
    McReader: 'https://imgsrv4.com',
    WeebCentral: 'https://lowee.us'
}

const mkissa = manifest.sources.find((source) => source.id === 'MKissa')
if (mkissa?.intents !== 4) {
    throw new Error(`MKissa must remain catalog-only (homepage intent 4), found ${mkissa?.intents ?? 'missing'}`)
}
for (const [sourceID, runtimeHost] of Object.entries(requiredRuntimeHosts)) {
    const bundle = await readFile(path.join(root, sourceID, 'source.js'), 'utf8')
    if (!bundle.includes(runtimeHost)) {
        throw new Error(`${sourceID} runtime host ${runtimeHost} is missing from the compiled bundle`)
    }
}

console.log(`Verified Paperback 0.8 repository with ${actualIDs.length} non-adult sources.`)

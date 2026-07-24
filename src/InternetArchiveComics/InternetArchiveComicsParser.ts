import {
    Chapter,
    ChapterDetails,
    PartialSourceManga,
    SourceManga,
    TagSection
} from '@paperback/types'

const ARCHIVE_DOMAIN = 'https://archive.org'

export interface CuratedArchiveItem {
    identifier: string
    title: string
    creator: string
    year: number
    category: 'sequential' | 'cartoons' | 'satire'
    categoryLabel: string
}

export const CURATED_ARCHIVE_ITEMS: CuratedArchiveItem[] = [
    {
        identifier: 'LittleNemo1905-1914ByWinsorMccay',
        title: 'Little Nemo (1905–1914)',
        creator: 'Winsor McCay',
        year: 1905,
        category: 'sequential',
        categoryLabel: 'Sequential Comics'
    },
    {
        identifier: 'BringingUpFatherSeries1',
        title: 'Bringing Up Father, Series 1',
        creator: 'George McManus',
        year: 1919,
        category: 'sequential',
        categoryLabel: 'Sequential Comics'
    },
    {
        identifier: 'gri_33125014432740',
        title: 'Gibson New Cartoons',
        creator: 'Charles Dana Gibson',
        year: 1916,
        category: 'cartoons',
        categoryLabel: 'Cartoon Collections'
    },
    {
        identifier: 'socialladd00gibs',
        title: 'The Social Ladder',
        creator: 'Charles Dana Gibson',
        year: 1902,
        category: 'cartoons',
        categoryLabel: 'Cartoon Collections'
    },
    {
        identifier: 'cartoonsselected00tenn',
        title: 'Cartoons Selected from Punch',
        creator: 'John Tenniel',
        year: 1901,
        category: 'cartoons',
        categoryLabel: 'Cartoon Collections'
    },
    {
        identifier: 'comichistoryofro01be',
        title: 'The Comic History of Rome',
        creator: 'Gilbert Abbott à Beckett and John Leech',
        year: 1850,
        category: 'satire',
        categoryLabel: 'Illustrated Satire'
    }
]

export interface ArchiveMetadataResponse {
    metadata: {
        identifier: string
        title?: string | string[]
        description?: string | string[]
        creator?: string | string[]
        date?: string | string[]
        language?: string | string[]
        subject?: string | string[]
        mediatype?: string
    }
    files: Array<{
        name: string
        format?: string
    }>
}

export function parseJSON<T>(data: unknown): T {
    return (typeof data === 'string' ? JSON.parse(data) : data) as T
}

export function partialManga(item: CuratedArchiveItem): PartialSourceManga {
    return App.createPartialSourceManga({
        mangaId: item.identifier,
        title: item.title,
        image: `${ARCHIVE_DOMAIN}/services/img/${encodeURIComponent(item.identifier)}`,
        subtitle: `${item.creator} • ${item.year}`
    })
}

export function assertReadableCuratedItem(
    response: ArchiveMetadataResponse,
    item: CuratedArchiveItem
): void {
    if (response.metadata.identifier !== item.identifier) {
        throw new Error('Internet Archive returned metadata for a different item.')
    }
    if (response.metadata.mediatype !== 'texts') {
        throw new Error('This curated Internet Archive item is not a readable text item.')
    }
    if (!response.files.some(file => file.name.endsWith('_scandata.xml'))) {
        throw new Error('This curated item does not expose BookReader page metadata.')
    }
}

export function metadataManga(
    response: ArchiveMetadataResponse,
    item: CuratedArchiveItem
): SourceManga {
    assertReadableCuratedItem(response, item)
    const metadata = response.metadata
    const subjects = uniqueStrings(strings(metadata.subject)).slice(0, 30)
    const tags: TagSection[] = subjects.length > 0
        ? [App.createTagSection({
            id: 'subjects',
            label: 'Subjects',
            tags: subjects.map(label => App.createTag({
                id: label.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
                label
            }))
        })]
        : []

    return App.createSourceManga({
        id: item.identifier,
        mangaInfo: App.createMangaInfo({
            titles: uniqueStrings([item.title, ...strings(metadata.title)]),
            image: `${ARCHIVE_DOMAIN}/services/img/${encodeURIComponent(item.identifier)}`,
            status: 'Completed',
            author: item.creator,
            artist: item.creator,
            desc: stripHTML(firstString(metadata.description))
                || `${item.title}, first published in ${item.year}.`,
            hentai: false,
            tags,
            additionalInfo: {
                Rights: 'Curated public-domain work',
                Publication: String(item.year),
                Format: item.categoryLabel,
                Host: 'Internet Archive'
            }
        })
    })
}

export function chapters(
    response: ArchiveMetadataResponse,
    item: CuratedArchiveItem
): Chapter[] {
    assertReadableCuratedItem(response, item)
    return [
        App.createChapter({
            id: 'full-issue',
            name: 'Full issue',
            chapNum: 1,
            sortingIndex: 1,
            langCode: languageCode(firstString(response.metadata.language)),
            group: 'Internet Archive'
        })
    ]
}

export function chapterDetails(
    response: ArchiveMetadataResponse,
    item: CuratedArchiveItem,
    scandata: unknown,
    imageRedirectScope: string
): ChapterDetails {
    assertReadableCuratedItem(response, item)
    const xml = typeof scandata === 'string' ? scandata : String(scandata ?? '')
    const pages: string[] = []
    const pagePattern = /<page\b[^>]*\bleafNum="(\d+)"[^>]*>([\s\S]*?)<\/page>/gi
    let match: RegExpExecArray | null
    while ((match = pagePattern.exec(xml)) !== null) {
        if (/<addToAccessFormats>\s*false\s*<\/addToAccessFormats>/i.test(match[2] ?? '')) continue
        const leaf = Number(match[1])
        if (!Number.isFinite(leaf)) continue
        pages.push(`${ARCHIVE_DOMAIN}/download/${encodeURIComponent(item.identifier)}/page/n${leaf}_w1600.jpg`)
    }
    if (pages.length === 0) {
        throw new Error(`No readable BookReader pages were found. Expected image delivery beneath ${imageRedirectScope}.`)
    }
    if (pages.length > 1000) {
        throw new Error('This item exceeds the source’s 1,000-page safety limit.')
    }
    return App.createChapterDetails({
        id: 'full-issue',
        mangaId: item.identifier,
        pages
    })
}

function languageCode(value: string): string {
    switch (value.toLowerCase()) {
        case 'eng':
        case 'english':
        case 'en':
            return 'en'
        default:
            return value.slice(0, 2).toLowerCase() || 'en'
    }
}

function firstString(value: string | string[] | undefined): string {
    return strings(value)[0] ?? ''
}

function strings(value: string | string[] | undefined): string[] {
    if (Array.isArray(value)) return value.map(item => String(item).trim()).filter(Boolean)
    return typeof value === 'string' && value.trim() ? [value.trim()] : []
}

function uniqueStrings(values: string[]): string[] {
    const seen = new Set<string>()
    return values.filter(value => {
        const normalized = value.trim()
        const key = normalized.toLowerCase()
        if (!normalized || seen.has(key)) return false
        seen.add(key)
        return true
    })
}

function stripHTML(value: string): string {
    return value
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;|&apos;/g, '\'')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n\s+/g, '\n')
        .trim()
}

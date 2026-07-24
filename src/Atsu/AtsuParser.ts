import {
    Chapter,
    ChapterDetails,
    PartialSourceManga,
    SourceManga,
    TagSection
} from '@paperback/types'

const ATSU_DOMAIN = 'https://atsu.moe'

export interface AtsuSearchDocument {
    authors?: string[]
    chapterCount?: number
    dateAdded?: number
    englishTitle?: string
    hidden?: boolean
    id: string
    isAdult?: boolean
    mbContentRating?: string
    otherNames?: string[]
    poster?: string
    posterMedium?: string
    status?: string
    synopsis?: string
    tags?: string[]
    title: string
    type?: string
}

export interface AtsuSearchResponse {
    found: number
    hits: Array<{ document: AtsuSearchDocument }>
    page: number
}

interface AtsuMangaPerson {
    name: string
    type: string
}

interface AtsuMangaPage {
    id: string
    authors?: AtsuMangaPerson[]
    avgRating?: number
    banner?: { url?: string }
    englishTitle?: string
    genres?: Array<{ id: string, name: string }>
    isAdult?: boolean
    otherNames?: string[]
    poster?: {
        image?: string
        mediumImage?: string
    }
    status?: string
    synopsis?: string
    title: string
    type?: string
}

export interface AtsuMangaPageResponse {
    mangaPage: AtsuMangaPage
}

export interface AtsuMangaInfoResponse {
    chapters: Array<{
        id: string
        index?: number
        number?: number
        title?: string
    }>
}

export interface AtsuReadResponse {
    readChapter: {
        pages: Array<{
            image: string
            number?: number
        }>
    }
}

export function parseJSON<T>(data: unknown): T {
    return (typeof data === 'string' ? JSON.parse(data) : data) as T
}

export function isAllowedDocument(document: AtsuSearchDocument): boolean {
    const rating = document.mbContentRating?.toLowerCase()
    return document.hidden !== true
        && document.isAdult !== true
        && (rating === 'safe' || rating === 'suggestive')
}

export function parsePartialManga(document: AtsuSearchDocument): PartialSourceManga {
    const metadata = [
        document.type,
        document.status,
        typeof document.chapterCount === 'number' ? `${document.chapterCount} chapters` : undefined
    ].filter((value): value is string => Boolean(value))

    return App.createPartialSourceManga({
        mangaId: document.id,
        title: document.title,
        image: assetURL(document.posterMedium ?? document.poster ?? ''),
        subtitle: metadata.join(' • ') || undefined
    })
}

export function parseMangaDetails(response: AtsuMangaPageResponse, mangaId: string): SourceManga {
    const manga = response.mangaPage
    if (manga.isAdult) {
        throw new Error('This title is excluded by the source content filter.')
    }

    const titles = uniqueStrings([
        manga.title,
        manga.englishTitle,
        ...(manga.otherNames ?? [])
    ]).slice(0, 30)
    const authors = (manga.authors ?? [])
        .filter(person => person.type.toLowerCase() === 'author')
        .map(person => person.name)
    const artists = (manga.authors ?? [])
        .filter(person => person.type.toLowerCase() === 'artist')
        .map(person => person.name)
    const genreTags = (manga.genres ?? []).map(genre => App.createTag({
        id: genre.name,
        label: genre.name
    }))
    const tags: TagSection[] = genreTags.length > 0
        ? [App.createTagSection({ id: 'genres', label: 'Genres', tags: genreTags })]
        : []
    const banner = manga.banner?.url ? assetURL(manga.banner.url) : undefined

    return App.createSourceManga({
        id: mangaId,
        mangaInfo: App.createMangaInfo({
            titles,
            image: assetURL(manga.poster?.mediumImage ?? manga.poster?.image ?? ''),
            banner,
            status: normalizedStatus(manga.status),
            author: uniqueStrings(authors).join(', '),
            artist: uniqueStrings(artists).join(', '),
            tags,
            desc: manga.synopsis?.trim() ?? '',
            hentai: false,
            additionalInfo: {
                Type: manga.type ?? 'Unknown'
            }
        })
    })
}

export function parseChapters(response: AtsuMangaInfoResponse): Chapter[] {
    return response.chapters
        .filter(chapter => Boolean(chapter.id))
        .map((chapter, position) => {
            const chapterNumber = finiteNumber(chapter.number, position + 1)
            return App.createChapter({
                id: chapter.id,
                name: chapter.title?.trim() || `Chapter ${chapterNumber}`,
                chapNum: chapterNumber,
                sortingIndex: finiteNumber(chapter.index, position),
                langCode: '🇬🇧',
                group: 'Atsu'
            })
        })
}

export function parseChapterDetails(
    response: AtsuReadResponse,
    mangaId: string,
    chapterId: string
): ChapterDetails {
    const pages = [...response.readChapter.pages]
        .sort((left, right) => finiteNumber(left.number, 0) - finiteNumber(right.number, 0))
        .map(page => assetURL(page.image))
        .filter(Boolean)

    if (pages.length === 0) {
        throw new Error(`Atsu returned no pages for chapter ${chapterId}.`)
    }

    return App.createChapterDetails({
        id: chapterId,
        mangaId,
        pages
    })
}

function assetURL(value: string): string {
    if (!value) return ''
    if (/^https:\/\//i.test(value)) return encodeURI(value)
    const normalized = value.startsWith('/')
        ? value
        : `/static/${value.replace(/^static\//, '')}`
    return encodeURI(`${ATSU_DOMAIN}${normalized}`)
}

function finiteNumber(value: number | undefined, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function normalizedStatus(status: string | undefined): string {
    switch (status?.toLowerCase()) {
        case 'completed':
        case 'finished':
            return 'Completed'
        case 'hiatus':
        case 'on hiatus':
            return 'Hiatus'
        case 'cancelled':
        case 'canceled':
        case 'discontinued':
            return 'Cancelled'
        default:
            return 'Ongoing'
    }
}

function uniqueStrings(values: Array<string | undefined>): string[] {
    const seen = new Set<string>()
    const result: string[] = []
    for (const value of values) {
        const normalized = value?.trim()
        if (!normalized) continue
        const key = normalized.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        result.push(normalized)
    }
    return result
}

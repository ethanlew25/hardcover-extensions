import {
    Chapter,
    ChapterDetails,
    PartialSourceManga,
    SourceManga,
    TagSection
} from '@paperback/types'

const ATSU_ASSET_DOMAIN = 'https://cdn.atsu.moe'
export const ATSU_NOVEL_MESSAGE = 'This Atsu chapter is a text novel. Update Hardcover to a version with text novel support, or choose the comic adaptation.'

export function supportsTextChapters(): boolean {
    return (App as typeof App & { supportsTextChapters?: boolean }).supportsTextChapters === true
}

export interface AtsuSearchDocument {
    authors?: string[]
    chapterCount?: number
    dateAdded?: number
    englishTitle?: string
    hidden?: boolean
    id: string
    isAdult?: boolean
    mbContentRating?: string
    medium?: string
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
    medium?: string
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
        createdAt?: number
        id: string
        index?: number
        number?: number
        scanlationMangaId?: string
        title?: string
    }>
}

export interface AtsuReadResponse {
    readChapter?: {
        pages?: Array<{
            image?: string
            number?: number
        }>
    }
}

export interface AtsuNovelReadResponse {
    readNovelChapter?: { id?: string, paragraphs?: unknown } | null
}

export function parseJSON<T>(data: unknown): T {
    return (typeof data === 'string' ? JSON.parse(data) : data) as T
}

export function isAllowedDocument(document: AtsuSearchDocument): boolean {
    const rating = document.mbContentRating?.toLowerCase()
    return document.hidden !== true
        && document.isAdult !== true
        && (rating === 'safe' || rating === 'suggestive')
        && (isComicMedium(document.medium, document.type)
            || (supportsTextChapters() && isNovelMedium(document.medium, document.type)))
}

export function isNovelMedium(medium: string | undefined, type: string | undefined): boolean {
    return medium ? medium.toLowerCase() === 'novel' : Boolean(type?.toLowerCase().includes('novel'))
}

function isComicMedium(medium: string | undefined, type: string | undefined): boolean {
    // Older catalogs did not return medium. Atsu novels can still have a comic
    // type such as Manwha, so the explicit medium must take precedence.
    if (medium) return medium.toLowerCase() === 'comic'
    return !type?.toLowerCase().includes('novel')
}

export function parsePartialManga(document: AtsuSearchDocument): PartialSourceManga {
    const metadata = [
        isNovelMedium(document.medium, document.type) ? 'Text novel' : document.type,
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
    if (!manga) throw new Error('This Atsu title is no longer available. Refresh the title or choose another source.')
    const isNovel = isNovelMedium(manga.medium, manga.type)
    if (!isComicMedium(manga.medium, manga.type) && !(isNovel && supportsTextChapters())) {
        throw new Error(ATSU_NOVEL_MESSAGE)
    }
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
    if (isNovel) {
        tags.push(App.createTagSection({ id: 'format', label: 'Format', tags: [
            App.createTag({ id: 'format:novel', label: 'Text Novel' })
        ] }))
    }
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
                Type: isNovel ? 'Text Novel' : manga.type ?? 'Unknown'
            }
        })
    })
}

export function parseChapters(response: AtsuMangaInfoResponse): Chapter[] {
    return response.chapters
        .filter(chapter => Boolean(chapter.id))
        .map((chapter, position) => {
            const chapterNumber = finiteNumber(chapter.number, position + 1)
            const published = typeof chapter.createdAt === 'number'
                ? new Date(chapter.createdAt)
                : undefined
            return App.createChapter({
                id: chapter.id,
                name: chapter.title?.trim() || `Chapter ${chapterNumber}`,
                chapNum: chapterNumber,
                sortingIndex: finiteNumber(chapter.index, position),
                langCode: '🇬🇧',
                group: 'Atsu',
                time: published && !Number.isNaN(published.getTime()) ? published : undefined
            })
        })
}

export function parseChapterDetails(
    response: AtsuReadResponse,
    mangaId: string,
    chapterId: string
): ChapterDetails {
    const pages = chapterImagePages(response)

    if (pages.length === 0) {
        throw new Error(`Atsu returned no image pages for chapter ${chapterId}. Refresh the chapter list or choose another source.`)
    }

    return App.createChapterDetails({
        id: chapterId,
        mangaId,
        pages
    })
}

export function chapterImagePages(response: AtsuReadResponse): string[] {
    const pages = response?.readChapter?.pages
    if (!Array.isArray(pages)) return []
    return [...pages]
        .filter(page => page && typeof page.image === 'string')
        .sort((left, right) => finiteNumber(left.number, 0) - finiteNumber(right.number, 0))
        .map(page => assetURL(page.image?.trim() ?? ''))
        .filter(Boolean)
}

export function parseNovelChapterDetails(
    response: AtsuNovelReadResponse, mangaId: string, chapterId: string
): ChapterDetails {
    if (!supportsTextChapters()) throw new Error(ATSU_NOVEL_MESSAGE)
    const chapter = response?.readNovelChapter
    if (chapter?.id !== chapterId || !Array.isArray(chapter.paragraphs)
        || chapter.paragraphs.some(value => typeof value !== 'string')) {
        throw new Error(`Atsu returned invalid text for chapter ${chapterId}. Refresh the chapter list and try again.`)
    }
    const paragraphs = (chapter.paragraphs as string[]).map(value => value.trim()).filter(Boolean)
    if (paragraphs.length === 0) throw new Error(`Atsu returned no text for chapter ${chapterId}. Try again later or choose another source.`)
    return {
        ...App.createChapterDetails({ id: chapterId, mangaId, pages: [] }),
        type: 'text',
        paragraphs
    } as ChapterDetails
}

function assetURL(value: string): string {
    value = value.trim()
    if (!value) return ''
    // Atsu moved static images off the API/site host. Both relative paths and
    // older absolute API responses must use the CDN; the site URLs return 410.
    const atsuAsset = /^(?:https?:)?\/\/(?:cdn\.)?atsu\.moe(\/static\/.*)$/i.exec(value)
    if (atsuAsset) return encodeURI(`${ATSU_ASSET_DOMAIN}${atsuAsset[1]}`)
    if (/^https:\/\//i.test(value)) return encodeURI(value)
    const normalized = value.startsWith('/')
        ? value
        : `/static/${value.replace(/^static\//, '')}`
    return encodeURI(`${ATSU_ASSET_DOMAIN}${normalized}`)
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

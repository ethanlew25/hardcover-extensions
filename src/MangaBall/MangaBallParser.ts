import {
    Chapter,
    ChapterDetails,
    PartialSourceManga,
    SourceManga,
    TagSection
} from '@paperback/types'

import * as cheerio from 'cheerio'

const MANGABALL_DOMAIN = 'https://mangaball.net'
const BLOCKED_TAGS = new Set([
    'adult',
    'doujinshi',
    'hentai',
    'incest',
    'loli',
    'manhwa 18+',
    'sexual violence',
    'shota',
    'smut',
    'yaoi'
])

export interface MangaBallSearchItem {
    _id: string
    alternateName?: string
    authors?: string
    background?: string
    cover?: string
    isAdult?: boolean
    name: string
    status?: string
    tags?: string
    url?: string
}

export interface MangaBallSearchResponse {
    code: number
    data: MangaBallSearchItem[]
    message?: string
    pagination?: {
        current_page?: number
        last_page?: number
        total?: number
    }
}

export interface MangaBallChapterResponse {
    code: number
    ALL_CHAPTERS?: Array<{
        number?: string
        number_float?: number
        title?: string
        translations?: Array<{
            date?: string
            group?: { name?: string }
            id: string
            language?: string
            name?: string
            pages?: number
            volume?: number
        }>
    }>
}

interface MangaBallTag {
    _id: string
    name: string
}

export interface MangaBallTagResponse {
    code: number
    data?: Record<string, MangaBallTag[]>
}

export function parseJSON<T>(data: unknown): T {
    return (typeof data === 'string' ? JSON.parse(data) : data) as T
}

export function parseSearchResults(response: MangaBallSearchResponse): PartialSourceManga[] {
    if (response.code !== 200 || !Array.isArray(response.data)) {
        throw new Error(response.message || 'MangaBall returned an invalid search response.')
    }

    const results: PartialSourceManga[] = []
    const seen = new Set<string>()
    for (const item of response.data) {
        const mangaId = titleSlug(item.url ?? '')
        const tags = fragmentValues(item.tags ?? '', '[data-tag-id]')
        if (
            !mangaId
            || !item.name?.trim()
            || item.isAdult === true
            || looksExplicitTitle(item.name)
            || containsBlockedTag(tags)
            || seen.has(mangaId)
        ) continue

        const image = secureURL(item.cover ?? item.background ?? '')
        if (!image) continue
        seen.add(mangaId)
        results.push(App.createPartialSourceManga({
            mangaId,
            title: item.name.trim(),
            image,
            subtitle: cleanHTML(item.status ?? '') || undefined
        }))
    }
    return results
}

export function parseTagSections(response: MangaBallTagResponse): TagSection[] {
    if (response.code !== 200 || !response.data) return []
    const preferredGroups = ['genre', 'theme', 'format']
    const sections: TagSection[] = []

    for (const group of preferredGroups) {
        const tags = (response.data[group] ?? [])
            .filter(tag => tag._id && tag.name && !BLOCKED_TAGS.has(tag.name.trim().toLowerCase()))
            .map(tag => App.createTag({ id: tag._id, label: tag.name.trim() }))
        if (tags.length === 0) continue
        sections.push(App.createTagSection({
            id: group,
            label: group[0]?.toUpperCase() + group.slice(1),
            tags
        }))
    }
    return sections
}

export function parseMangaDetails(html: string, mangaId: string): SourceManga {
    const $ = cheerio.load(html)
    const title = $('#comicDetail h6').first().text().trim()
    const imageNode = $('img.featured-cover').first()
    const image = secureURL(imageNode.attr('src') ?? '')
    const tags = $('#comicDetail [data-tag-id]').toArray()
        .map(element => $(element).text().trim())
        .filter(Boolean)
    if (!title || !image) {
        throw new Error(`MangaBall returned incomplete details for ${mangaId}.`)
    }
    if (imageNode.hasClass('adult-cover') || looksExplicitTitle(title) || containsBlockedTag(tags)) {
        throw new Error('This title is excluded by the source content filter.')
    }

    const alternateTitles = $('.alternate-name-container').first().text()
        .split('/')
        .map(value => value.trim())
        .filter(Boolean)
    const authors = $('#comicDetail [data-person-id]').toArray()
        .map(element => $(element).text().trim())
        .filter(Boolean)
    const status = $('.badge-status').first().text().trim()
    const description = $('#descriptionContent .description-text > p').first().text().trim()
    const tagSections: TagSection[] = tags.length > 0
        ? [App.createTagSection({
            id: 'genres',
            label: 'Genres',
            tags: uniqueStrings(tags).map(label => App.createTag({ id: label, label }))
        })]
        : []

    return App.createSourceManga({
        id: mangaId,
        mangaInfo: App.createMangaInfo({
            titles: uniqueStrings([title, ...alternateTitles]).slice(0, 30),
            image,
            status: normalizedStatus(status),
            author: uniqueStrings(authors).join(', '),
            artist: uniqueStrings(authors).join(', '),
            tags: tagSections,
            desc: description,
            hentai: false
        })
    })
}

export function parseChapters(response: MangaBallChapterResponse, mangaId: string): Chapter[] {
    if (response.code !== 200 || !Array.isArray(response.ALL_CHAPTERS)) {
        throw new Error(`MangaBall returned an invalid chapter response for ${mangaId}.`)
    }

    const chapters: Chapter[] = []
    const seen = new Set<string>()
    for (const chapterGroup of response.ALL_CHAPTERS) {
        const chapterNumber = finiteNumber(
            chapterGroup.number_float,
            chapterNumberFrom(chapterGroup.number ?? '', chapters.length + 1)
        )
        for (const translation of chapterGroup.translations ?? []) {
            if (
                translation.language !== 'en'
                || !translation.id
                || finiteNumber(translation.pages, 0) <= 0
                || seen.has(translation.id)
            ) continue

            const translationTitle = translation.name?.trim() || chapterGroup.title?.trim()
            const name = translationTitle
                ? `Chapter ${chapterNumber}: ${translationTitle}`
                : `Chapter ${chapterNumber}`
            const rawDate = translation.date?.trim()
            const date = rawDate ? new Date(rawDate.replace(' ', 'T') + 'Z') : undefined
            seen.add(translation.id)
            chapters.push(App.createChapter({
                id: translation.id,
                name,
                chapNum: chapterNumber,
                sortingIndex: chapterNumber,
                volume: finiteNumber(translation.volume, 0),
                langCode: '🇬🇧',
                group: translation.group?.name?.trim() || 'MangaBall',
                time: date && !Number.isNaN(date.getTime()) ? date : undefined
            }))
        }
    }

    if (chapters.length === 0) {
        throw new Error(`MangaBall returned no English chapters for ${mangaId}.`)
    }
    return chapters
}

export function parseChapterDetails(
    html: string,
    mangaId: string,
    chapterId: string
): ChapterDetails {
    const encoded = html.match(/const\s+chapterImages\s*=\s*JSON\.parse\(`([\s\S]*?)`\)/)?.[1]
    if (!encoded) {
        throw new Error(`MangaBall returned no page data for chapter ${chapterId}.`)
    }

    let rawPages: unknown
    try {
        rawPages = JSON.parse(encoded)
    } catch {
        throw new Error(`MangaBall returned malformed page data for chapter ${chapterId}.`)
    }
    const pages = Array.isArray(rawPages)
        ? rawPages.filter((page): page is string => typeof page === 'string').map(secureURL).filter(Boolean)
        : []
    if (pages.length === 0) {
        throw new Error(`MangaBall returned no pages for chapter ${chapterId}.`)
    }
    return App.createChapterDetails({ id: chapterId, mangaId, pages })
}

export function parseCSRF(html: string): string {
    const $ = cheerio.load(html)
    const token = $('meta[name="csrf-token"]').attr('content')?.trim() ?? ''
    if (!token) throw new Error('MangaBall did not provide a CSRF token.')
    return token
}

export function rawTitleID(mangaId: string): string {
    const id = mangaId.match(/([a-f0-9]{24})$/i)?.[1] ?? ''
    if (!id) throw new Error(`Invalid MangaBall manga ID: ${mangaId}`)
    return id
}

function titleSlug(value: string): string {
    return value.match(/\/title-detail\/([^/?#]+)/i)?.[1] ?? ''
}

function fragmentValues(html: string, selector: string): string[] {
    const $ = cheerio.load(html)
    return $(selector).toArray().map(element => $(element).text().trim()).filter(Boolean)
}

function cleanHTML(html: string): string {
    return cheerio.load(html).text().replace(/\s+/g, ' ').trim()
}

function containsBlockedTag(tags: string[]): boolean {
    return tags.some(tag => BLOCKED_TAGS.has(tag.trim().toLowerCase()))
}

function looksExplicitTitle(title: string): boolean {
    return /(?:^|\s|\[)(?:adult|hentai|doujinshi)(?:\s|\]|$)|^\s*\[h\]/i.test(title)
}

function chapterNumberFrom(value: string, fallback: number): number {
    const parsed = Number.parseFloat(value.match(/(\d+(?:\.\d+)?)/)?.[1] ?? '')
    return Number.isFinite(parsed) ? parsed : fallback
}

function normalizedStatus(value: string): string {
    switch (value.trim().toLowerCase()) {
        case 'complete':
        case 'completed':
            return 'Completed'
        case 'hiatus':
        case 'on-hold':
        case 'on hold':
            return 'Hiatus'
        case 'cancelled':
        case 'canceled':
            return 'Cancelled'
        default:
            return 'Ongoing'
    }
}

function secureURL(value: string): string {
    if (!value) return ''
    if (/^https:\/\//i.test(value)) return encodeURI(value)
    if (/^http:\/\//i.test(value)) return encodeURI(value.replace(/^http:/i, 'https:'))
    return encodeURI(`${MANGABALL_DOMAIN}${value.startsWith('/') ? value : `/${value}`}`)
}

function finiteNumber(value: number | undefined, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function uniqueStrings(values: string[]): string[] {
    const seen = new Set<string>()
    return values.filter(value => {
        const normalized = value.trim().toLowerCase()
        if (!normalized || seen.has(normalized)) return false
        seen.add(normalized)
        return true
    }).map(value => value.trim())
}

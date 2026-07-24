import {
    Chapter,
    ChapterDetails,
    PartialSourceManga,
    SourceManga,
    TagSection
} from '@paperback/types'

import * as cheerio from 'cheerio'

const WEBCENTRAL_DOMAIN = 'https://weebcentral.com'
const BLOCKED_TAGS = new Set([
    'adult',
    'doujinshi',
    'hentai',
    'lolicon',
    'shotacon',
    'smut',
    'yaoi'
])

export interface WeebCentralSearchPage {
    hasNextPage: boolean
    results: PartialSourceManga[]
}

export function parseSearchPage(html: string): WeebCentralSearchPage {
    const $ = cheerio.load(html)
    const results: PartialSourceManga[] = []
    const seen = new Set<string>()

    for (const card of $('article.bg-base-300.flex.gap-4.p-4').toArray()) {
        const root = $(card)
        const link = root.find('a[href*="/series/"]').first()
        const mangaId = seriesID(link.attr('href') ?? '')
        const title = root.find('a.line-clamp-1[href*="/series/"]').first().text().trim()
            || root.find('img[alt$=" cover"]').first().attr('alt')?.replace(/\s+cover$/i, '').trim()
            || ''
        if (!mangaId || !title || seen.has(mangaId)) continue

        const tags = labeledValues(root, $, /^Tag\(s\):?$/i)
        if (containsBlockedTag(tags)) continue

        const status = labeledValue(root, $, /^Status:?$/i)
        const type = labeledValue(root, $, /^Type:?$/i)
        const year = labeledValue(root, $, /^Year:?$/i)
        const subtitle = [type, status, year].filter(Boolean).join(' • ')
        const image = absoluteURL(root.find('img[alt$=" cover"]').first().attr('src') ?? '')
        if (!image) continue

        seen.add(mangaId)
        results.push(App.createPartialSourceManga({
            mangaId,
            title,
            image,
            subtitle: subtitle || undefined
        }))
    }

    return {
        results,
        hasNextPage: $('button[hx-get*="/search/data"][hx-get*="offset="]').length > 0
    }
}

export function parseMangaDetails(html: string, mangaId: string): SourceManga {
    const $ = cheerio.load(html)
    const title = $('main h1').first().text().trim()
    const image = absoluteURL($('main img[alt$=" cover"]').first().attr('src') ?? '')
    if (!title || !image) {
        throw new Error(`WeebCentral returned incomplete details for ${mangaId}.`)
    }

    const adult = detailValue($, /^Adult Content:?$/i)
    const tags = detailValues($, /^Tags?\(s\):?$/i)
    if (!/^(no|false)$/i.test(adult) || containsBlockedTag(tags)) {
        throw new Error('This title is excluded by the source content filter.')
    }

    const authors = detailValues($, /^Author\(s\):?$/i)
    const status = detailValue($, /^Status:?$/i)
    const type = detailValue($, /^Type:?$/i)
    const released = detailValue($, /^Released:?$/i)
    const description = $('main strong')
        .filter((_index, element) => /^Description$/i.test($(element).text().trim()))
        .first()
        .parent()
        .find('p')
        .first()
        .text()
        .trim()
    const tagSections: TagSection[] = tags.length > 0
        ? [App.createTagSection({
            id: 'genres',
            label: 'Genres',
            tags: tags.map(label => App.createTag({ id: label, label }))
        })]
        : []

    return App.createSourceManga({
        id: mangaId,
        mangaInfo: App.createMangaInfo({
            titles: [title],
            image,
            status: normalizedStatus(status),
            author: authors.join(', '),
            artist: authors.join(', '),
            tags: tagSections,
            desc: description,
            hentai: false,
            additionalInfo: {
                Type: type || 'Unknown',
                Released: released || 'Unknown'
            }
        })
    })
}

export function parseChapters(html: string, mangaId: string): Chapter[] {
    const $ = cheerio.load(html)
    const chapters: Chapter[] = []
    const seen = new Set<string>()

    for (const linkElement of $('a[href*="/chapters/"]').toArray()) {
        const link = $(linkElement)
        const chapterId = chapterID(link.attr('href') ?? '')
        if (!chapterId || seen.has(chapterId)) continue

        const name = link.find('span.grow > span').first().text().trim()
            || link.find('span').first().text().trim()
            || `Chapter ${chapters.length + 1}`
        const chapterNumber = chapterNumberFrom(name, chapters.length + 1)
        const rawDate = link.find('time[datetime]').first().attr('datetime')
        const date = rawDate ? new Date(rawDate) : undefined

        seen.add(chapterId)
        chapters.push(App.createChapter({
            id: chapterId,
            name,
            chapNum: chapterNumber,
            sortingIndex: chapterNumber,
            langCode: '🇬🇧',
            group: 'WeebCentral',
            time: date && !Number.isNaN(date.getTime()) ? date : undefined
        }))
    }

    if (chapters.length === 0) {
        throw new Error(`WeebCentral returned no chapters for ${mangaId}.`)
    }
    return chapters
}

export function parseChapterDetails(
    html: string,
    mangaId: string,
    chapterId: string
): ChapterDetails {
    const $ = cheerio.load(html)
    const pages = $('img[alt^="Page "]')
        .toArray()
        .map(element => absoluteURL($(element).attr('src') ?? ''))
        .filter(Boolean)

    if (pages.length === 0) {
        throw new Error(`WeebCentral returned no pages for chapter ${chapterId}.`)
    }
    return App.createChapterDetails({ id: chapterId, mangaId, pages })
}

function detailValue($: cheerio.CheerioAPI, pattern: RegExp): string {
    return detailValues($, pattern)[0] ?? ''
}

function detailValues($: cheerio.CheerioAPI, pattern: RegExp): string[] {
    const label = $('main strong')
        .filter((_index, element) => pattern.test($(element).text().trim()))
        .first()
    if (label.length === 0) return []
    return label.parent().find('a').toArray()
        .map(element => $(element).text().trim())
        .filter(Boolean)
}

function labeledValue(
    root: ReturnType<cheerio.CheerioAPI>,
    $: cheerio.CheerioAPI,
    pattern: RegExp
): string {
    return labeledValues(root, $, pattern)[0] ?? ''
}

function labeledValues(
    root: ReturnType<cheerio.CheerioAPI>,
    $: cheerio.CheerioAPI,
    pattern: RegExp
): string[] {
    const label = root.find('strong')
        .filter((_index, element) => pattern.test($(element).text().trim()))
        .first()
    if (label.length === 0) return []
    return label.parent().find('span').toArray()
        .map(element => $(element).text().replace(/,\s*$/, '').trim())
        .filter(Boolean)
}

function seriesID(url: string): string {
    return url.match(/\/series\/([^/?#]+)/i)?.[1] ?? ''
}

function chapterID(url: string): string {
    return url.match(/\/chapters\/([^/?#]+)/i)?.[1] ?? ''
}

function chapterNumberFrom(value: string, fallback: number): number {
    const parsed = Number.parseFloat(value.match(/(?:chapter|ch\.?)\s*(\d+(?:\.\d+)?)/i)?.[1] ?? '')
    return Number.isFinite(parsed) ? parsed : fallback
}

function containsBlockedTag(tags: string[]): boolean {
    return tags.some(tag => BLOCKED_TAGS.has(tag.trim().toLowerCase()))
}

function normalizedStatus(value: string): string {
    switch (value.trim().toLowerCase()) {
        case 'complete':
        case 'completed':
            return 'Completed'
        case 'hiatus':
            return 'Hiatus'
        case 'canceled':
        case 'cancelled':
            return 'Cancelled'
        default:
            return 'Ongoing'
    }
}

function absoluteURL(value: string): string {
    if (!value) return ''
    if (/^https:\/\//i.test(value)) return encodeURI(value)
    if (/^http:\/\//i.test(value)) return encodeURI(value.replace(/^http:/i, 'https:'))
    return encodeURI(`${WEBCENTRAL_DOMAIN}${value.startsWith('/') ? value : `/${value}`}`)
}

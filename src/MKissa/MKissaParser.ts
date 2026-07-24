import {
    PartialSourceManga,
    SourceManga,
    TagSection
} from '@paperback/types'

import { decode } from 'html-entities'

const COVER_HOST = 'https://aln.youtube-anime.com'
const BLOCKED_TERMS = new Set([
    'adult',
    'doujinshi',
    'ecchi',
    'erotica',
    'hentai',
    'loli',
    'lolicon',
    'rape',
    'sexual violence',
    'shota',
    'shotacon',
    'smut',
    'yaoi'
])

export interface MKissaManga {
    _id: string
    airedEnd?: { year?: number }
    airedStart?: { year?: number }
    altNames?: string[]
    authors?: string[]
    averageScore?: number
    countryOfOrigin?: string
    description?: string
    englishName?: string
    genres?: string[]
    isAdult?: boolean
    name?: string
    nativeName?: string
    rating?: number
    score?: number
    status?: string
    tags?: string[]
    thumbnail?: string
    type?: string
}

export interface MKissaListResponse {
    data?: {
        mangas?: {
            edges?: MKissaManga[]
            pageInfo?: { total?: number }
        }
    }
    errors?: Array<{ message?: string }>
}

export interface MKissaDetailsResponse {
    data?: { mangasWithIds?: MKissaManga[] }
    errors?: Array<{ message?: string }>
}

export function parseJSON<T>(data: unknown): T {
    return (typeof data === 'string' ? JSON.parse(data) : data) as T
}

export function parseSearchResults(items: MKissaManga[]): PartialSourceManga[] {
    const results: PartialSourceManga[] = []
    const seen = new Set<string>()
    for (const item of items) {
        const title = displayTitle(item)
        const image = coverURL(item.thumbnail)
        if (!item._id || !title || !image || isBlocked(item) || seen.has(item._id)) continue

        seen.add(item._id)
        results.push(App.createPartialSourceManga({
            mangaId: item._id,
            title,
            image,
            subtitle: [
                normalizedType(item),
                normalizedStatus(item.status),
                item.airedStart?.year ? String(item.airedStart.year) : ''
            ].filter(Boolean).join(' • ') || undefined
        }))
    }
    return results
}

export function parseMangaDetails(item: MKissaManga, mangaId: string): SourceManga {
    if (isBlocked(item)) {
        throw new Error('This title is excluded by the source content filter.')
    }
    const title = displayTitle(item)
    const image = coverURL(item.thumbnail)
    if (!title || !image) {
        throw new Error(`MKissa returned incomplete catalog details for ${mangaId}.`)
    }

    const titles = unique([
        title,
        item.englishName,
        item.nativeName,
        ...(item.altNames ?? [])
    ]).slice(0, 30)
    const labels = unique([...(item.genres ?? []), ...(item.tags ?? [])])
        .filter(label => !BLOCKED_TERMS.has(label.trim().toLowerCase()))
    const tagSections: TagSection[] = labels.length > 0
        ? [App.createTagSection({
            id: 'catalog-tags',
            label: 'Tags',
            tags: labels.map(label => App.createTag({ id: label, label }))
        })]
        : []

    return App.createSourceManga({
        id: mangaId,
        mangaInfo: App.createMangaInfo({
            titles,
            image,
            status: normalizedStatus(item.status),
            author: unique(item.authors ?? []).join(', '),
            artist: unique(item.authors ?? []).join(', '),
            tags: tagSections,
            desc: cleanDescription(item.description ?? ''),
            rating: normalizedRating(item),
            hentai: false,
            additionalInfo: {
                Type: normalizedType(item) || 'Manga',
                Origin: item.countryOfOrigin || 'Unknown',
                Availability: 'Catalog only — MKissa does not provide chapter reading'
            }
        })
    })
}

function displayTitle(item: MKissaManga): string {
    return item.englishName?.trim() || item.name?.trim() || item.nativeName?.trim() || ''
}

function coverURL(value: string | undefined): string {
    const clean = value?.trim() ?? ''
    if (!clean) return ''
    if (/^https:\/\//i.test(clean)) return encodeURI(clean)
    if (/^http:\/\//i.test(clean)) return encodeURI(clean.replace(/^http:/i, 'https:'))
    return encodeURI(`${COVER_HOST}/${clean.replace(/^\/+/, '')}`)
}

function isBlocked(item: MKissaManga): boolean {
    if (item.isAdult === true) return true
    return [...(item.genres ?? []), ...(item.tags ?? [])]
        .some(value => BLOCKED_TERMS.has(value.trim().toLowerCase()))
}

function normalizedType(item: MKissaManga): string {
    if (item.type?.trim()) return item.type.trim()
    switch (item.countryOfOrigin?.toUpperCase()) {
        case 'KR': return 'Manhwa'
        case 'CN': return 'Manhua'
        case 'JP': return 'Manga'
        default: return 'Manga'
    }
}

function normalizedStatus(value: string | undefined): string {
    switch (value?.trim().toLowerCase()) {
        case 'finished':
        case 'complete':
        case 'completed':
            return 'Completed'
        case 'hiatus':
            return 'Hiatus'
        case 'cancelled':
        case 'canceled':
            return 'Cancelled'
        default:
            return 'Ongoing'
    }
}

function normalizedRating(item: MKissaManga): number | undefined {
    const value = Number(item.score ?? item.averageScore ?? item.rating)
    if (!Number.isFinite(value) || value <= 0) return undefined
    return value > 10 ? value / 10 : value
}

function cleanDescription(value: string): string {
    return decode(value.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' '))
        .replace(/[ \t]+/g, ' ')
        .replace(/\n\s+/g, '\n')
        .trim()
}

function unique(values: Array<string | undefined>): string[] {
    const seen = new Set<string>()
    return values
        .map(value => value?.trim() ?? '')
        .filter(value => {
            const key = value.toLowerCase()
            if (!value || seen.has(key)) return false
            seen.add(key)
            return true
        })
}

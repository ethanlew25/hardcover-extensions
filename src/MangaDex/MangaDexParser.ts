import {
    Chapter,
    ChapterDetails,
    PartialSourceManga,
    SourceManga,
    TagSection
} from '@paperback/types'

const COVER_BASE_URL = 'https://uploads.mangadex.org/covers'

interface LocalizedStrings {
    [language: string]: string | undefined
}

interface MangaDexRelationship {
    id: string
    type: string
    attributes?: {
        fileName?: string
        name?: string
    }
}

interface MangaDexTag {
    id: string
    attributes: {
        group?: string
        name?: LocalizedStrings
    }
}

export interface MangaDexMangaEntity {
    id: string
    type: 'manga'
    attributes: {
        altTitles?: LocalizedStrings[]
        availableTranslatedLanguages?: string[]
        contentRating?: string
        description?: LocalizedStrings
        lastChapter?: string | null
        lastVolume?: string | null
        originalLanguage?: string
        publicationDemographic?: string | null
        status?: string
        tags?: MangaDexTag[]
        title?: LocalizedStrings
        year?: number | null
    }
    relationships?: MangaDexRelationship[]
}

export interface MangaDexChapterEntity {
    id: string
    type: 'chapter'
    attributes: {
        chapter?: string | null
        externalUrl?: string | null
        pages?: number
        publishAt?: string
        title?: string | null
        translatedLanguage?: string
        volume?: string | null
    }
    relationships?: MangaDexRelationship[]
}

export interface MangaDexCollection<T> {
    result?: string
    data?: T[]
    limit?: number
    offset?: number
    total?: number
}

export interface MangaDexEntityResponse<T> {
    result?: string
    data?: T
}

export interface MangaDexTagResponse {
    result?: string
    data?: MangaDexTag[]
}

export interface MangaDexAtHomeResponse {
    baseUrl?: string
    chapter?: {
        hash?: string
        data?: string[]
        dataSaver?: string[]
    }
}

export interface MangaDexTagChoice {
    id: string
    label: string
    group: string
}

export function parseJSON<T>(data: unknown): T {
    return (typeof data === 'string' ? JSON.parse(data) : data) as T
}

export function parseMangaList(entities: MangaDexMangaEntity[]): PartialSourceManga[] {
    return entities
        .filter(entity => isAllowedContentRating(entity.attributes.contentRating))
        .map(entity => {
            const attributes = entity.attributes
            const subtitle = uniqueStrings([
                formatLabel(attributes.originalLanguage),
                normalizedStatus(attributes.status),
                attributes.lastChapter ? `Ch. ${attributes.lastChapter}` : undefined
            ]).join(' • ')

            return App.createPartialSourceManga({
                mangaId: entity.id,
                title: localizedValue(attributes.title) || 'Untitled',
                image: coverURL(entity, '256'),
                subtitle: subtitle || undefined
            })
        })
}

export function parseMangaDetails(entity: MangaDexMangaEntity): SourceManga {
    const attributes = entity.attributes
    if (!isAllowedContentRating(attributes.contentRating)) {
        throw new Error('This title is outside Hardcover’s non-explicit content ratings.')
    }

    const titles = uniqueStrings([
        localizedValue(attributes.title),
        ...((attributes.altTitles ?? []).map(localizedValue))
    ]).slice(0, 40)
    const relationships = entity.relationships ?? []
    const authors = relationshipNames(relationships, 'author')
    const artists = relationshipNames(relationships, 'artist')
    const tags = groupedTagSections(attributes.tags ?? [])
    const additionalInfo: Record<string, string> = {
        Format: formatLabel(attributes.originalLanguage) ?? 'Unknown',
        'Original language': languageLabel(attributes.originalLanguage),
        'Content rating': capitalize(attributes.contentRating ?? 'Unknown')
    }
    if (attributes.publicationDemographic) {
        additionalInfo.Demographic = capitalize(attributes.publicationDemographic)
    }
    if (typeof attributes.year === 'number') additionalInfo.Year = String(attributes.year)

    return App.createSourceManga({
        id: entity.id,
        mangaInfo: App.createMangaInfo({
            titles: titles.length > 0 ? titles : ['Untitled'],
            image: coverURL(entity, '512'),
            author: authors.join(', '),
            artist: artists.join(', '),
            desc: localizedValue(attributes.description).trim(),
            status: normalizedStatus(attributes.status) ?? 'Ongoing',
            tags,
            hentai: false,
            additionalInfo
        })
    })
}

function isAllowedContentRating(value: string | undefined): boolean {
    const normalized = value?.trim().toLowerCase()
    return normalized === 'safe' || normalized === 'suggestive'
}

export function parseChapters(entities: MangaDexChapterEntity[]): Chapter[] {
    const seen = new Set<string>()
    const readable = entities.filter(entity => {
        const attributes = entity.attributes
        if ((attributes.pages ?? 0) <= 0 || attributes.externalUrl) return false
        const chapter = attributes.chapter?.trim()
        const volume = attributes.volume?.trim()
        const key = chapter ? `${volume ?? ''}:${chapter}` : entity.id
        if (seen.has(key)) return false
        seen.add(key)
        return true
    })

    return readable.map((entity, index) => {
        const attributes = entity.attributes
        const chapterNumber = finiteNumber(attributes.chapter, 0)
        const volume = finiteNumber(attributes.volume, undefined)
        const title = attributes.title?.trim()
        const group = relationshipNames(entity.relationships ?? [], 'scanlation_group').join(', ')
        const published = attributes.publishAt ? new Date(attributes.publishAt) : undefined

        return App.createChapter({
            id: entity.id,
            name: title || (attributes.chapter ? `Chapter ${attributes.chapter}` : 'Oneshot'),
            chapNum: chapterNumber,
            volume,
            group: group || 'MangaDex',
            langCode: languageFlag(attributes.translatedLanguage),
            time: published && !Number.isNaN(published.getTime()) ? published : undefined,
            sortingIndex: readable.length - index
        })
    })
}

export function parseChapterDetails(
    response: MangaDexAtHomeResponse,
    mangaId: string,
    chapterId: string
): ChapterDetails {
    const baseURL = response.baseUrl?.replace(/\/$/, '') ?? ''
    const hash = response.chapter?.hash?.trim() ?? ''
    const files = response.chapter?.data ?? []

    if (!/^https:\/\/([a-z0-9-]+\.)*mangadex\.network(?=[:/]|$)/i.test(baseURL)) {
        throw new Error('MangaDex returned an untrusted page server.')
    }
    if (!hash || files.length === 0) {
        throw new Error(`MangaDex returned no readable pages for chapter ${chapterId}.`)
    }

    return App.createChapterDetails({
        id: chapterId,
        mangaId,
        pages: files.map(file => encodeURI(`${baseURL}/data/${hash}/${file}`))
    })
}

export function parseTagChoices(response: MangaDexTagResponse): MangaDexTagChoice[] {
    return (response.data ?? [])
        .map(tag => ({
            id: tag.id,
            label: localizedValue(tag.attributes.name),
            group: tag.attributes.group?.trim().toLowerCase() || 'genre'
        }))
        .filter(tag => Boolean(tag.id && tag.label))
        .sort((left, right) => left.label.localeCompare(right.label))
}

function coverURL(entity: MangaDexMangaEntity, size: '256' | '512'): string {
    const fileName = (entity.relationships ?? [])
        .find(relationship => relationship.type === 'cover_art')
        ?.attributes?.fileName
    return fileName
        ? encodeURI(`${COVER_BASE_URL}/${entity.id}/${fileName}.${size}.jpg`)
        : ''
}

function groupedTagSections(tags: MangaDexTag[]): TagSection[] {
    const grouped = new Map<string, Array<{ id: string, label: string }>>()
    for (const tag of tags) {
        const label = localizedValue(tag.attributes.name)
        if (!label) continue
        const group = capitalize(tag.attributes.group || 'Tags')
        grouped.set(group, [...(grouped.get(group) ?? []), { id: tag.id, label }])
    }

    return [...grouped.entries()].map(([group, values]) => App.createTagSection({
        id: group.toLowerCase(),
        label: group,
        tags: values
            .sort((left, right) => left.label.localeCompare(right.label))
            .map(tag => App.createTag(tag))
    }))
}

function relationshipNames(relationships: MangaDexRelationship[], type: string): string[] {
    return uniqueStrings(relationships
        .filter(relationship => relationship.type === type)
        .map(relationship => relationship.attributes?.name))
}

function localizedValue(value: LocalizedStrings | undefined): string {
    if (!value) return ''
    const preferred = ['en', 'en-us', 'ja-ro', 'ko-ro', 'zh-ro']
    for (const language of preferred) {
        const candidate = value[language]?.trim()
        if (candidate) return candidate
    }
    return Object.values(value).find(candidate => Boolean(candidate?.trim()))?.trim() ?? ''
}

function finiteNumber(value: string | null | undefined, fallback: number): number
function finiteNumber(value: string | null | undefined, fallback: undefined): number | undefined
function finiteNumber(value: string | null | undefined, fallback: number | undefined): number | undefined {
    if (!value) return fallback
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : fallback
}

function normalizedStatus(status: string | undefined): string | undefined {
    switch (status?.toLowerCase()) {
        case 'completed': return 'Completed'
        case 'hiatus': return 'Hiatus'
        case 'cancelled': return 'Cancelled'
        case 'ongoing': return 'Ongoing'
        default: return status ? capitalize(status) : undefined
    }
}

function formatLabel(language: string | undefined): string | undefined {
    switch (language?.toLowerCase()) {
        case 'ja': return 'Manga'
        case 'ko': return 'Manhwa'
        case 'zh':
        case 'zh-hk': return 'Manhua'
        case 'en': return 'English comic'
        default: return language ? 'Comic' : undefined
    }
}

function languageLabel(language: string | undefined): string {
    switch (language?.toLowerCase()) {
        case 'ja': return 'Japanese'
        case 'ko': return 'Korean'
        case 'zh': return 'Chinese (Simplified)'
        case 'zh-hk': return 'Chinese (Traditional)'
        case 'en': return 'English'
        default: return language?.toUpperCase() || 'Unknown'
    }
}

function languageFlag(language: string | undefined): string {
    switch (language?.toLowerCase()) {
        case 'en': return '🇬🇧'
        case 'ja': return '🇯🇵'
        case 'ko': return '🇰🇷'
        case 'zh':
        case 'zh-hk': return '🇨🇳'
        default: return language ?? 'en'
    }
}

function capitalize(value: string): string {
    const trimmed = value.trim()
    return trimmed ? trimmed.charAt(0).toUpperCase() + trimmed.slice(1) : ''
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

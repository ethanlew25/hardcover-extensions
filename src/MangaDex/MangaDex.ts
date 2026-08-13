import {
    Chapter,
    ChapterDetails,
    ChapterProviding,
    ContentRating,
    HomePageSectionsProviding,
    HomeSection,
    HomeSectionType,
    MangaProviding,
    PagedResults,
    Request,
    Response,
    SearchRequest,
    SearchResultsProviding,
    SourceInfo,
    SourceIntents,
    SourceManga,
    TagSection
} from '@paperback/types'

import {
    MangaDexAtHomeResponse,
    MangaDexChapterEntity,
    MangaDexCollection,
    MangaDexEntityResponse,
    MangaDexMangaEntity,
    MangaDexTagResponse,
    parseChapterDetails,
    parseChapters,
    parseJSON,
    parseMangaDetails,
    parseMangaList,
    parseTagChoices
} from './MangaDexParser'
import {
    createFilterSection,
    excludedValues,
    includedValues,
    selectedValue
} from '../SearchFilters'

const MANGADEX_DOMAIN = 'https://mangadex.org'
const MANGADEX_API = 'https://api.mangadex.org'
const COVER_HOST_ROOT = 'https://uploads.mangadex.org'
const PAGE_HOST_ROOT = 'https://mangadex.network'
const PAGE_SIZE = 40
const CHAPTER_PAGE_SIZE = 100

const HOME_SECTIONS: Array<{
    id: string
    title: string
    field: string
    direction: 'asc' | 'desc'
    type: HomeSectionType
}> = [
    {
        id: 'latest',
        title: 'Latest Updates',
        field: 'latestUploadedChapter',
        direction: 'desc',
        type: HomeSectionType.featured
    },
    {
        id: 'popular',
        title: 'Most Followed',
        field: 'followedCount',
        direction: 'desc',
        type: HomeSectionType.singleRowLarge
    },
    {
        id: 'new',
        title: 'Recently Added',
        field: 'createdAt',
        direction: 'desc',
        type: HomeSectionType.singleRowNormal
    }
]

export const MangaDexInfo: SourceInfo = {
    version: '1.0.0',
    name: 'MangaDex',
    icon: 'icon.png',
    author: 'Hardcover contributors',
    description: 'Reads safe and suggestive English chapters through the public MangaDex API.',
    contentRating: ContentRating.MATURE,
    websiteBaseURL: MANGADEX_DOMAIN,
    language: 'English',
    sourceTags: [],
    intents: SourceIntents.MANGA_CHAPTERS | SourceIntents.HOMEPAGE_SECTIONS
}

export class MangaDex implements SearchResultsProviding, MangaProviding, ChapterProviding, HomePageSectionsProviding {
    requestManager = App.createRequestManager({
        requestsPerSecond: 4,
        requestTimeout: 30000,
        interceptor: {
            interceptRequest: async (request: Request): Promise<Request> => {
                request.headers = {
                    ...(request.headers ?? {}),
                    'accept': 'application/json',
                    'referer': `${MANGADEX_DOMAIN}/`,
                    'user-agent': await this.requestManager.getDefaultUserAgent()
                }
                return request
            },
            interceptResponse: async (response: Response): Promise<Response> => response
        }
    })

    getMangaShareUrl(mangaId: string): string {
        return `${MANGADEX_DOMAIN}/title/${encodeURIComponent(mangaId)}`
    }

    async getMangaDetails(mangaId: string): Promise<SourceManga> {
        validateUUID(mangaId)
        const response = await this.get(`/manga/${mangaId}?${queryString([
            ['includes[]', 'author'],
            ['includes[]', 'artist'],
            ['includes[]', 'cover_art']
        ])}`)
        const entity = parseJSON<MangaDexEntityResponse<MangaDexMangaEntity>>(response.data).data
        if (!entity) throw new Error(`MangaDex returned no title data for ${mangaId}.`)
        return parseMangaDetails(entity)
    }

    async getChapters(mangaId: string): Promise<Chapter[]> {
        validateUUID(mangaId)
        const entities: MangaDexChapterEntity[] = []
        let offset = 0
        let total = 1

        while (offset < total && offset < 10_000) {
            const response = await this.get(`/manga/${mangaId}/feed?${queryString([
                ['limit', CHAPTER_PAGE_SIZE],
                ['offset', offset],
                ['translatedLanguage[]', 'en'],
                ['contentRating[]', 'safe'],
                ['contentRating[]', 'suggestive'],
                ['includes[]', 'scanlation_group'],
                ['includeFutureUpdates', '0'],
                ['includeExternalUrl', '0'],
                ['order[volume]', 'desc'],
                ['order[chapter]', 'desc'],
                ['order[publishAt]', 'desc']
            ])}`)
            const page = parseJSON<MangaDexCollection<MangaDexChapterEntity>>(response.data)
            const values = page.data ?? []
            entities.push(...values)
            total = Math.min(page.total ?? entities.length, 10_000)
            if (values.length === 0) break
            offset += values.length
        }

        const chapters = parseChapters(entities)
        if (chapters.length === 0) {
            throw new Error(`MangaDex has no readable English chapters for ${mangaId}.`)
        }
        return chapters
    }

    async getChapterDetails(mangaId: string, chapterId: string): Promise<ChapterDetails> {
        validateUUID(mangaId)
        validateUUID(chapterId)
        void PAGE_HOST_ROOT
        const response = await this.get(`/at-home/server/${chapterId}?forcePort443=true`)
        return parseChapterDetails(
            parseJSON<MangaDexAtHomeResponse>(response.data),
            mangaId,
            chapterId
        )
    }

    async getHomePageSections(sectionCallback: (section: HomeSection) => void): Promise<void> {
        await Promise.all(HOME_SECTIONS.map(async config => {
            const section = App.createHomeSection({
                id: config.id,
                title: config.title,
                type: config.type,
                containsMoreItems: true
            })
            sectionCallback(section)

            const page = await this.search('', 0, config.field, config.direction)
            section.items = parseMangaList(page.data ?? [])
            sectionCallback(section)
        }))
    }

    async getViewMoreItems(homepageSectionId: string, metadata: any): Promise<PagedResults> {
        const config = HOME_SECTIONS.find(section => section.id === homepageSectionId)
        if (!config) throw new Error(`Unknown MangaDex home section: ${homepageSectionId}`)
        const offset = numericOffset(metadata?.offset)
        const page = await this.search('', offset, config.field, config.direction)
        return pagedResults(page, offset)
    }

    async getSearchTags(): Promise<TagSection[]> {
        const fixed = fixedFilterSections()
        try {
            const response = await this.get('/manga/tag')
            const choices = parseTagChoices(parseJSON<MangaDexTagResponse>(response.data))
            const groups = new Map<string, typeof choices>()
            for (const choice of choices) {
                groups.set(choice.group, [...(groups.get(choice.group) ?? []), choice])
            }
            const labels: Record<string, string> = {
                content: 'Content',
                format: 'Format',
                genre: 'Genres',
                theme: 'Themes'
            }
            const tagSections = [...groups.entries()].map(([group, values]) => createFilterSection(
                `tags-${group}`,
                labels[group] ?? capitalize(group),
                'tag',
                values.map(value => ({ value: value.id, label: value.label })),
                'exclude'
            ))
            return [...fixed, ...tagSections]
        } catch {
            return fixed
        }
    }

    async supportsSearchOperators(): Promise<boolean> {
        return true
    }

    async supportsTagExclusion(): Promise<boolean> {
        return true
    }

    async getSearchResults(query: SearchRequest, metadata: any): Promise<PagedResults> {
        const offset = numericOffset(metadata?.offset)
        const title = query.title?.trim() ?? ''
        const selectedSort = selectedValue(query, 'sort', title ? 'relevance' : 'followedCount:desc')
        const [sortField, sortDirection] = selectedSort.split(':')
        const parameters = baseSearchParameters(offset)
        if (title) parameters.push(['title', title])
        if (sortField && sortField !== 'relevance') {
            parameters.push([`order[${sortField}]`, sortDirection === 'asc' ? 'asc' : 'desc'])
        }

        for (const status of includedValues(query, 'status')) parameters.push(['status[]', status])
        for (const demographic of includedValues(query, 'demographic')) {
            parameters.push(['publicationDemographic[]', demographic])
        }
        for (const language of includedValues(query, 'origin')) {
            parameters.push(['originalLanguage[]', language])
        }
        const year = includedValues(query, 'year')[0]
        if (year) parameters.push(['year', year])
        for (const tag of includedValues(query, 'tag')) parameters.push(['includedTags[]', tag])
        for (const tag of excludedValues(query, 'tag')) parameters.push(['excludedTags[]', tag])
        parameters.push(['includedTagsMode', query.includeOperator?.toUpperCase() === 'OR' ? 'OR' : 'AND'])
        parameters.push(['excludedTagsMode', query.excludeOperator?.toUpperCase() === 'AND' ? 'AND' : 'OR'])

        const response = await this.get(`/manga?${queryString(parameters)}`)
        return pagedResults(
            parseJSON<MangaDexCollection<MangaDexMangaEntity>>(response.data),
            offset
        )
    }

    private async search(
        title: string,
        offset: number,
        sortField: string,
        sortDirection: 'asc' | 'desc'
    ): Promise<MangaDexCollection<MangaDexMangaEntity>> {
        const parameters = baseSearchParameters(offset)
        if (title) parameters.push(['title', title])
        parameters.push([`order[${sortField}]`, sortDirection])
        const response = await this.get(`/manga?${queryString(parameters)}`)
        return parseJSON<MangaDexCollection<MangaDexMangaEntity>>(response.data)
    }

    private async get(relativeURL: string): Promise<Response> {
        void COVER_HOST_ROOT
        const response = await this.requestManager.schedule(App.createRequest({
            url: `${MANGADEX_API}${relativeURL}`,
            method: 'GET'
        }), 1)
        if (response.status < 200 || response.status >= 300) {
            throw new Error(`MangaDex request failed with HTTP ${response.status}.`)
        }
        return response
    }
}

type QueryParameter = [string, string | number]

function baseSearchParameters(offset: number): QueryParameter[] {
    return [
        ['limit', PAGE_SIZE],
        ['offset', offset],
        ['availableTranslatedLanguage[]', 'en'],
        ['contentRating[]', 'safe'],
        ['contentRating[]', 'suggestive'],
        ['hasAvailableChapters', 'true'],
        ['includes[]', 'cover_art']
    ]
}

function pagedResults(
    page: MangaDexCollection<MangaDexMangaEntity>,
    offset: number
): PagedResults {
    const results = parseMangaList(page.data ?? [])
    const nextOffset = offset + (page.data?.length ?? 0)
    const hasMore = results.length > 0
        && nextOffset < (page.total ?? nextOffset)
        && nextOffset < 10_000
    return App.createPagedResults({
        results,
        metadata: hasMore ? { offset: nextOffset } : undefined
    })
}

function fixedFilterSections(): TagSection[] {
    const currentYear = new Date().getFullYear()
    const years = Array.from({ length: 12 }, (_, index) => String(currentYear - index))
    return [
        createFilterSection('sort', 'Sort', 'sort', [
            { value: 'relevance', label: 'Best Match' },
            { value: 'followedCount:desc', label: 'Most Followed' },
            { value: 'rating:desc', label: 'Highest Rated' },
            { value: 'latestUploadedChapter:desc', label: 'Latest Updates' },
            { value: 'createdAt:desc', label: 'Recently Added' },
            { value: 'createdAt:asc', label: 'Oldest Added' },
            { value: 'title:asc', label: 'Title A–Z' },
            { value: 'title:desc', label: 'Title Z–A' },
            { value: 'year:desc', label: 'Newest Publication Year' },
            { value: 'year:asc', label: 'Oldest Publication Year' }
        ], 'single'),
        createFilterSection('status', 'Status', 'status', [
            { value: 'ongoing', label: 'Ongoing' },
            { value: 'completed', label: 'Completed' },
            { value: 'hiatus', label: 'Hiatus' },
            { value: 'cancelled', label: 'Cancelled' }
        ], 'multiple'),
        createFilterSection('demographic', 'Demographic', 'demographic', [
            { value: 'shounen', label: 'Shounen' },
            { value: 'shoujo', label: 'Shoujo' },
            { value: 'seinen', label: 'Seinen' },
            { value: 'josei', label: 'Josei' },
            { value: 'none', label: 'None / Unspecified' }
        ], 'multiple'),
        createFilterSection('origin', 'Original Format', 'origin', [
            { value: 'ja', label: 'Manga (Japanese)' },
            { value: 'ko', label: 'Manhwa (Korean)' },
            { value: 'zh', label: 'Manhua (Chinese)' },
            { value: 'zh-hk', label: 'Manhua (Traditional Chinese)' },
            { value: 'en', label: 'English-language Comic' }
        ], 'multiple'),
        createFilterSection(
            'year',
            'Publication Year',
            'year',
            years.map(year => ({ value: year, label: year })),
            'single'
        )
    ]
}

function queryString(parameters: QueryParameter[]): string {
    return parameters
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
        .join('&')
}

function numericOffset(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0
        ? Math.floor(value)
        : 0
}

function validateUUID(value: string): void {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
        throw new Error('MangaDex returned an invalid identifier.')
    }
}

function capitalize(value: string): string {
    const trimmed = value.trim()
    return trimmed ? trimmed.charAt(0).toUpperCase() + trimmed.slice(1) : ''
}

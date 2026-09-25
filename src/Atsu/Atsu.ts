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
    ATSU_NOVEL_MESSAGE,
    AtsuMangaInfoResponse,
    AtsuMangaPageResponse,
    AtsuNovelReadResponse,
    AtsuReadResponse,
    AtsuSearchResponse,
    chapterImagePages,
    isAllowedDocument,
    isNovelMedium,
    parseChapterDetails,
    parseChapters,
    parseJSON,
    parseMangaDetails,
    parseNovelChapterDetails,
    supportsTextChapters,
    parsePartialManga
} from './AtsuParser'
import {
    createFilterSection,
    excludedValues,
    includedValues,
    selectedValue
} from '../SearchFilters'

const ATSU_DOMAIN = 'https://atsu.moe'
const SEARCH_PATH = '/collections/manga/documents/search'
const PAGE_SIZE = 30
const CONTENT_FILTER = 'hidden:=false&&isAdult:=false&&mbContentRating:=[Safe,Suggestive]'

const GENRES = [
    'Action',
    'Adventure',
    'Comedy',
    'Drama',
    'Fantasy',
    'Horror',
    'Mystery',
    'Psychological',
    'Romance',
    'Sci-Fi',
    'Slice of Life',
    'Sports',
    'Supernatural',
    'Thriller',
    'Tragedy'
]

const HOME_SECTIONS: Array<{ id: string, title: string, sort: string, type: HomeSectionType }> = [
    { id: 'trending', title: 'Trending', sort: 'trending:desc', type: HomeSectionType.featured },
    { id: 'popular', title: 'Most Read', sort: 'views:desc', type: HomeSectionType.singleRowLarge },
    { id: 'recent', title: 'Recently Added', sort: 'dateAdded:desc', type: HomeSectionType.singleRowNormal }
]

export const AtsuInfo: SourceInfo = {
    version: '1.2.1',
    name: 'Atsu',
    icon: 'icon.png',
    author: 'Hardcover contributors',
    description: 'Reads Atsu comics and text novels on supported Hardcover versions, excluding hidden and adult-rated titles.',
    contentRating: ContentRating.MATURE,
    websiteBaseURL: ATSU_DOMAIN,
    language: 'English',
    sourceTags: [],
    intents: SourceIntents.MANGA_CHAPTERS | SourceIntents.HOMEPAGE_SECTIONS
}

export class Atsu implements SearchResultsProviding, MangaProviding, ChapterProviding, HomePageSectionsProviding {
    private novelMangaIDs = new Set<string>()
    requestManager = App.createRequestManager({
        requestsPerSecond: 4,
        requestTimeout: 20000,
        interceptor: {
            interceptRequest: async (request: Request): Promise<Request> => {
                request.headers = {
                    ...(request.headers ?? {}),
                    'accept': 'application/json',
                    'referer': `${ATSU_DOMAIN}/`,
                    'user-agent': await this.requestManager.getDefaultUserAgent()
                }
                return request
            },
            interceptResponse: async (response: Response): Promise<Response> => response
        }
    })

    getMangaShareUrl(mangaId: string): string {
        return `${ATSU_DOMAIN}/manga/${encodeURIComponent(mangaId)}`
    }

    async getMangaDetails(mangaId: string): Promise<SourceManga> {
        const response = await this.get(`/api/manga/page?id=${encodeURIComponent(mangaId)}`)
        const page = parseJSON<AtsuMangaPageResponse>(response.data)
        const manga = parseMangaDetails(page, mangaId)
        if (isNovelMedium(page.mangaPage.medium, page.mangaPage.type)) this.novelMangaIDs.add(mangaId)
        return manga
    }

    async getChapters(mangaId: string): Promise<Chapter[]> {
        const response = await this.get(`/api/manga/allChapters?mangaId=${encodeURIComponent(mangaId)}`)
        const chapters = parseChapters(parseJSON<AtsuMangaInfoResponse>(response.data))
        if (chapters.length === 0) {
            throw new Error(`Atsu returned no chapters for manga ${mangaId}.`)
        }
        return chapters
    }

    async getChapterDetails(mangaId: string, chapterId: string): Promise<ChapterDetails> {
        const parameters = `mangaId=${encodeURIComponent(mangaId)}&chapterId=${encodeURIComponent(chapterId)}`
        if (supportsTextChapters() && this.novelMangaIDs.has(mangaId)) {
            const response = await this.get(`/api/read/novelChapter?${parameters}`)
            return parseNovelChapterDetails(parseJSON<AtsuNovelReadResponse>(response.data), mangaId, chapterId)
        }
        const response = await this.get(
            `/api/read/chapter?${parameters}`
        )
        const chapter = parseJSON<AtsuReadResponse>(response.data)
        if (chapterImagePages(chapter).length === 0) {
            // Imported titles may lack medium metadata. Try the public text
            // endpoint once, matching the exact chapter ID, not its number.
            let novelChapter: AtsuNovelReadResponse | undefined
            try {
                const novel = await this.get(`/api/read/novelChapter?${parameters}`)
                novelChapter = parseJSON<AtsuNovelReadResponse>(novel.data)
            } catch {
                // A failed diagnostic must not replace the useful image error.
            }
            if (novelChapter?.readNovelChapter?.id === chapterId) {
                if (!supportsTextChapters()) throw new Error(ATSU_NOVEL_MESSAGE)
                const details = parseNovelChapterDetails(novelChapter, mangaId, chapterId)
                this.novelMangaIDs.add(mangaId)
                return details
            }
        }
        return parseChapterDetails(chapter, mangaId, chapterId)
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

            const page = await this.search('*', 1, config.sort)
            section.items = page.hits
                .map(hit => hit.document)
                .filter(isAllowedDocument)
                .map(parsePartialManga)
            sectionCallback(section)
        }))
    }

    async getViewMoreItems(homepageSectionId: string, metadata: any): Promise<PagedResults> {
        const section = HOME_SECTIONS.find(candidate => candidate.id === homepageSectionId)
        if (!section) throw new Error(`Unknown Atsu home section: ${homepageSectionId}`)

        const pageNumber = numericPage(metadata?.page)
        const page = await this.search('*', pageNumber, section.sort)
        return this.pagedResults(page, pageNumber)
    }

    async getSearchTags(): Promise<TagSection[]> {
        return [
            ...(supportsTextChapters() ? [createFilterSection('medium', 'Format', 'medium', [
                { value: 'Comic', label: 'Comics' },
                { value: 'Novel', label: 'Text novels' }
            ], 'single')] : []),
            createFilterSection('sort', 'Sort', 'sort', [
                { value: 'trending:desc', label: 'Trending' },
                { value: 'views:desc', label: 'Most Read' },
                { value: 'dateAdded:desc', label: 'Recently Added' },
                { value: 'dateAdded:asc', label: 'Oldest Added' },
                { value: 'chapterCount:desc', label: 'Most Chapters' },
                { value: 'title:asc', label: 'Title A–Z' },
                { value: 'title:desc', label: 'Title Z–A' }
            ], 'single'),
            createFilterSection('status', 'Status', 'status', [
                { value: 'Ongoing', label: 'Ongoing' },
                { value: 'Completed', label: 'Completed' },
                { value: 'Hiatus', label: 'Hiatus' }
            ], 'single'),
            createFilterSection('type', 'Type', 'type', [
                { value: 'Manga', label: 'Manga' },
                { value: 'Manwha', label: 'Manhwa' },
                { value: 'Manhua', label: 'Manhua' }
            ], 'single'),
            createFilterSection(
                'genres',
                'Genres',
                'genre',
                GENRES.map(label => ({ value: label, label })),
                'exclude'
            )
        ]
    }

    async getSearchResults(query: SearchRequest, metadata: any): Promise<PagedResults> {
        const pageNumber = numericPage(metadata?.page)
        const filters = this.searchFilters(query)
        const page = await this.search(
            query.title?.trim() || '*',
            pageNumber,
            selectedValue(query, 'sort', ''),
            filters
        )
        return this.pagedResults(page, pageNumber)
    }

    private pagedResults(page: AtsuSearchResponse, pageNumber: number): PagedResults {
        const results = page.hits
            .map(hit => hit.document)
            .filter(isAllowedDocument)
            .map(parsePartialManga)
        const hasNextPage = pageNumber * PAGE_SIZE < page.found
        return App.createPagedResults({
            results,
            metadata: hasNextPage ? { page: pageNumber + 1 } : undefined
        })
    }

    private async search(
        query: string,
        page: number,
        sort?: string,
        additionalFilters: string[] = []
    ): Promise<AtsuSearchResponse> {
        const parameters: Record<string, string | number> = {
            q: query,
            query_by: 'title,otherNames,authors',
            per_page: PAGE_SIZE,
            page,
            filter_by: [supportsTextChapters() ? 'medium:=[Comic,Novel]' : 'medium:=Comic', CONTENT_FILTER, ...additionalFilters].join('&&')
        }
        if (sort) parameters.sort_by = sort

        const queryString = Object.entries(parameters)
            .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
            .join('&')
        const response = await this.get(`${SEARCH_PATH}?${queryString}`)
        return parseJSON<AtsuSearchResponse>(response.data)
    }

    private searchFilters(query: SearchRequest): string[] {
        const included = includedValues(query, 'genre')
        const excluded = excludedValues(query, 'genre')
        const filters: string[] = []

        if (included.length > 0) {
            if (query.includeOperator?.toUpperCase() === 'OR') {
                filters.push(`tags:=[${included.map(quotedFilterValue).join(',')}]`)
            } else {
                filters.push(...included.map(tag => `tags:=${quotedFilterValue(tag)}`))
            }
        }
        filters.push(...excluded.map(tag => `tags:!=${quotedFilterValue(tag)}`))
        const status = includedValues(query, 'status')[0]
        if (status) filters.push(`status:=${quotedFilterValue(status)}`)
        const type = includedValues(query, 'type')[0]
        if (type) filters.push(`type:=${quotedFilterValue(type)}`)
        const medium = includedValues(query, 'medium')[0]
        if (supportsTextChapters() && (medium === 'Comic' || medium === 'Novel')) filters.push(`medium:=${quotedFilterValue(medium)}`)
        return filters
    }

    private async get(relativeURL: string): Promise<Response> {
        const request = App.createRequest({
            url: `${ATSU_DOMAIN}${relativeURL}`,
            method: 'GET'
        })
        const response = await this.requestManager.schedule(request, 1)
        if (response.status < 200 || response.status >= 300) {
            throw new Error(`Atsu request failed with HTTP ${response.status}.`)
        }
        return response
    }
}

function quotedFilterValue(value: string): string {
    return `\`${value.replace(/\\/g, '\\\\').replace(/`/g, '\\`')}\``
}

function numericPage(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0
        ? Math.floor(value)
        : 1
}

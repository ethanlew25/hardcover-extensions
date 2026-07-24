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
    MangaBallChapterResponse,
    MangaBallSearchResponse,
    MangaBallTagResponse,
    parseChapterDetails,
    parseChapters,
    parseCSRF,
    parseJSON,
    parseMangaDetails,
    parseSearchResults,
    parseTagSections,
    rawTitleID
} from './MangaBallParser'
import {
    createFilterSection,
    excludedValues,
    includedValues,
    namespaceTagSections,
    selectedValue
} from '../SearchFilters'

const MANGABALL_DOMAIN = 'https://mangaball.net'
const MEDIA_HOST_ROOT = 'https://poke-black-and-white.net'
const SEARCH_PAGE = '/search-advanced/'
const PAGE_SIZE = 24

const HOME_SECTIONS: Array<{ id: string, title: string, sort: string, type: HomeSectionType }> = [
    { id: 'updated', title: 'Latest Updates', sort: 'updated_chapters_desc', type: HomeSectionType.featured },
    { id: 'popular', title: 'Most Viewed', sort: 'views_desc', type: HomeSectionType.singleRowLarge },
    { id: 'new', title: 'Recently Added', sort: 'created_at_desc', type: HomeSectionType.singleRowNormal }
]

export const MangaBallInfo: SourceInfo = {
    version: '1.1.1',
    name: 'MangaBall',
    icon: 'icon.png',
    author: 'Hardcover contributors',
    description: 'Reads MangaBall public pages with safe-rated, English-only catalog filters.',
    contentRating: ContentRating.MATURE,
    websiteBaseURL: MANGABALL_DOMAIN,
    language: 'English',
    sourceTags: [],
    intents: SourceIntents.MANGA_CHAPTERS
        | SourceIntents.HOMEPAGE_SECTIONS
        | SourceIntents.CLOUDFLARE_BYPASS_REQUIRED
}

export class MangaBall implements SearchResultsProviding, MangaProviding, ChapterProviding, HomePageSectionsProviding {
    requestManager = App.createRequestManager({
        requestsPerSecond: 1,
        requestTimeout: 120000,
        interceptor: {
            interceptRequest: async (request: Request): Promise<Request> => {
                request.headers = {
                    ...(request.headers ?? {}),
                    'accept': request.method === 'POST'
                        ? 'application/json, text/javascript, */*; q=0.01'
                        : 'text/html,application/xhtml+xml',
                    'referer': `${MANGABALL_DOMAIN}/`,
                    'user-agent': await this.requestManager.getDefaultUserAgent()
                }
                return request
            },
            interceptResponse: async (response: Response): Promise<Response> => response
        }
    })

    getMangaShareUrl(mangaId: string): string {
        return `${MANGABALL_DOMAIN}/title-detail/${encodeURIComponent(mangaId)}/`
    }

    async getMangaDetails(mangaId: string): Promise<SourceManga> {
        const response = await this.get(`/title-detail/${encodeURIComponent(mangaId)}/`)
        return parseMangaDetails(String(response.data), mangaId)
    }

    async getChapters(mangaId: string): Promise<Chapter[]> {
        const token = await this.sessionToken(`/title-detail/${encodeURIComponent(mangaId)}/`)
        const response = await this.post(
            '/api/v1/chapter/chapter-listing-by-title-id/',
            formEncode([
                ['title_id', rawTitleID(mangaId)],
                ['userSettingsEnabled', 'false']
            ]),
            token
        )
        return parseChapters(parseJSON<MangaBallChapterResponse>(response.data), mangaId)
    }

    async getChapterDetails(mangaId: string, chapterId: string): Promise<ChapterDetails> {
        const response = await this.get(`/chapter-detail/${encodeURIComponent(chapterId)}/`)
        return parseChapterDetails(String(response.data), mangaId, chapterId)
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

            const response = await this.search('', 1, config.sort)
            section.items = parseSearchResults(response)
            sectionCallback(section)
        }))
    }

    async getViewMoreItems(homepageSectionId: string, metadata: any): Promise<PagedResults> {
        const config = HOME_SECTIONS.find(section => section.id === homepageSectionId)
        if (!config) throw new Error(`Unknown MangaBall home section: ${homepageSectionId}`)
        const page = numericPage(metadata?.page)
        return this.pagedResults(await this.search('', page, config.sort), page)
    }

    async getSearchTags(): Promise<TagSection[]> {
        const token = await this.sessionToken(SEARCH_PAGE)
        const response = await this.post(
            '/api/v1/tag/search/',
            formEncode([['search_type', 'getTagFilter']]),
            token
        )
        const tags = namespaceTagSections(
            parseTagSections(parseJSON<MangaBallTagResponse>(response.data)),
            'tag',
            'exclude'
        )
        return [
            createFilterSection('sort', 'Sort', 'sort', [
                { value: 'updated_chapters_desc', label: 'Latest Updated Chapters' },
                { value: 'updated_chapters_asc', label: 'Oldest Updated Chapters' },
                { value: 'created_at_desc', label: 'Recently Added' },
                { value: 'created_at_asc', label: 'Oldest Added' },
                { value: 'name_asc', label: 'Title A–Z' },
                { value: 'name_desc', label: 'Title Z–A' },
                { value: 'views_desc', label: 'Most Viewed' },
                { value: 'views_asc', label: 'Least Viewed' }
            ], 'single'),
            createFilterSection('status', 'Publication Status', 'status', [
                { value: 'ongoing', label: 'Ongoing' },
                { value: 'completed', label: 'Completed' },
                { value: 'on_hold', label: 'On Hold' },
                { value: 'cancelled', label: 'Cancelled' },
                { value: 'hiatus', label: 'Hiatus' }
            ], 'single'),
            createFilterSection('origin', 'Original Format', 'origin', [
                { value: 'en', label: 'Comics' },
                { value: 'jp', label: 'Manga' },
                { value: 'kr', label: 'Manhwa' },
                { value: 'zh', label: 'Manhua' }
            ], 'single'),
            createFilterSection('demographic', 'Demographic', 'demographic', [
                { value: 'shounen', label: 'Shounen' },
                { value: 'shoujo', label: 'Shoujo' },
                { value: 'seinen', label: 'Seinen' },
                { value: 'josei', label: 'Josei' },
                { value: 'yuri', label: 'Yuri' }
            ], 'single'),
            createFilterSection('match', 'Match Included Tags', 'match', [
                { value: 'and', label: 'All selected tags' },
                { value: 'or', label: 'Any selected tag' }
            ], 'single'),
            ...tags
        ]
    }

    async getSearchResults(query: SearchRequest, metadata: any): Promise<PagedResults> {
        const page = numericPage(metadata?.page)
        const response = await this.search(
            query.title?.trim() ?? '',
            page,
            selectedValue(query, 'sort', query.title?.trim() ? 'updated_chapters_desc' : 'views_desc'),
            includedValues(query, 'tag'),
            excludedValues(query, 'tag'),
            selectedValue(query, 'match', query.includeOperator?.toLowerCase() === 'or' ? 'or' : 'and'),
            selectedValue(query, 'status', 'any'),
            selectedValue(query, 'origin', 'any'),
            selectedValue(query, 'demographic', 'any')
        )
        return this.pagedResults(response, page)
    }

    private pagedResults(response: MangaBallSearchResponse, page: number): PagedResults {
        const current = response.pagination?.current_page ?? page
        const last = response.pagination?.last_page ?? current
        return App.createPagedResults({
            results: parseSearchResults(response),
            metadata: current < last ? { page: current + 1 } : undefined
        })
    }

    private async search(
        title: string,
        page: number,
        sort: string,
        includedTags: string[] = [],
        excludedTags: string[] = [],
        includeMode = 'and',
        publicationStatus = 'any',
        originalLanguage = 'any',
        demographic = 'any'
    ): Promise<MangaBallSearchResponse> {
        const token = await this.sessionToken(SEARCH_PAGE)
        const fields: Array<[string, string | number | boolean]> = [
            ['search_input', title],
            ['filters[sort]', sort],
            ['filters[page]', page],
            ['filters[tag_included_mode]', includeMode],
            ['filters[tag_excluded_mode]', 'and'],
            ['filters[contentRating]', 'safe'],
            ['filters[demographic]', demographic],
            ['filters[person]', 'any'],
            ['filters[originalLanguages]', originalLanguage],
            ['filters[publicationYear]', ''],
            ['filters[publicationStatus]', publicationStatus],
            ['filters[translatedLanguage][]', 'en'],
            ['filters[userSettingsEnabled]', false]
        ]
        fields.push(...includedTags.map(tag => ['filters[tag_included_ids][]', tag] as [string, string]))
        fields.push(...excludedTags.map(tag => ['filters[tag_excluded_ids][]', tag] as [string, string]))

        const response = await this.post(
            '/api/v1/title/search-advanced/',
            formEncode(fields),
            token
        )
        return parseJSON<MangaBallSearchResponse>(response.data)
    }

    private async sessionToken(path: string): Promise<string> {
        const response = await this.get(path)
        return parseCSRF(String(response.data))
    }

    private async get(relativeURL: string): Promise<Response> {
        // Literal root authorizes all of MangaBall's rotating media subdomains.
        void MEDIA_HOST_ROOT
        const response = await this.requestManager.schedule(App.createRequest({
            url: `${MANGABALL_DOMAIN}${relativeURL}`,
            method: 'GET'
        }), 1)
        return checkedResponse(response)
    }

    private async post(relativeURL: string, data: string, csrfToken: string): Promise<Response> {
        const response = await this.requestManager.schedule(App.createRequest({
            url: `${MANGABALL_DOMAIN}${relativeURL}`,
            method: 'POST',
            headers: {
                'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'x-csrf-token': csrfToken,
                'x-requested-with': 'XMLHttpRequest'
            },
            data
        }), 1)
        return checkedResponse(response)
    }
}

function checkedResponse(response: Response): Response {
    if (response.status < 200 || response.status >= 300) {
        throw new Error(`MangaBall request failed with HTTP ${response.status}.`)
    }
    return response
}

function formEncode(fields: Array<[string, string | number | boolean]>): string {
    return fields
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
        .join('&')
}

function numericPage(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0
        ? Math.floor(value)
        : 1
}

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
    parseChapterDetails,
    parseChapters,
    parseMangaDetails,
    parseSearchPage
} from './WeebCentralParser'
import {
    createFilterSection,
    excludedValues,
    includedValues,
    selectedValue
} from '../SearchFilters'

const WEBCENTRAL_DOMAIN = 'https://weebcentral.com'
const COVER_HOST_ROOT = 'https://compsci88.com'
const PAGE_HOST_ROOT = 'https://lowee.us'
const PAGE_SIZE = 32

const GENRES = [
    'Action', 'Adventure', 'Comedy', 'Drama', 'Fantasy', 'Gender Bender',
    'Historical', 'Horror', 'Isekai', 'Josei', 'Martial Arts', 'Mecha',
    'Mystery', 'Psychological', 'Romance', 'School Life', 'Sci-Fi',
    'Seinen', 'Shoujo', 'Shounen', 'Slice of Life', 'Sports',
    'Supernatural', 'Tragedy', 'Yuri'
]

const HOME_SECTIONS: Array<{ id: string, title: string, sort: string, type: HomeSectionType }> = [
    { id: 'popular', title: 'Popular', sort: 'Popularity', type: HomeSectionType.featured },
    { id: 'latest', title: 'Latest Updates', sort: 'Latest Updates', type: HomeSectionType.singleRowLarge },
    { id: 'new', title: 'Recently Added', sort: 'Recently Added', type: HomeSectionType.singleRowNormal }
]

export const WeebCentralInfo: SourceInfo = {
    version: '1.1.1',
    name: 'WeebCentral',
    icon: 'icon.png',
    author: 'Hardcover contributors',
    description: 'Reads WeebCentral public pages with its adult-content filter fixed to false.',
    contentRating: ContentRating.MATURE,
    websiteBaseURL: WEBCENTRAL_DOMAIN,
    language: 'English',
    sourceTags: [],
    intents: SourceIntents.MANGA_CHAPTERS | SourceIntents.HOMEPAGE_SECTIONS
}

export class WeebCentral implements SearchResultsProviding, MangaProviding, ChapterProviding, HomePageSectionsProviding {
    requestManager = App.createRequestManager({
        requestsPerSecond: 3,
        requestTimeout: 30000,
        interceptor: {
            interceptRequest: async (request: Request): Promise<Request> => {
                request.headers = {
                    ...(request.headers ?? {}),
                    'accept': 'text/html,application/xhtml+xml',
                    'referer': `${WEBCENTRAL_DOMAIN}/`,
                    'user-agent': await this.requestManager.getDefaultUserAgent()
                }
                return request
            },
            interceptResponse: async (response: Response): Promise<Response> => response
        }
    })

    getMangaShareUrl(mangaId: string): string {
        return `${WEBCENTRAL_DOMAIN}/series/${encodeURIComponent(mangaId)}`
    }

    async getMangaDetails(mangaId: string): Promise<SourceManga> {
        const response = await this.get(`/series/${encodeURIComponent(mangaId)}`)
        return parseMangaDetails(String(response.data), mangaId)
    }

    async getChapters(mangaId: string): Promise<Chapter[]> {
        const response = await this.get(`/series/${encodeURIComponent(mangaId)}/full-chapter-list`)
        return parseChapters(String(response.data), mangaId)
    }

    async getChapterDetails(mangaId: string, chapterId: string): Promise<ChapterDetails> {
        const response = await this.get(`/chapters/${encodeURIComponent(chapterId)}/images?reading_style=long_strip`)
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

            const page = await this.search('', 0, config.sort)
            section.items = page.results
            sectionCallback(section)
        }))
    }

    async getViewMoreItems(homepageSectionId: string, metadata: any): Promise<PagedResults> {
        const config = HOME_SECTIONS.find(section => section.id === homepageSectionId)
        if (!config) throw new Error(`Unknown WeebCentral home section: ${homepageSectionId}`)
        const offset = numericOffset(metadata?.offset)
        return this.pagedResults(await this.search('', offset, config.sort), offset)
    }

    async getSearchTags(): Promise<TagSection[]> {
        return [
            createFilterSection('sort', 'Sort', 'sort', [
                { value: 'Best Match', label: 'Best Match' },
                { value: 'Alphabet', label: 'Alphabet' },
                { value: 'Popularity', label: 'Popularity' },
                { value: 'Subscribers', label: 'Subscribers' },
                { value: 'Recently Added', label: 'Recently Added' },
                { value: 'Latest Updates', label: 'Latest Updates' }
            ], 'single'),
            createFilterSection('order', 'Order', 'order', [
                { value: 'Ascending', label: 'Ascending' },
                { value: 'Descending', label: 'Descending' }
            ], 'single'),
            createFilterSection('official', 'Official Translation', 'official', [
                { value: 'True', label: 'Yes' },
                { value: 'False', label: 'No' }
            ], 'single'),
            createFilterSection('anime', 'Anime Adaptation', 'anime', [
                { value: 'True', label: 'Yes' },
                { value: 'False', label: 'No' }
            ], 'single'),
            createFilterSection('status', 'Series Status', 'status', [
                { value: 'Ongoing', label: 'Ongoing' },
                { value: 'Complete', label: 'Complete' },
                { value: 'Hiatus', label: 'Hiatus' },
                { value: 'Canceled', label: 'Canceled' }
            ], 'multiple'),
            createFilterSection('type', 'Series Type', 'type', [
                { value: 'Manga', label: 'Manga' },
                { value: 'Manhwa', label: 'Manhwa' },
                { value: 'Manhua', label: 'Manhua' },
                { value: 'OEL', label: 'OEL' }
            ], 'multiple'),
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
        const offset = numericOffset(metadata?.offset)
        const title = query.title?.trim() ?? ''
        const page = await this.search(
            title,
            offset,
            selectedValue(query, 'sort', title ? 'Best Match' : 'Popularity'),
            selectedValue(query, 'order', 'Descending'),
            selectedValue(query, 'official', 'Any'),
            selectedValue(query, 'anime', 'Any'),
            includedValues(query, 'status'),
            includedValues(query, 'type'),
            includedValues(query, 'genre'),
            excludedValues(query, 'genre')
        )
        return this.pagedResults(page, offset)
    }

    private pagedResults(
        page: ReturnType<typeof parseSearchPage>,
        offset: number
    ): PagedResults {
        return App.createPagedResults({
            results: page.results,
            metadata: page.hasNextPage ? { offset: offset + PAGE_SIZE } : undefined
        })
    }

    private async search(
        title: string,
        offset: number,
        sort: string,
        order = 'Descending',
        official = 'Any',
        anime = 'Any',
        includedStatuses: string[] = [],
        includedTypes: string[] = [],
        includedTags: string[] = [],
        excludedTags: string[] = []
    ): Promise<ReturnType<typeof parseSearchPage>> {
        const parameters: Array<[string, string | number]> = [
            ['limit', PAGE_SIZE],
            ['offset', offset],
            ['adult', 'False'],
            ['display_mode', 'Full Display'],
            ['official', official],
            ['anime', anime],
            ['order', order],
            ['sort', sort],
            ['text', title]
        ]
        parameters.push(...includedStatuses.map(status => ['included_status', status] as [string, string]))
        parameters.push(...includedTypes.map(type => ['included_type', type] as [string, string]))
        parameters.push(...includedTags.map(tag => ['included_tag', tag] as [string, string]))
        parameters.push(...excludedTags.map(tag => ['excluded_tag', tag] as [string, string]))

        const query = parameters
            .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
            .join('&')
        const response = await this.get(`/search/data?${query}`)
        return parseSearchPage(String(response.data))
    }

    private async get(relativeURL: string): Promise<Response> {
        // Literal roots let Hardcover authorize the site's rotating cover/page subdomains.
        void COVER_HOST_ROOT
        void PAGE_HOST_ROOT
        const response = await this.requestManager.schedule(App.createRequest({
            url: `${WEBCENTRAL_DOMAIN}${relativeURL}`,
            method: 'GET'
        }), 1)
        if (response.status < 200 || response.status >= 300) {
            throw new Error(`WeebCentral request failed with HTTP ${response.status}.`)
        }
        return response
    }
}

function numericOffset(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0
        ? Math.floor(value)
        : 0
}

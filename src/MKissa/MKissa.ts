import {
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
    MKissaDetailsResponse,
    MKissaListResponse,
    MKissaManga,
    parseJSON,
    parseMangaDetails,
    parseSearchResults
} from './MKissaParser'
import {
    createFilterSection,
    excludedValues,
    includedValues,
    selectedValue
} from '../SearchFilters'

const MKISSA_DOMAIN = 'https://mkissa.to'
const API_URL = 'https://api.mkissa.net/api'
const COVER_HOST = 'https://aln.youtube-anime.com'
const PAGE_SIZE = 24

const SAFE_GENRES = [
    '4 Koma', 'Action', 'Adventure', 'Cars', 'Comedy', 'Cooking', 'Drama',
    'Fantasy', 'Game', 'Gender Bender', 'Historical', 'Horror', 'Isekai',
    'Josei', 'Kids', 'Magic', 'Manhua', 'Manhwa', 'Martial Arts', 'Mecha',
    'Medical', 'Military', 'Music', 'Mystery', 'One Shot', 'Parody', 'Police',
    'Post Apocalyptic', 'Psychological', 'Reincarnation', 'Romance', 'Samurai',
    'School', 'Sci-Fi', 'Seinen', 'Shoujo', 'Shoujo Ai', 'Shounen',
    'Shounen Ai', 'Slice of Life', 'Space', 'Sports', 'Super Power',
    'Supernatural', 'Suspense', 'Thriller', 'Tragedy', 'Vampire', 'Webtoons',
    'Youkai', 'Zombies'
]

const LIST_QUERY = `
query($search: SearchInput, $limit: Int, $page: Int, $countryOrigin: VaildCountryOriginEnumType) {
  mangas(search: $search, limit: $limit, page: $page, countryOrigin: $countryOrigin) {
    pageInfo { total }
    edges {
      _id name englishName nativeName thumbnail type status genres tags
      description airedStart airedEnd countryOfOrigin
      score averageScore rating isAdult
    }
  }
}`

const DETAILS_QUERY = `
query($ids: [String!]!) {
  mangasWithIds(ids: $ids) {
    _id name englishName nativeName thumbnail description authors genres tags
    status altNames averageScore rating score airedStart
    airedEnd countryOfOrigin type isAdult
  }
}`

const HOME_SECTIONS: Array<{ id: string, title: string, sort: string, type: HomeSectionType }> = [
    { id: 'recent', title: 'Recent Catalog Updates', sort: 'Latest_Update', type: HomeSectionType.featured },
    { id: 'popular', title: 'Popular Manga', sort: 'Popular', type: HomeSectionType.singleRowLarge },
    { id: 'alphabetical', title: 'Browse A–Z', sort: 'Name_ASC', type: HomeSectionType.singleRowNormal }
]

export const MKissaInfo: SourceInfo = {
    version: '1.0.1',
    name: 'MKissa Catalog',
    icon: 'icon.png',
    author: 'Hardcover contributors',
    description: 'Catalog discovery and metadata only. MKissa does not provide manga chapter reading.',
    contentRating: ContentRating.MATURE,
    websiteBaseURL: MKISSA_DOMAIN,
    language: 'English',
    sourceTags: [],
    intents: SourceIntents.HOMEPAGE_SECTIONS
}

export class MKissa implements SearchResultsProviding, MangaProviding, HomePageSectionsProviding {
    requestManager = App.createRequestManager({
        requestsPerSecond: 2,
        requestTimeout: 30000,
        interceptor: {
            interceptRequest: async (request: Request): Promise<Request> => {
                request.headers = {
                    ...(request.headers ?? {}),
                    'accept': 'application/json',
                    'content-type': 'application/json',
                    'origin': MKISSA_DOMAIN,
                    'referer': `${MKISSA_DOMAIN}/`,
                    'user-agent': await this.requestManager.getDefaultUserAgent()
                }
                return request
            },
            interceptResponse: async (response: Response): Promise<Response> => response
        }
    })

    getMangaShareUrl(mangaId: string): string {
        return `${MKISSA_DOMAIN}/manga/${encodeURIComponent(mangaId)}`
    }

    async getMangaDetails(mangaId: string): Promise<SourceManga> {
        const response = parseJSON<MKissaDetailsResponse>(
            (await this.graphQL(DETAILS_QUERY, { ids: [mangaId] })).data
        )
        this.throwGraphQLErrors(response.errors)
        const manga = response.data?.mangasWithIds?.[0]
        if (!manga) throw new Error(`MKissa did not return catalog details for ${mangaId}.`)
        return parseMangaDetails(manga, mangaId)
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
            const page = await this.search(1, { sortBy: config.sort })
            section.items = parseSearchResults(page.items)
            sectionCallback(section)
        }))
    }

    async getViewMoreItems(homepageSectionId: string, metadata: any): Promise<PagedResults> {
        const config = HOME_SECTIONS.find(section => section.id === homepageSectionId)
        if (!config) throw new Error(`Unknown MKissa catalog section: ${homepageSectionId}`)
        const pageNumber = numericPage(metadata?.page)
        return this.pagedResults(
            await this.search(pageNumber, { sortBy: config.sort }),
            pageNumber
        )
    }

    async getSearchTags(): Promise<TagSection[]> {
        const currentYear = new Date().getFullYear()
        return [
            createFilterSection('sort', 'Sort', 'sort', [
                { value: 'Latest_Update', label: 'Latest Update' },
                { value: 'Popular', label: 'Popular' },
                { value: 'Name_ASC', label: 'Title A–Z' },
                { value: 'Name_DESC', label: 'Title Z–A' }
            ], 'single'),
            createFilterSection('origin', 'Origin', 'origin', [
                { value: 'JP', label: 'Japan' },
                { value: 'KR', label: 'Korea' },
                { value: 'CN', label: 'China' }
            ], 'single'),
            createFilterSection(
                'year',
                'Release Year',
                'year',
                Array.from({ length: 12 }, (_, index) => ({
                    value: String(currentYear - index),
                    label: String(currentYear - index)
                })),
                'single'
            ),
            createFilterSection(
                'genres',
                'Genres',
                'genre',
                SAFE_GENRES.map(label => ({ value: label, label })),
                'exclude'
            )
        ]
    }

    async getSearchResults(query: SearchRequest, metadata: any): Promise<PagedResults> {
        const pageNumber = numericPage(metadata?.page)
        const result = await this.search(pageNumber, {
            query: query.title?.trim() || undefined,
            sortBy: selectedValue(query, 'sort', query.title?.trim() ? 'Latest_Update' : 'Popular'),
            countryOrigin: includedValues(query, 'origin')[0],
            year: includedValues(query, 'year')[0],
            genres: includedValues(query, 'genre'),
            excludeGenres: excludedValues(query, 'genre')
        })
        return this.pagedResults(result, pageNumber)
    }

    private async search(
        page: number,
        options: {
            query?: string
            sortBy?: string
            countryOrigin?: string
            year?: string
            genres?: string[]
            excludeGenres?: string[]
        }
    ): Promise<{ items: MKissaManga[], total: number }> {
        const search: Record<string, any> = {
            allowAdult: false,
            allowUnknown: false,
            denyEcchi: true,
            isManga: true,
            sortBy: options.sortBy || 'Latest_Update',
            sortDirection: 'DSC'
        }
        if (options.query) search.query = options.query
        if (options.year) search.year = Number(options.year)
        if (options.genres?.length) search.genres = options.genres
        if (options.excludeGenres?.length) search.excludeGenres = options.excludeGenres

        const response = parseJSON<MKissaListResponse>(
            (await this.graphQL(LIST_QUERY, {
                search,
                limit: PAGE_SIZE,
                page,
                countryOrigin: options.countryOrigin || 'ALL'
            })).data
        )
        this.throwGraphQLErrors(response.errors)
        return {
            items: response.data?.mangas?.edges ?? [],
            total: Number(response.data?.mangas?.pageInfo?.total) || 0
        }
    }

    private pagedResults(
        result: { items: MKissaManga[], total: number },
        page: number
    ): PagedResults {
        const results = parseSearchResults(result.items)
        return App.createPagedResults({
            results,
            metadata: page * PAGE_SIZE < result.total ? { page: page + 1 } : undefined
        })
    }

    private async graphQL(query: string, variables: Record<string, any>): Promise<Response> {
        void COVER_HOST
        let response: Response
        try {
            response = await this.requestManager.schedule(App.createRequest({
                url: API_URL,
                method: 'POST',
                data: JSON.stringify({ query, variables })
            }), 1)
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            throw new Error(`MKissa catalog request could not be completed: ${message}`)
        }
        if (response.status < 200 || response.status >= 300) {
            const detail = typeof response.data === 'string'
                ? response.data.replace(/\s+/g, ' ').slice(0, 300)
                : ''
            throw new Error(
                `MKissa catalog request failed with HTTP ${response.status}`
                + (detail ? `: ${detail}` : '.')
            )
        }
        return response
    }

    private throwGraphQLErrors(errors: Array<{ message?: string }> | undefined): void {
        if (errors?.length) {
            throw new Error(errors.map(error => error.message || 'MKissa catalog error').join(' • '))
        }
    }
}

function numericPage(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0
        ? Math.floor(value)
        : 1
}

import {
    SourceManga,
    Chapter,
    ChapterDetails,
    HomeSection,
    SearchRequest,
    PagedResults,
    SourceInfo,
    ContentRating,
    Request,
    Response,
    TagSection,
    SourceIntents,
    ChapterProviding,
    MangaProviding,
    SearchResultsProviding,
    HomePageSectionsProviding,
    Tag
} from '@paperback/types'

import * as cheerio from 'cheerio'

import {
    parseChapterDetails,
    isLastPage,
    parseChapters,
    parseHomeSections,
    parseMangaDetails,
    parseViewMore,
    parseSearch,
    parseTags,
    parseBrowseResponse
} from './McReaderParser'
import {
    createFilterSection,
    excludedValues,
    includedValues,
    namespaceTagSections,
    selectedValue
} from '../SearchFilters'

const MCR_DOMAIN = 'https://www.mgeko.cc'
const MCR_IMAGE_CDN = 'https://imgsrv4.com'

export const McReaderInfo: SourceInfo = {
    version: '2.1.0',
    name: 'McReader',
    icon: 'icon.png',
    author: 'Netsky',
    authorWebsite: 'https://github.com/TheNetsky',
    description: 'Extension that pulls manga from mcreader.net (Manga-Raw.club)',
    contentRating: ContentRating.MATURE,
    websiteBaseURL: MCR_DOMAIN,
    sourceTags: [],
    intents: SourceIntents.MANGA_CHAPTERS | SourceIntents.HOMEPAGE_SECTIONS | SourceIntents.CLOUDFLARE_BYPASS_REQUIRED
}

export class McReader implements SearchResultsProviding, MangaProviding, ChapterProviding, HomePageSectionsProviding {

    requestManager = App.createRequestManager({
        requestsPerSecond: 4,
        requestTimeout: 15000,
        interceptor: {
            interceptRequest: async (request: Request): Promise<Request> => {
                const isImageCDNRequest = request.url.startsWith(MCR_IMAGE_CDN)
                request.headers = {
                    ...(request.headers ?? {}),
                    ...{
                        'referer': `${MCR_DOMAIN}/`,
                        'user-agent': await this.requestManager.getDefaultUserAgent(),
                        ...(isImageCDNRequest ? { 'origin': MCR_DOMAIN } : {})
                    }
                }
                return request
            },
            interceptResponse: async (response: Response): Promise<Response> => {
                return response
            }
        }
    });

    getMangaShareUrl(mangaId: string): string { return `${MCR_DOMAIN}/manga/${mangaId}` }

    async getMangaDetails(mangaId: string): Promise<SourceManga> {
        const request = App.createRequest({
            url: `${MCR_DOMAIN}/manga/${mangaId}`,
            method: 'GET'
        })

        const response = await this.requestManager.schedule(request, 1)
        this.CloudFlareError(response.status)
        const $ = cheerio.load(response.data as string)
        return parseMangaDetails($, mangaId)
    }

    async getChapters(mangaId: string): Promise<Chapter[]> {
        const request = App.createRequest({
            url: `${MCR_DOMAIN}/manga/${mangaId}/all-chapters`,
            method: 'GET'
        })

        const response = await this.requestManager.schedule(request, 1)
        this.CloudFlareError(response.status)
        const $ = cheerio.load(response.data as string)
        return parseChapters($, mangaId)
    }

    async getChapterDetails(mangaId: string, chapterId: string): Promise<ChapterDetails> {
        const request = App.createRequest({
            url: `${MCR_DOMAIN}/reader/en/${chapterId}`,
            method: 'GET'
        })

        const response = await this.requestManager.schedule(request, 1)
        this.CloudFlareError(response.status)
        const $ = cheerio.load(response.data as string)
        return parseChapterDetails($, mangaId, chapterId)
    }

    async getHomePageSections(sectionCallback: (section: HomeSection) => void): Promise<void> {
        const request = App.createRequest({
            url: `${MCR_DOMAIN}/jumbo/manga`,
            method: 'GET'
        })

        const response = await this.requestManager.schedule(request, 1)
        this.CloudFlareError(response.status)
        const $ = cheerio.load(response.data as string)
        parseHomeSections($, sectionCallback)
    }

    async getViewMoreItems(homepageSectionId: string, metadata: any): Promise<PagedResults> {
        const page: number = metadata?.page ?? 1
        let sort = ''

        switch (homepageSectionId) {
            case 'most_viewed':
                sort = 'popular_all_time'
                break
            case 'updated':
                sort = 'latest'
                break
            case 'new':
                sort = 'recently_added'
                break
            default:
                throw new Error('Requested to getViewMoreItems for a section ID which doesn\'t exist')
        }
        const request = App.createRequest({
            url: `${MCR_DOMAIN}/browse-comics/data/?page=${page}&safe_mode=1&sort=${sort}`,
            method: 'GET'
        })

        const response = await this.requestManager.schedule(request, 1)
        this.CloudFlareError(response.status)
        const browse = parseBrowseResponse(response.data)
        metadata = browse.currentPage < browse.totalPages
            ? { page: browse.currentPage + 1 }
            : undefined
        return App.createPagedResults({
            results: browse.results,
            metadata
        })
    }

    async getSearchTags(): Promise<TagSection[]> {
        const request = App.createRequest({
            url: `${MCR_DOMAIN}/browse-comics`,
            method: 'GET'
        })

        const response = await this.requestManager.schedule(request, 1)
        const $ = cheerio.load(response.data as string)
        return [
            createFilterSection('sort', 'Sort', 'sort', [
                { value: 'latest', label: 'Latest Update' },
                { value: 'recently_added', label: 'Recently Added' },
                { value: 'popular_daily', label: 'Popular Daily' },
                { value: 'popular_weekly', label: 'Popular Weekly' },
                { value: 'popular_monthly', label: 'Popular Monthly' },
                { value: 'popular_all_time', label: 'Popular All Time' },
                { value: 'rating', label: 'Top Rated' },
                { value: 'az', label: 'Title A–Z' },
                { value: 'za', label: 'Title Z–A' }
            ], 'single'),
            createFilterSection('status', 'Status', 'status', [
                { value: 'ongoing', label: 'Ongoing' },
                { value: 'completed', label: 'Completed' },
                { value: 'hiatus', label: 'Hiatus' }
            ], 'single'),
            createFilterSection('type', 'Type', 'type', [
                { value: 'manga', label: 'Manga' },
                { value: 'manhwa', label: 'Manhwa' },
                { value: 'manhua', label: 'Manhua' },
                { value: 'webtoon', label: 'Webtoon' }
            ], 'single'),
            createFilterSection('chapters', 'Minimum Chapters', 'minChapters', [
                { value: '1', label: '1+' },
                { value: '10', label: '10+' },
                { value: '25', label: '25+' },
                { value: '50', label: '50+' },
                { value: '100', label: '100+' }
            ], 'single'),
            createFilterSection('rating', 'Minimum Rating', 'minRating', [
                { value: '1', label: '1+' },
                { value: '2', label: '2+' },
                { value: '3', label: '3+' },
                { value: '4', label: '4+' }
            ], 'single'),
            createFilterSection('options', 'Options', 'option', [
                { value: 'only_completed', label: 'Only completed' },
                { value: 'only_translated', label: 'Only translated' },
                { value: 'hide_on_break', label: 'Hide long hiatus' }
            ], 'multiple'),
            ...namespaceTagSections(parseTags($), 'genre', 'exclude')
        ]
    }

    async getSearchResults(query: SearchRequest, metadata: any): Promise<PagedResults> {
        const page: number = metadata?.page ?? 1
        const parameters: Array<[string, string]> = [
            ['page', String(page)],
            ['safe_mode', '1'],
            ['sort', selectedValue(query, 'sort', 'latest')]
        ]
        const title = query.title?.trim()
        if (title) parameters.push(['q', title])
        const status = includedValues(query, 'status')[0]
        const type = includedValues(query, 'type')[0]
        const included = includedValues(query, 'genre')
        const excluded = excludedValues(query, 'genre')
        const minChapters = includedValues(query, 'minChapters')[0]
        const minRating = includedValues(query, 'minRating')[0]
        if (status) parameters.push(['status', status])
        if (type) parameters.push(['type', type])
        if (included.length > 0) parameters.push(['include_genres', included.join(',')])
        if (excluded.length > 0) parameters.push(['exclude_genres', excluded.join(',')])
        if (minChapters) parameters.push(['min_chapters', minChapters])
        if (minRating) parameters.push(['min_rating', minRating])
        for (const option of includedValues(query, 'option')) {
            parameters.push([option, '1'])
        }
        const queryString = parameters
            .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
            .join('&')
        const request = App.createRequest({
            url: `${MCR_DOMAIN}/browse-comics/data/?${queryString}`,
            method: 'GET'
        })

        const response = await this.requestManager.schedule(request, 1)
        const browse = parseBrowseResponse(response.data)
        metadata = browse.currentPage < browse.totalPages
            ? { page: browse.currentPage + 1 }
            : undefined
        return App.createPagedResults({
            results: browse.results,
            metadata
        })
    }

    CloudFlareError(status: number): void {
        if (status == 503 || status == 403) {
            throw new Error(`CLOUDFLARE BYPASS ERROR:\nPlease go to the homepage of <${McReader.name}> and press the cloud icon.`)
        }
    }

    async getCloudflareBypassRequestAsync(): Promise<Request> {
        return App.createRequest({
            url: MCR_DOMAIN,
            method: 'GET',
            headers: {
                'referer': `${MCR_DOMAIN}/`,
                'user-agent': await this.requestManager.getDefaultUserAgent()
            }
        })
    }
}

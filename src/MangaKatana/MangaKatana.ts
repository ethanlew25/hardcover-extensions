import {
    SourceManga,
    Chapter,
    ChapterDetails,
    HomeSection,
    SearchRequest,
    PagedResults,
    SourceInfo,
    TagSection,
    ContentRating,
    Request,
    Response,
    SourceIntents,
    ChapterProviding,
    MangaProviding,
    SearchResultsProviding,
    HomePageSectionsProviding,
    Tag
} from '@paperback/types'

import * as cheerio from 'cheerio'

import {
    isLastPage,
    parseTags,
    parseChapterDetails,
    parseChapters,
    parseHomeSections,
    parseMangaDetails,
    parseSearch,
    parseViewMore
} from './MangaKatanaParser'
import {
    createFilterSection,
    excludedValues,
    includedValues,
    namespaceTagSections,
    selectedValue
} from '../SearchFilters'

const MK_DOMAIN = 'https://mangakatana.com'

export const MangaKatanaInfo: SourceInfo = {
    version: '3.1.0',
    name: 'MangaKatana',
    icon: 'icon.png',
    author: 'Netsky',
    authorWebsite: 'https://github.com/TheNetsky',
    description: 'Extension that pulls manga from mangakatana.com',
    contentRating: ContentRating.MATURE,
    websiteBaseURL: MK_DOMAIN,
    sourceTags: [],
    intents: SourceIntents.MANGA_CHAPTERS | SourceIntents.HOMEPAGE_SECTIONS | SourceIntents.CLOUDFLARE_BYPASS_REQUIRED
}

export class MangaKatana implements SearchResultsProviding, MangaProviding, ChapterProviding, HomePageSectionsProviding {

    requestManager = App.createRequestManager({
        requestsPerSecond: 5,
        requestTimeout: 20000,
        interceptor: {
            interceptRequest: async (request: Request): Promise<Request> => {
                request.headers = {
                    ...(request.headers ?? {}),
                    ...{
                        'referer': `${MK_DOMAIN}/`,
                        'user-agent': await this.requestManager.getDefaultUserAgent()
                    }
                }
                return request
            },
            interceptResponse: async (response: Response): Promise<Response> => {
                return response
            }
        }
    });

    getMangaShareUrl(mangaId: string): string { return `${MK_DOMAIN}/manga/${mangaId}` }

    async getMangaDetails(mangaId: string): Promise<SourceManga> {
        const request = App.createRequest({
            url: `${MK_DOMAIN}/manga/${mangaId}`,
            method: 'GET'
        })

        const response = await this.requestManager.schedule(request, 1)
        const $ = cheerio.load(response.data as string)
        return parseMangaDetails($, mangaId)
    }

    async getChapters(mangaId: string): Promise<Chapter[]> {
        const request = App.createRequest({
            url: `${MK_DOMAIN}/manga/${mangaId}`,
            method: 'GET'
        })

        const response = await this.requestManager.schedule(request, 1)
        const $ = cheerio.load(response.data as string)
        return parseChapters($, mangaId)
    }

    async getChapterDetails(mangaId: string, chapterId: string): Promise<ChapterDetails> {
        const request = App.createRequest({
            url: `${MK_DOMAIN}/manga/${mangaId}/${chapterId}`,
            method: 'GET'
        })

        const response = await this.requestManager.schedule(request, 1)
        return parseChapterDetails(response.data as string, mangaId, chapterId)
    }

    async getSearchTags(): Promise<TagSection[]> {
        const request = App.createRequest({
            url: `${MK_DOMAIN}/genres`,
            method: 'GET'
        })

        const response = await this.requestManager.schedule(request, 1)
        const $ = cheerio.load(response.data as string)
        return [
            createFilterSection('sort', 'Sort', 'sort', [
                { value: 'latest', label: 'Latest Update' },
                { value: 'new', label: 'New Manga' },
                { value: 'az', label: 'Title A–Z' },
                { value: 'numc', label: 'Number of Chapters' }
            ], 'single'),
            createFilterSection('status', 'Status', 'status', [
                { value: '1', label: 'Ongoing' },
                { value: '2', label: 'Completed' },
                { value: '0', label: 'Cancelled' }
            ], 'single'),
            createFilterSection('chapters', 'Minimum Chapters', 'chapters', [
                { value: '1', label: '1+' },
                { value: '5', label: '5+' },
                { value: '10', label: '10+' },
                { value: '20', label: '20+' },
                { value: '50', label: '50+' },
                { value: '100', label: '100+' },
                { value: '200', label: '200+' }
            ], 'single'),
            createFilterSection('match', 'Match Included Genres', 'match', [
                { value: 'and', label: 'All selected genres' },
                { value: 'or', label: 'Any selected genre' }
            ], 'single'),
            ...namespaceTagSections(
                parseTags($),
                'genre',
                'exclude',
                new Set([
                    'adult', 'doujinshi', 'ecchi', 'erotica', 'loli',
                    'sexual violence', 'shota', 'smut', 'yaoi'
                ])
            )
        ]
    }

    async getHomePageSections(sectionCallback: (section: HomeSection) => void): Promise<void> {
        const request = App.createRequest({
            url: MK_DOMAIN,
            method: 'GET'
        })

        const response = await this.requestManager.schedule(request, 1)
        const $ = cheerio.load(response.data as string)
        parseHomeSections($, sectionCallback)
    }
    async getViewMoreItems(homepageSectionId: string, metadata: any): Promise<PagedResults> {
        const page: number = metadata?.page ?? 1
        let param = ''

        switch (homepageSectionId) {
            case 'hot_manga':
                param = `new-manga/page/${page}`
                break
            case 'latest_updates':
                param = `latest/page/${page}`
                break
            default:
                throw new Error(`Invalid homeSectionId | ${homepageSectionId}`)
        }

        const request = App.createRequest({
            url: `${MK_DOMAIN}/${param}`,
            method: 'GET'
        })

        const response = await this.requestManager.schedule(request, 1)
        const $ = cheerio.load(response.data as string)
        const manga = parseViewMore($)

        metadata = !isLastPage($) ? { page: page + 1 } : undefined
        return App.createPagedResults({
            results: manga,
            metadata
        })
    }

    async getSearchResults(query: SearchRequest, metadata: any): Promise<PagedResults> {
        const page: number = metadata?.page ?? 1

        let request
        if (query.title) {
            request = App.createRequest({
                url: `${MK_DOMAIN}/page/${page}?search=${encodeURI(query.title)}&search_by=book_name`,
                method: 'GET'
            })
        } else {
            const parameters: Array<[string, string]> = [
                ['filter', '1'],
                ['include_mode', selectedValue(query, 'match', 'and')],
                ['bookmark_opts', 'off'],
                ['chapters', selectedValue(query, 'chapters', '1')],
                ['order', selectedValue(query, 'sort', 'latest')]
            ]
            const included = includedValues(query, 'genre')
            const excluded = excludedValues(query, 'genre')
            const status = includedValues(query, 'status')[0]
            if (included.length > 0) parameters.push(['include', included.join('_')])
            if (excluded.length > 0) parameters.push(['exclude', excluded.join('_')])
            if (status) parameters.push(['status', status])
            const queryString = parameters
                .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
                .join('&')
            const path = page > 1 ? `/genres/page/${page}` : '/genres/'
            request = App.createRequest({
                url: `${MK_DOMAIN}${path}?${queryString}`,
                method: 'GET'
            })
        }

        const response = await this.requestManager.schedule(request, 1)
        const $ = cheerio.load(response.data as string)
        const manga = parseSearch($)

        metadata = !isLastPage($) ? { page: page + 1 } : undefined
        return App.createPagedResults({
            results: manga,
            metadata
        })
    }
}

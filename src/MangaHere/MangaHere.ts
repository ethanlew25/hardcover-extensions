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
    SearchResultsProviding,
    ChapterProviding,
    MangaProviding,
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
} from './MangaHereParser'

import { URLBuilder } from './MangaHereHelper'
import {
    createFilterSection,
    excludedValues,
    includedValues,
    namespaceTagSections,
    selectedValue
} from '../SearchFilters'

const MH_DOMAIN = 'https://www.mangahere.cc'
const MH_IMAGE_CDN = 'https://zjcdn.mangahere.org'

export const MangaHereInfo: SourceInfo = {
    version: '3.1.0',
    name: 'MangaHere',
    icon: 'icon.png',
    author: 'Netsky',
    authorWebsite: 'https://github.com/TheNetsky',
    description: 'Extension that pulls manga from mangahere.cc',
    contentRating: ContentRating.MATURE,
    websiteBaseURL: MH_DOMAIN,
    sourceTags: [],
    intents: SourceIntents.MANGA_CHAPTERS | SourceIntents.HOMEPAGE_SECTIONS | SourceIntents.CLOUDFLARE_BYPASS_REQUIRED
}

export class MangaHere implements SearchResultsProviding, MangaProviding, ChapterProviding, HomePageSectionsProviding {

    requestManager = App.createRequestManager({
        requestsPerSecond: 10,
        requestTimeout: 20000,
        interceptor: {
            interceptRequest: async (request: Request): Promise<Request> => {
                const isImageCDNRequest = request.url.startsWith(MH_IMAGE_CDN)
                request.headers = {
                    ...(request.headers ?? {}),
                    ...{
                        'referer': `${MH_DOMAIN}/`,
                        'user-agent': await this.requestManager.getDefaultUserAgent(),
                        ...(isImageCDNRequest ? { 'origin': MH_DOMAIN } : {})
                    }
                }, request.cookies = [
                    App.createCookie({ name: 'isAdult', value: '1', domain: 'www.mangahere.cc' })
                ]
                return request
            },
            interceptResponse: async (response: Response): Promise<Response> => {
                return response
            }
        }
    });

    getMangaShareUrl(mangaId: string): string { return `${MH_DOMAIN}/manga/${mangaId}` }

    async getMangaDetails(mangaId: string): Promise<SourceManga> {
        const request = App.createRequest({
            url: `${MH_DOMAIN}/manga/${mangaId}`,
            method: 'GET'
        })

        const response = await this.requestManager.schedule(request, 1)
        const $ = cheerio.load(response.data as string)
        return parseMangaDetails($, mangaId)
    }

    async getChapters(mangaId: string): Promise<Chapter[]> {
        const request = App.createRequest({
            url: `${MH_DOMAIN}/manga/${mangaId}`,
            method: 'GET'
        })

        const response = await this.requestManager.schedule(request, 1)
        const $ = cheerio.load(response.data as string)
        return parseChapters($, mangaId)
    }

    async getChapterDetails(mangaId: string, chapterId: string): Promise<ChapterDetails> {
        const request = App.createRequest({
            url: `${MH_DOMAIN}/manga/${mangaId}/${chapterId}/1.html`,
            method: 'GET'
        })

        const response = await this.requestManager.schedule(request, 1)
        const $ = cheerio.load(response.data as string)
        return parseChapterDetails($, mangaId, chapterId, request.url, this)
    }

    async getHomePageSections(sectionCallback: (section: HomeSection) => void): Promise<void> {
        const request = App.createRequest({
            url: MH_DOMAIN,
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
            case 'hot_release':
                param = 'hot'
                break
            case 'new_manga':
                param = `directory/${page}.htm?news`
                break
            case 'latest_updates':
                param = `latest/${page}`
                break
            default:
                throw new Error(`Invalid homeSectionId | ${homepageSectionId}`)
        }

        const request = App.createRequest({
            url: `${MH_DOMAIN}/${param}`,
            method: 'GET'
        })

        const response = await this.requestManager.schedule(request, 1)
        const $ = cheerio.load(response.data as string)
        const manga = parseViewMore($, homepageSectionId)

        metadata = !isLastPage($) ? { page: page + 1 } : undefined
        return App.createPagedResults({
            results: manga,
            metadata
        })
    }

    async getSearchResults(query: SearchRequest, metadata: any): Promise<PagedResults> {
        const page: number = metadata?.page ?? 1

        const url = new URLBuilder(MH_DOMAIN)
            .addPathComponent('search')
            .addQueryParameter('page', page)
            .addQueryParameter('title', encodeURIComponent(query?.title || ''))
            .addQueryParameter('genres', includedValues(query, 'genre').join('%2C'))
            .addQueryParameter('nogenres', excludedValues(query, 'genre').join('%2C'))
            .addQueryParameter('type', selectedValue(query, 'type', '0'))
            .addQueryParameter('st', selectedValue(query, 'completion', '0'))
            .addQueryParameter('rating', selectedValue(query, 'rating', ''))
            .buildUrl()

        const request = App.createRequest({
            url: url,
            method: 'GET'
        })

        const response = await this.requestManager.schedule(request, 1)
        const $ = cheerio.load(response.data as string)
        const manga = parseSearch($)

        metadata = !isLastPage($) ? { page: page + 1 } : undefined
        return App.createPagedResults({
            results: manga,
            metadata
        })
    }

    async getSearchTags(): Promise<TagSection[]> {
        const request = App.createRequest({
            url: `${MH_DOMAIN}/search?`,
            method: 'GET'
        })

        const response = await this.requestManager.schedule(request, 1)
        const $ = cheerio.load(response.data as string)
        return [
            createFilterSection('type', 'Type', 'type', [
                { value: '1', label: 'Japanese Manga' },
                { value: '2', label: 'Korean Manhwa' },
                { value: '3', label: 'Chinese Manhua' },
                { value: '4', label: 'European Manga' },
                { value: '5', label: 'American Manga' },
                { value: '6', label: 'Hong Kong Manga' },
                { value: '7', label: 'Other Manga' }
            ], 'single'),
            createFilterSection('completion', 'Completed Series', 'completion', [
                { value: '2', label: 'Completed' },
                { value: '1', label: 'Ongoing' }
            ], 'single'),
            createFilterSection('rating', 'Rating', 'rating', [
                { value: '5', label: '5 stars' },
                { value: '4', label: '4 stars' },
                { value: '3', label: '3 stars' },
                { value: '2', label: '2 stars' },
                { value: '1', label: '1 star' },
                { value: '0', label: 'No rating' }
            ], 'single'),
            ...namespaceTagSections(
                parseTags($),
                'genre',
                'exclude',
                new Set(['adult', 'doujinshi', 'hentai', 'lolicon', 'shotacon', 'smut', 'yaoi'])
            )
        ]
    }
}

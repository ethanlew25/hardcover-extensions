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
    SourceManga
} from '@paperback/types'

import {
    PepperCarrotEpisode,
    parseChapterDetails,
    parseChapters,
    parseEpisodes,
    parseMangaDetails,
    parsePartialManga
} from './PepperCarrotParser'

const PEPPER_CARROT_DOMAIN = 'https://www.peppercarrot.com'
const EPISODES_URL = `${PEPPER_CARROT_DOMAIN}/0_sources/episodes.json`
const MANGA_ID = 'pepper-and-carrot'

export const PepperCarrotInfo: SourceInfo = {
    version: '1.0.0',
    name: 'Pepper&Carrot',
    icon: 'icon.png',
    author: 'Hardcover contributors',
    description: 'Official CC BY 4.0 Pepper&Carrot episodes from the project’s documented API.',
    contentRating: ContentRating.EVERYONE,
    websiteBaseURL: PEPPER_CARROT_DOMAIN,
    language: 'English',
    sourceTags: [],
    intents: SourceIntents.MANGA_CHAPTERS | SourceIntents.HOMEPAGE_SECTIONS
}

export class PepperCarrot implements SearchResultsProviding, MangaProviding, ChapterProviding, HomePageSectionsProviding {
    requestManager = App.createRequestManager({
        requestsPerSecond: 3,
        requestTimeout: 20000,
        interceptor: {
            interceptRequest: async (request: Request): Promise<Request> => {
                request.headers = {
                    ...(request.headers ?? {}),
                    'accept': 'application/json,text/plain;q=0.9,*/*;q=0.8',
                    'referer': `${PEPPER_CARROT_DOMAIN}/`,
                    'user-agent': await this.requestManager.getDefaultUserAgent()
                }
                return request
            },
            interceptResponse: async (response: Response): Promise<Response> => response
        }
    })

    getMangaShareUrl(mangaId: string): string {
        this.assertMangaID(mangaId)
        return `${PEPPER_CARROT_DOMAIN}/en/webcomics/index.html`
    }

    async getMangaDetails(mangaId: string): Promise<SourceManga> {
        this.assertMangaID(mangaId)
        const episodes = await this.getEpisodes()
        return parseMangaDetails(episodes)
    }

    async getChapters(mangaId: string): Promise<Chapter[]> {
        this.assertMangaID(mangaId)
        const chapters = parseChapters(await this.getEpisodes())
        if (chapters.length === 0) {
            throw new Error('Pepper&Carrot returned no complete English episodes.')
        }
        return chapters
    }

    async getChapterDetails(mangaId: string, chapterId: string): Promise<ChapterDetails> {
        this.assertMangaID(mangaId)
        const episode = (await this.getEpisodes()).find(candidate => candidate.name === chapterId)
        if (!episode) throw new Error(`Unknown Pepper&Carrot episode: ${chapterId}`)
        return parseChapterDetails(episode)
    }

    async getHomePageSections(sectionCallback: (section: HomeSection) => void): Promise<void> {
        const section = App.createHomeSection({
            id: 'official-webcomic',
            title: 'Official Open Webcomic',
            type: HomeSectionType.featured,
            containsMoreItems: false,
            items: [parsePartialManga()]
        })
        sectionCallback(section)
    }

    async getViewMoreItems(homepageSectionId: string, metadata: unknown): Promise<PagedResults> {
        void metadata
        if (homepageSectionId !== 'official-webcomic') {
            throw new Error(`Unknown Pepper&Carrot section: ${homepageSectionId}`)
        }
        return App.createPagedResults({ results: [] })
    }

    async getSearchResults(query: SearchRequest, metadata: unknown): Promise<PagedResults> {
        void metadata
        const search = query.title?.trim().toLowerCase() ?? ''
        const searchable = 'pepper carrot david revoy fantasy witch open source creative commons'
        const matches = search.length === 0
            || search.split(/\s+/).every(term => searchable.includes(term))
        return App.createPagedResults({
            results: matches ? [parsePartialManga()] : []
        })
    }

    private async getEpisodes(): Promise<PepperCarrotEpisode[]> {
        const request = App.createRequest({ url: EPISODES_URL, method: 'GET' })
        let lastStatus = 0
        for (let attempt = 0; attempt < 2; attempt += 1) {
            const response = await this.requestManager.schedule(request, 1)
            lastStatus = response.status
            if (response.status >= 200 && response.status < 300) return parseEpisodes(response.data)
            if (response.status !== 429 && response.status < 500) break
        }
        throw new Error(`Pepper&Carrot API request failed with HTTP ${lastStatus}.`)
    }

    private assertMangaID(mangaId: string): void {
        if (mangaId !== MANGA_ID) throw new Error(`Unknown Pepper&Carrot title: ${mangaId}`)
    }
}

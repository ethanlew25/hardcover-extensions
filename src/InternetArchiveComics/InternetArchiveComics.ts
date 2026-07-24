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
    ArchiveMetadataResponse,
    CuratedArchiveItem,
    CURATED_ARCHIVE_ITEMS,
    assertReadableCuratedItem,
    chapterDetails,
    chapters,
    metadataManga,
    parseJSON,
    partialManga
} from './InternetArchiveComicsParser'
import {
    createFilterSection,
    includedValues,
    selectedValue
} from '../SearchFilters'

const ARCHIVE_DOMAIN = 'https://archive.org'
// Archive.org redirects BookReader images to hosts beneath this disclosed scope.
const ARCHIVE_IMAGE_REDIRECT_SCOPE = 'https://us.archive.org'

const HOME_SECTIONS: Array<{
    id: string
    title: string
    category?: CuratedArchiveItem['category']
    type: HomeSectionType
}> = [
    { id: 'sequential', title: 'Early Sequential Comics', category: 'sequential', type: HomeSectionType.featured },
    { id: 'cartoons', title: 'Cartoon Collections', category: 'cartoons', type: HomeSectionType.singleRowLarge },
    { id: 'satire', title: 'Illustrated Satire', category: 'satire', type: HomeSectionType.singleRowNormal }
]

export const InternetArchiveComicsInfo: SourceInfo = {
    version: '1.0.0',
    name: 'Public Domain Comics',
    icon: 'icon.png',
    author: 'Hardcover contributors',
    description: 'A curated set of readable, pre-1930 public-domain comics from Internet Archive.',
    contentRating: ContentRating.MATURE,
    websiteBaseURL: ARCHIVE_DOMAIN,
    language: 'English',
    sourceTags: [],
    intents: SourceIntents.MANGA_CHAPTERS | SourceIntents.HOMEPAGE_SECTIONS
}

export class InternetArchiveComics implements SearchResultsProviding, MangaProviding, ChapterProviding, HomePageSectionsProviding {
    requestManager = App.createRequestManager({
        requestsPerSecond: 3,
        requestTimeout: 30000,
        interceptor: {
            interceptRequest: async (request: Request): Promise<Request> => {
                request.headers = {
                    ...(request.headers ?? {}),
                    'accept': 'application/json,text/xml;q=0.9,*/*;q=0.8',
                    'referer': `${ARCHIVE_DOMAIN}/`,
                    'user-agent': await this.requestManager.getDefaultUserAgent()
                }
                return request
            },
            interceptResponse: async (response: Response): Promise<Response> => response
        }
    })

    getMangaShareUrl(mangaId: string): string {
        const item = this.item(mangaId)
        return `${ARCHIVE_DOMAIN}/details/${encodeURIComponent(item.identifier)}`
    }

    async getMangaDetails(mangaId: string): Promise<SourceManga> {
        const item = this.item(mangaId)
        return metadataManga(await this.getMetadata(item), item)
    }

    async getChapters(mangaId: string): Promise<Chapter[]> {
        const item = this.item(mangaId)
        return chapters(await this.getMetadata(item), item)
    }

    async getChapterDetails(mangaId: string, chapterId: string): Promise<ChapterDetails> {
        if (chapterId !== 'full-issue') throw new Error(`Unknown Internet Archive chapter: ${chapterId}`)
        const item = this.item(mangaId)
        const metadata = await this.getMetadata(item)
        const scandata = metadata.files.find(file => file.name.endsWith('_scandata.xml'))
        if (!scandata) throw new Error(`No BookReader page map is available for ${mangaId}.`)
        const response = await this.get(
            `${ARCHIVE_DOMAIN}/download/${encodeURIComponent(mangaId)}/${encodeURIComponent(scandata.name)}`
        )
        return chapterDetails(metadata, item, response.data, ARCHIVE_IMAGE_REDIRECT_SCOPE)
    }

    async getHomePageSections(sectionCallback: (section: HomeSection) => void): Promise<void> {
        for (const config of HOME_SECTIONS) {
            const items = CURATED_ARCHIVE_ITEMS
                .filter(item => !config.category || item.category === config.category)
                .map(partialManga)
            sectionCallback(App.createHomeSection({
                id: config.id,
                title: config.title,
                type: config.type,
                containsMoreItems: false,
                items
            }))
        }
    }

    async getViewMoreItems(homepageSectionId: string, metadata: unknown): Promise<PagedResults> {
        void metadata
        if (!HOME_SECTIONS.some(section => section.id === homepageSectionId)) {
            throw new Error(`Unknown Public Domain Comics section: ${homepageSectionId}`)
        }
        return App.createPagedResults({ results: [] })
    }

    async getSearchTags(): Promise<TagSection[]> {
        const creators = Array.from(new Set(CURATED_ARCHIVE_ITEMS.map(item => item.creator)))
            .sort((left, right) => left.localeCompare(right))
        return [
            createFilterSection('sort', 'Sort', 'sort', [
                { value: 'title-asc', label: 'Title A–Z' },
                { value: 'title-desc', label: 'Title Z–A' },
                { value: 'year-asc', label: 'Oldest First' },
                { value: 'year-desc', label: 'Newest First' }
            ], 'single'),
            createFilterSection('category', 'Format', 'category', [
                { value: 'sequential', label: 'Sequential Comics' },
                { value: 'cartoons', label: 'Cartoon Collections' },
                { value: 'satire', label: 'Illustrated Satire' }
            ], 'single'),
            createFilterSection(
                'creator',
                'Creator',
                'creator',
                creators.map(creator => ({ value: creator, label: creator })),
                'single'
            )
        ]
    }

    async getSearchResults(query: SearchRequest, metadata: unknown): Promise<PagedResults> {
        void metadata
        const terms = (query.title ?? '').toLowerCase().split(/\s+/).filter(Boolean)
        const category = includedValues(query, 'category')[0]
        const creator = includedValues(query, 'creator')[0]
        const sort = selectedValue(query, 'sort', 'title-asc')
        const results = CURATED_ARCHIVE_ITEMS
            .filter(item => !category || item.category === category)
            .filter(item => !creator || item.creator === creator)
            .filter(item => {
                const searchable = `${item.title} ${item.creator} ${item.year} ${item.categoryLabel}`.toLowerCase()
                return terms.every(term => searchable.includes(term))
            })
            .sort(itemSorter(sort))
            .map(partialManga)
        return App.createPagedResults({ results })
    }

    private item(mangaId: string): CuratedArchiveItem {
        const item = CURATED_ARCHIVE_ITEMS.find(candidate => candidate.identifier === mangaId)
        if (!item) throw new Error(`Unknown curated Internet Archive item: ${mangaId}`)
        return item
    }

    private async getMetadata(item: CuratedArchiveItem): Promise<ArchiveMetadataResponse> {
        const response = await this.get(`${ARCHIVE_DOMAIN}/metadata/${encodeURIComponent(item.identifier)}`)
        const metadata = parseJSON<ArchiveMetadataResponse>(response.data)
        assertReadableCuratedItem(metadata, item)
        return metadata
    }

    private async get(url: string): Promise<Response> {
        const request = App.createRequest({ url, method: 'GET' })
        let lastStatus = 0
        for (let attempt = 0; attempt < 2; attempt += 1) {
            const response = await this.requestManager.schedule(request, 1)
            lastStatus = response.status
            if (response.status >= 200 && response.status < 300) return response
            if (response.status !== 429 && response.status < 500) break
        }
        throw new Error(`Internet Archive request failed with HTTP ${lastStatus}.`)
    }
}

function itemSorter(sort: string): (left: CuratedArchiveItem, right: CuratedArchiveItem) => number {
    switch (sort) {
        case 'title-desc':
            return (left, right) => right.title.localeCompare(left.title)
        case 'year-asc':
            return (left, right) => left.year - right.year
        case 'year-desc':
            return (left, right) => right.year - left.year
        default:
            return (left, right) => left.title.localeCompare(right.title)
    }
}

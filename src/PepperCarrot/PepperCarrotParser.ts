import {
    Chapter,
    ChapterDetails,
    PartialSourceManga,
    SourceManga
} from '@paperback/types'

const PEPPER_CARROT_DOMAIN = 'https://www.peppercarrot.com'
const MANGA_ID = 'pepper-and-carrot'
const COVER_URL = `${PEPPER_CARROT_DOMAIN}/0_sources/ep01_Potion-of-Flight/low-res/en_Pepper-and-Carrot_by-David-Revoy_E01.jpg`

export interface PepperCarrotEpisode {
    name: string
    total_pages: number
    translated_languages: string[]
}

export function parseEpisodes(data: unknown): PepperCarrotEpisode[] {
    const raw = typeof data === 'string' ? JSON.parse(data) : data
    if (!Array.isArray(raw)) throw new Error('Pepper&Carrot returned an invalid episode index.')
    return raw.filter((value): value is PepperCarrotEpisode => {
        if (!value || typeof value !== 'object') return false
        const episode = value as Partial<PepperCarrotEpisode>
        return typeof episode.name === 'string'
            && /^ep\d+_[A-Za-z0-9-]+$/.test(episode.name)
            && typeof episode.total_pages === 'number'
            && Number.isFinite(episode.total_pages)
            && episode.total_pages >= 0
            && Array.isArray(episode.translated_languages)
            && episode.translated_languages.includes('en')
    })
}

export function parsePartialManga(): PartialSourceManga {
    return App.createPartialSourceManga({
        mangaId: MANGA_ID,
        title: 'Pepper&Carrot',
        image: COVER_URL,
        subtitle: 'David Revoy • CC BY 4.0'
    })
}

export function parseMangaDetails(episodes: PepperCarrotEpisode[]): SourceManga {
    return App.createSourceManga({
        id: MANGA_ID,
        mangaInfo: App.createMangaInfo({
            titles: ['Pepper&Carrot', 'Pepper and Carrot'],
            image: COVER_URL,
            status: 'Ongoing',
            author: 'David Revoy',
            artist: 'David Revoy',
            desc: 'A free, open-source fantasy webcomic about Pepper, a young witch, and her cat Carrot. '
                + `Includes ${episodes.length} complete English episodes from the official project API.`,
            hentai: false,
            tags: [
                App.createTagSection({
                    id: 'genres',
                    label: 'Genres',
                    tags: ['Comedy', 'Fantasy', 'Webcomic'].map(label => App.createTag({
                        id: label.toLowerCase(),
                        label
                    }))
                })
            ],
            additionalInfo: {
                License: 'Creative Commons Attribution 4.0',
                Attribution: 'Art and story by David Revoy',
                Source: 'Official Pepper&Carrot API'
            }
        })
    })
}

export function parseChapters(episodes: PepperCarrotEpisode[]): Chapter[] {
    return episodes.map(episode => {
        const number = episodeNumber(episode.name)
        return App.createChapter({
            id: episode.name,
            name: `Episode ${number}: ${episodeTitle(episode.name)}`,
            chapNum: number,
            sortingIndex: number,
            langCode: 'en',
            group: 'Pepper&Carrot'
        })
    })
}

export function parseChapterDetails(episode: PepperCarrotEpisode): ChapterDetails {
    const number = episodeNumber(episode.name)
    const paddedEpisode = String(number).padStart(2, '0')
    const pages: string[] = []
    for (let page = 0; page <= episode.total_pages; page += 1) {
        const paddedPage = String(page).padStart(2, '0')
        pages.push(
            `${PEPPER_CARROT_DOMAIN}/0_sources/${episode.name}/low-res/`
            + `en_Pepper-and-Carrot_by-David-Revoy_E${paddedEpisode}P${paddedPage}.jpg`
        )
    }
    return App.createChapterDetails({
        id: episode.name,
        mangaId: MANGA_ID,
        pages
    })
}

function episodeNumber(name: string): number {
    const match = /^ep(\d+)_/.exec(name)
    const value = match ? Number(match[1]) : NaN
    if (!Number.isFinite(value)) throw new Error(`Invalid Pepper&Carrot episode name: ${name}`)
    return value
}

function episodeTitle(name: string): string {
    return name.replace(/^ep\d+_/, '').replace(/-/g, ' ')
}

import {
    SearchRequest,
    Tag,
    TagSection
} from '@paperback/types'

export interface FilterChoice {
    label: string
    value: string
}

export type FilterSelectionKind = 'exclude' | 'multiple' | 'single'

export function createFilterSection(
    id: string,
    label: string,
    key: string,
    choices: FilterChoice[],
    kind: FilterSelectionKind
): TagSection {
    return App.createTagSection({
        id: `${id}:${kind}`,
        label,
        tags: choices.map(choice => App.createTag({
            id: `${key}:${choice.value}`,
            label: choice.label
        }))
    })
}

export function namespaceTagSections(
    sections: TagSection[],
    key: string,
    kind: FilterSelectionKind = 'exclude',
    blockedLabels: Set<string> = new Set()
): TagSection[] {
    const result: TagSection[] = []
    for (const section of sections) {
        const tags = (section.tags ?? [])
            .filter(tag => !blockedLabels.has(tag.label.trim().toLowerCase()))
            .map(tag => App.createTag({
                id: `${key}:${tag.id}`,
                label: tag.label
            }))
        if (tags.length === 0) continue
        result.push(App.createTagSection({
            id: `${section.id}:${kind}`,
            label: section.label,
            tags
        }))
    }
    return result
}

export function includedValues(query: SearchRequest, key: string): string[] {
    return values(query.includedTags ?? [], key)
}

export function excludedValues(query: SearchRequest, key: string): string[] {
    return values(query.excludedTags ?? [], key)
}

export function selectedValue(
    query: SearchRequest,
    key: string,
    fallback: string
): string {
    return includedValues(query, key)[0] ?? fallback
}

function values(tags: Tag[], key: string): string[] {
    const prefix = `${key}:`
    return tags
        .map(tag => tag.id)
        .filter(id => id.startsWith(prefix))
        .map(id => id.slice(prefix.length))
        .filter(Boolean)
}

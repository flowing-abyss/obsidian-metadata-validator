import { prepareFuzzySearch } from "obsidian";
import type { FuzzyMatch } from "obsidian";
import type { KeyboardPropertyItem } from "../types";

type Match = FuzzyMatch<KeyboardPropertyItem>;

/** Headers belong to rows, so arrow navigation never stops on a separator. */
export function sectionSuggestions(matches: Match[], selected?: Set<string>): Match[] {
  const section = (items: Match[], name: string, pinned = false): Match[] =>
    items.map((match, index) => ({
      ...match,
      item: { ...match.item, section: index === 0 ? name : undefined, pinned },
    }));
  if (selected) {
    const chosen = matches.filter(
      ({ item }) => item.kind === "option" && selected.has(item.option.value)
    );
    return chosen.length
      ? [...section(chosen, "Selected", true), ...section(matches, "All values")]
      : matches;
  }
  const required = matches.filter(
    ({ item }) => item.kind === "property" && item.property.field.required
  );
  const other = matches.filter(
    ({ item }) => item.kind === "property" && !item.property.field.required
  );
  return [...section(required, "Required"), ...section(other, "Other properties")];
}

/** Group before the native result limit, including selections far down a source. */
export function matchKeyboardSuggestions(
  items: KeyboardPropertyItem[],
  query: string,
  text: (item: KeyboardPropertyItem) => string
): Match[] {
  if (!query.trim()) return items.map((item) => ({ item, match: { score: 0, matches: [] } }));
  const search = prepareFuzzySearch(query);
  return items
    .flatMap((item) => {
      const match = search(text(item));
      return match ? [{ item, match }] : [];
    })
    .sort((a, b) => b.match.score - a.match.score);
}

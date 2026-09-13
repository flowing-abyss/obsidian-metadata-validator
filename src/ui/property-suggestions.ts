import type { PropertySuggestion, ResolvedSchema } from "../types";

export function propertySuggestions(schema: ResolvedSchema): PropertySuggestion[] {
  const order = new Set([
    ...(schema.formatting.property_order ?? []),
    ...Object.keys(schema.fields),
  ]);
  return Array.from(order).flatMap((key) => {
    const field = schema.fields[key];
    return field && !field.hidden ? [{ key, field, label: field.label || key }] : [];
  });
}

/** Fills `{{name}}` placeholders. Throws on a placeholder with no value, so typos surface in tests. */
export function renderTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => {
    const value = values[name];
    if (value === undefined) {
      throw new Error(`Missing value for template placeholder {{${name}}}`);
    }
    return value;
  });
}

import type { Section, Soundscape } from "./catalogue";

// The full attribution list, as Markdown, from the same catalogue as the
// in-app credits: sounds/CREDITS.md is this, written by `just credits`.
export function creditsMarkdown(
  sections: readonly Section[],
  soundscapes: readonly Soundscape[],
): string {
  const cell = (s: string) => s.replace(/\|/g, "\\|");
  const link = (text: string, url: string) =>
    `[${cell(text).replace(/[[\]]/g, "\\$&")}](${/[()\s]/.test(url) ? `<${url}>` : url})`;
  const rows = soundscapes.flatMap((s) => {
    const section = sections.find((x) => x.id === s.section)!.label;
    return s.tracks.map((t, i) =>
      [
        section,
        s.loops ? s.label : `${s.label} ${i + 1}`,
        link(t.title, t.sourceUrl) +
          (t.recorded ? `, recorded in ${cell(t.recorded)}` : ""),
        cell(t.author),
        link(t.licence.name, t.licence.url) +
          (t.sharedUnder
            ? `; this version is shared under ${t.sharedUnder}`
            : ""),
        cell(t.modifications),
      ].join(" | "),
    );
  });
  return [
    "# Credits",
    "",
    "Every recording in longquiet, with its source, licence and the changes made to it.",
    "Generated from [`sounds.json`](sounds.json) by `just credits`; edit that, not this.",
    "",
    "| Section | Sound | Recording | By | Licence | Changes made |",
    "| --- | --- | --- | --- | --- | --- |",
    ...rows.map((r) => `| ${r} |`),
    "",
  ].join("\n");
}

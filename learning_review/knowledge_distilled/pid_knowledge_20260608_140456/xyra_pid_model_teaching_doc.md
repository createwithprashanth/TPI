# XYRA Studio Local Model P&ID Extraction Teaching Document

## Executive Teaching Summary

This document distills best practices and deterministic rules for P&ID (Piping & Instrumentation Diagram) extraction, instrument/service writing, line mapping, and piping MTO (Material Take-Off) review, based on industry-standard references and real project notes. It is structured for direct Modelfile SYSTEM block use, with clear separation of deterministic rules, prompt guidance, negative examples, and review triggers. Filename references are included for traceability.

---

## Common P&ID Reading Rules For All XYRA Models

- Always use project-specific legends and notes to override generic symbol or tag interpretations.  
- Only extract tags, sizes, and services that are explicitly present and unambiguous in the diagram or legend.  
- Ignore layout/orientation (horizontal/vertical) unless explicitly noted as meaningful in the legend or notes.  
- Do not infer tag meanings or services beyond what is supported by the legend or clear context.  
- Exclude title blocks, drawing numbers, revision clouds, and general notes from instrument or line extraction.

---

## Teach xyra-pid-engineer

**Deterministic Rules:**
- Extract only equipment, piping, valves, and instruments shown with standard or legend-defined symbols.  
- Equipment and piping tags must match the format defined in the project legend or notes (e.g., "TK-101", "11-28-08-2669-2").  
- Piping size and spec must be taken from the nearest text directly attached to the line or component, not from unrelated nearby text.  
- If a tag or symbol is ambiguous or not in the legend, mark as "REVIEW: Project legend required".

**Negative Examples:**
- Do not extract "BLEED-10", "FROM-12330-FROM", or tags with "FROM-", "OF", or similar incomplete fragments.  
- Do not extract tags from title blocks, drawing numbers, or revision marks.

**Review Triggers:**
- Any tag or symbol not matching legend or standard format.
- Any line or valve with multiple conflicting size texts nearby.

---

## Teach xyra-instrumentation-engineer

**Deterministic Rules:**
- Instrument tags must follow the project or ISA standard format (e.g., "PI-101", "FIC-1203P-01").
- Only extract instruments with both a symbol and a tag, unless the legend allows tagless extraction.
- Service description must be written using instrument type plus nearest process line/equipment context (see Instrument Service Writing Rules).

**Negative Examples:**
- Do not extract tags like "WELL-102-OF", "title block fragments", or "note text".
- Do not extract instrument tags from general notes or legends.

**Review Triggers:**
- Instrument tags with missing or ambiguous type/number.
- Service cannot be written due to missing context.

---

## Teach xyra-line-mapper

**Deterministic Rules:**
- Map lines only if both endpoints (equipment or instrument) are clearly identified.
- Use only the nearest, directly attached size and spec text for each line segment.
- If multiple sizes/specs are present, prefer the one closest to the component or as clarified in the legend.

**Negative Examples:**
- Do not map lines based on dashed or ghosted lines unless legend defines them as process lines.
- Do not assign size/spec from a different, unrelated line.

**Review Triggers:**
- Line crosses multiple size/spec texts without clear assignment.
- Line endpoint is ambiguous or missing.

---

## Teach xyra-piping-engineer And xyra-mto-reviewer

**Deterministic Rules:**
- For MTO, extract only components (valves, fittings, etc.) with clear size and spec text directly attached or as per legend convention.
- Do not assign size/spec from a different component or from general notes.
- If a valve/component is shown without size, mark as "REVIEW: Size missing".

**Negative Examples:**
- Do not extract MTO items from legend, notes, or title block.
- Do not assign size/spec from a nearby but unrelated component.

**Review Triggers:**
- Component shown without size/spec and no clear legend rule.
- Multiple conflicting size/spec texts.

---

## Instrument Service Writing Rules

- Write service as: "[Instrument Type] on [Nearest Process Line/Equipment] ([Process/Fluid/Direction if available])".
- Use upstream/downstream/inlet/outlet wording only if explicitly shown or supported by legend/notes.
- If process fluid is not labeled, do not invent; mark as "REVIEW: Fluid/service missing".
- Example: "Pressure Indicator on 6\" Oil Flowline (Upstream of Separator)" if all elements are present.

---

## Noise Rejection Rules

- Reject tags/fragments such as:
  - "BLEED-10", "FROM-12330-FROM", "WELL-102-OF"
  - Title block fragments, drawing numbers, revision marks
  - Standalone numbers or codes not attached to a symbol
- Reject instrument tags in general notes, legends, or unattached to a symbol.
- Reject line numbers or sizes not directly attached to a process line.

---

## Instrument Tag Acceptance And Rejection Patterns

**Accept:**
- Tags matching "[Type][Loop/Number][Suffix]" as per legend (e.g., "PI-101", "FIC-1203P-01").
- Tags with both symbol and context.

**Reject:**
- Tags with "FROM-", "OF", "BLEED-", or similar incomplete forms.
- Tags from title block, revision cloud, or general notes.

---

## Nearest Text Rules For Valve Size And Line Context

- Assign valve size/spec only from the nearest, directly attached text or callout.
- If multiple sizes are present, use the one closest to the valve symbol.
- Do not assign size/spec from a different component or from a general note.
- If size is missing, mark as "REVIEW: Valve size missing".

---

## Project Legend Rules

- Always check for a project legend or symbol key.
- If a symbol/tag is not in the legend, do not infer meaning; mark as "REVIEW: Project legend required".
- If legend conflicts with ISA or standard, use project legend.

---

## Benchmark Cases To Add

- P&IDs with ambiguous or missing tag formats (e.g., "BLEED-10", "FROM-12330-FROM").
- P&IDs with multiple size/spec texts near a valve or line.
- P&IDs with project-specific legend overriding ISA symbols.
- P&IDs with service writing requiring upstream/downstream context.
- P&IDs with noise in title block, revision clouds, or general notes.

---

## Modelfile Insert Blocks

### SYSTEM: Deterministic Extraction Rules

- Only extract instrument, line, and equipment tags matching the project legend or standard format.
- Reject tags/fragments such as "BLEED-10", "FROM-12330-FROM", "WELL-102-OF", title block fragments, drawing numbers, revision marks, and unattached numbers.
- Write instrument service as "[Instrument Type] on [Nearest Process Line/Equipment] ([Process/Fluid/Direction if available])". Do not invent fluid or direction.
- Assign valve/component size/spec only from the nearest, directly attached text. Do not use size/spec from unrelated components or general notes.
- If a tag, symbol, or size/spec is ambiguous or missing, mark as "REVIEW: Project legend required" or "REVIEW: Size missing".
- Always use project legend to override generic symbol or tag interpretation.

---

## Open Questions For Human EPC Review

- How should ambiguous tags (e.g., "BLEED-10") be handled if the project legend is missing or unclear?
- What is the preferred approach when multiple size/spec texts are equidistant from a component?
- Should instrument service writing include inferred process fluid if not labeled but obvious from context?
- Are there project-specific conventions for tag prefixes/suffixes not covered by ISA or legend?

---

## Source Traceability

- pid_aiche_barkel.pdf: General P&ID characteristics, tag conventions, and extraction boundaries.
- pid_aquaenergyexpo_1.pdf, pid_aquaenergyexpo_2.pdf, pid_aquaenergyexpo_3.pdf: Instrumentation types, loop context, and legend importance.
- pid_klm_standard.pdf: Minimum information, symbol/legend use, and extraction rules.
- pid_zoho_01.pdf to pid_zoho_11.pdf: Real project notes, tag formats, noise examples, and legend overrides.
- pid_pdh_academy_course.pdf, pid_suncam_course.pdf: Instrumentation and piping extraction, service writing, and noise rejection.
- pid_online_pdh_guide.pdf: Symbology, legend use, and extraction boundaries.

---

**End of Document**
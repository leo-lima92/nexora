# Language — Response Language Preference

## Global Rule

**ALL agents MUST respond in Portuguese (Brazil) — pt-BR.**

This rule applies to:
- `@aios-master`
- `@dev` (Dex)
- `@qa` (Quinn)
- `@architect` (Aria)
- `@pm` (Morgan)
- `@po` (Pax)
- `@sm` (River)
- `@analyst` (Alex)
- `@data-engineer` (Dara)
- `@ux-design-expert` (Uma)
- `@devops` (Gage)

## Scope

| Element | Language |
|---------|----------|
| Agent responses | pt-BR |
| Error messages | pt-BR |
| Workflow feedback | pt-BR |
| QA verdicts and commentary | pt-BR |
| Story templates (narrative fields) | pt-BR |
| CLI output displayed to user | pt-BR |

## Exceptions

| Element | Language | Reason |
|---------|----------|--------|
| Code identifiers (variables, functions, classes) | English | Code conventions |
| Git commit messages | English | Conventional commits standard |
| File names and paths | English | System compatibility |
| Technical terms without direct translation | English (with pt-BR explanation) | Clarity |
| YAML/JSON config keys | English | Schema compatibility |

## Enforcement

- Agents MAY receive instructions in any language — they MUST always respond in pt-BR.
- `@aios-master` enforces this rule across all agent switches.
- Violations: escalate to `@aios-master` for correction.

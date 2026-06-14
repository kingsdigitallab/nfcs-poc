/**
 * Starter system-prompt flavours and task templates for the KCLFieldNode.
 * Sourced from the NFCS-AH PoC prompt-template reference (temp_data/prompt-templates.md).
 *
 * SYSTEM_PROMPT_FLAVOURS — 9 named registers for the "Voice" dropdown.
 * FIELD_STARTERS — 12 per-record + 5 aggregate task templates, each carrying
 *   a recommended model, temperature, mode, voice and prompt body.
 */

import type { PromptRecipe } from '../hooks/usePromptRecipes'

// ── System-prompt flavours ────────────────────────────────────────────────────

export interface SystemPromptFlavour {
  label:        string
  systemPrompt: string
}

export const SYSTEM_PROMPT_FLAVOURS: SystemPromptFlavour[] = [
  {
    label:        'Research assistant (default)',
    systemPrompt: 'You are a research assistant helping to analyse humanities research data.',
  },
  {
    label:        'Data parser',
    systemPrompt: 'You are a data processing function. Return only the requested value. Do not explain.',
  },
  {
    label:        'Entity extractor',
    systemPrompt: 'You are a named entity extractor. Return only valid JSON. Do not include explanation or prose.',
  },
  {
    label:        'Classifier',
    systemPrompt: 'You are a classifier. Assign the input to the requested category. Reply with the category label only.',
  },
  {
    label:        'Location extractor',
    systemPrompt: 'You are a location extractor. Identify and return place names only. No commentary.',
  },
  {
    label:        'Language detector',
    systemPrompt: 'You are a language detector. Return the ISO 639-1 language code only.',
  },
  {
    label:        'Binary classifier',
    systemPrompt: 'You are a binary classifier. Reply only with Yes or No.',
  },
  {
    label:        'Field parser',
    systemPrompt: 'You are a data extraction function. Parse the input and return only the requested fields in the specified format.',
  },
  {
    label:        'Vocabulary normaliser',
    systemPrompt: 'You are a vocabulary normaliser. Map the input to the closest term from the provided list. Return the matched term only.',
  },
]

// ── Per-record task templates (§2 of prompt reference) ────────────────────────

const PER_RECORD_STARTERS: PromptRecipe[] = [
  {
    id:                 'builtin-field-date-normalisation',
    name:               '2.1 Date normalisation',
    nodeFamily:         'field',
    mode:               'per-record',
    builtIn:            true,
    model:              'arc:nano',
    temperature:        0,
    systemPrompt:       'You are a data processing function. Return only the requested value. Do not explain.',
    userPromptTemplate:
      'Return a 4-digit year only. No other text or punctuation.\n' +
      'For a range, use the first year.\n' +
      'For a century, use the midpoint (e.g. 14th century = 1350).\n' +
      'For "before X" or "after X", use X.\n' +
      'For approximate dates, use the year as stated.\n\n' +
      '{{value}}',
  },
  {
    id:                 'builtin-field-relevance-assessment',
    name:               '2.2 Relevance assessment',
    nodeFamily:         'field',
    mode:               'per-record',
    builtIn:            true,
    model:              'arc:nano',
    temperature:        0,
    systemPrompt:       'You are a binary classifier. Reply only with Yes or No.',
    userPromptTemplate:
      'My research question is: [YOUR RESEARCH QUESTION]\n\n' +
      'Does the following record appear relevant to this research question?\n' +
      'Reply Yes or No, followed by one sentence of explanation.\n\n' +
      '{{value}}',
  },
  {
    id:                 'builtin-field-plain-summary',
    name:               '2.3 Plain language summary',
    nodeFamily:         'field',
    mode:               'per-record',
    builtIn:            true,
    model:              'arc:nano',
    temperature:        0.3,
    systemPrompt:       'You are a research assistant helping to analyse humanities research data.',
    userPromptTemplate:
      'Summarise the following record in plain English in two sentences.\n' +
      'Assume the reader is unfamiliar with specialist terminology.\n\n' +
      '{{value}}',
  },
  {
    id:                 'builtin-field-period-assignment',
    name:               '2.4 Historical period assignment',
    nodeFamily:         'field',
    mode:               'per-record',
    builtIn:            true,
    model:              'arc:nano',
    temperature:        0,
    systemPrompt:       'You are a classifier. Assign the input to the requested category. Reply with the category label only.',
    userPromptTemplate:
      'Identify the primary historical period this record relates to.\n' +
      'Reply with the period name only — for example:\n' +
      'Prehistoric, Bronze Age, Iron Age, Roman, Early Medieval, Medieval,\n' +
      'Tudor, Stuart, Georgian, Victorian, Edwardian, Interwar, Post-war.\n\n' +
      '{{value}}',
  },
  {
    id:                 'builtin-field-argument-extraction',
    name:               '2.5 Argument or thesis extraction',
    nodeFamily:         'field',
    mode:               'per-record',
    builtIn:            true,
    model:              'arc:lite',
    temperature:        0.2,
    systemPrompt:       'You are a research assistant helping to analyse humanities research data.',
    userPromptTemplate:
      'This is an extract from a historical or scholarly text.\n' +
      'State the author\'s central argument in one sentence.\n' +
      'If no clear argument is present, reply: "Descriptive — no argument identified."\n\n' +
      '{{value}}',
  },
  {
    id:                 'builtin-field-named-entity-extraction',
    name:               '2.6 Named entity extraction',
    nodeFamily:         'field',
    mode:               'per-record',
    builtIn:            true,
    model:              'arc:lite',
    temperature:        0,
    systemPrompt:       'You are a named entity extractor. Return only valid JSON. Do not include explanation or prose.',
    userPromptTemplate:
      'From the following text, extract all named individual persons and specific places.\n' +
      'List each name once only. Use the most informative context available.\n' +
      'Reply in JSON only, no preamble:\n' +
      '{"persons":[{"name":"...","context":"..."}],"places":[{"name":"...","context":"..."}]}\n\n' +
      '{{value}}',
  },
  {
    id:                 'builtin-field-material-extraction',
    name:               '2.7 Material extraction',
    nodeFamily:         'field',
    mode:               'per-record',
    builtIn:            true,
    model:              'arc:nano',
    temperature:        0,
    systemPrompt:       'You are a data extraction function. Parse the input and return only the requested fields in the specified format.',
    userPromptTemplate:
      'From the following description, state only the material or medium of the object described.\n' +
      'Reply with one to three words only. No other text.\n\n' +
      '{{value}}',
  },
  {
    id:                 'builtin-field-description-gap',
    name:               '2.8 Description gap identification',
    nodeFamily:         'field',
    mode:               'per-record',
    builtIn:            true,
    model:              'arc:nano',
    temperature:        0.2,
    systemPrompt:       'You are a research assistant helping to analyse humanities research data.',
    userPromptTemplate:
      'The following is a catalogue record from a museum or archive.\n' +
      'List any important descriptive information that appears to be missing or incomplete.\n' +
      'Be specific — name the absent fields rather than describing them in general terms.\n\n' +
      '{{value}}',
  },
  {
    id:                 'builtin-field-research-note',
    name:               '2.9 Research note generation',
    nodeFamily:         'field',
    mode:               'per-record',
    builtIn:            true,
    model:              'arc:lite',
    temperature:        0.3,
    systemPrompt:       'You are a research assistant helping to analyse humanities research data.',
    userPromptTemplate:
      'Convert the following metadata record into a brief research note suitable for a\n' +
      'bibliography or research log. Include: what the item is, when it dates from,\n' +
      'who created it, and where it is held. Write in prose, three sentences maximum.\n\n' +
      '{{value}}',
  },
  {
    id:                 'builtin-field-keyword-suggestion',
    name:               '2.10 Subject keyword suggestion',
    nodeFamily:         'field',
    mode:               'per-record',
    builtIn:            true,
    model:              'arc:nano',
    temperature:        0.2,
    systemPrompt:       'You are a data extraction function. Parse the input and return only the requested fields in the specified format.',
    userPromptTemplate:
      'From the following record, suggest up to five subject keywords not already\n' +
      'present in the subject field. These should reflect the intellectual content\n' +
      'of the item rather than its format or location.\n' +
      'Reply as a comma-separated list only.\n\n' +
      '{{value}}',
  },
  {
    id:                 'builtin-field-archaic-clarification',
    name:               '2.11 Archaic language clarification',
    nodeFamily:         'field',
    mode:               'per-record',
    builtIn:            true,
    model:              'arc:lite',
    temperature:        0.3,
    systemPrompt:       'You are a research assistant helping to analyse humanities research data.',
    userPromptTemplate:
      'The following is an extract from an early modern or specialist text.\n' +
      'Restate its meaning in clear modern English in two or three sentences.\n' +
      'Do not quote the original — paraphrase only.\n\n' +
      '{{value}}',
  },
  {
    id:                 'builtin-field-place-extraction',
    name:               '2.12 Place name extraction',
    nodeFamily:         'field',
    mode:               'per-record',
    builtIn:            true,
    model:              'arc:nano',
    temperature:        0,
    systemPrompt:       'You are a location extractor. Identify and return place names only. No commentary.',
    userPromptTemplate:
      'Extract every place name mentioned in the following text.\n' +
      'Return a comma-separated list of place names only. No other text.\n\n' +
      '{{value}}',
  },
]

// ── Aggregate task templates (§3 of prompt reference) ─────────────────────────

const AGGREGATE_STARTERS: PromptRecipe[] = [
  {
    id:                 'builtin-field-thematic-synthesis',
    name:               '3.1 Thematic synthesis',
    nodeFamily:         'field',
    mode:               'aggregate',
    builtIn:            true,
    model:              'arc:nexus',
    temperature:        0.4,
    systemPrompt:       'You are a research assistant helping to analyse humanities research data.',
    userPromptTemplate:
      'The following records were retrieved from one or more cultural heritage\n' +
      'data services using the search term "[YOUR SEARCH TERM]".\n\n' +
      'Identify the three or four main themes that run across the set.\n' +
      'Note any significant gaps, biases, or unexpected inclusions in what is represented.\n\n' +
      '{{values}}',
  },
  {
    id:                 'builtin-field-fitness-assessment',
    name:               '3.2 Fitness for purpose assessment',
    nodeFamily:         'field',
    mode:               'aggregate',
    builtIn:            true,
    model:              'arc:nexus',
    temperature:        0.3,
    systemPrompt:       'You are a research assistant helping to analyse humanities research data.',
    userPromptTemplate:
      'My research question is: [YOUR RESEARCH QUESTION]\n\n' +
      'The following is a set of records from a federated search across\n' +
      'cultural heritage and research data services.\n\n' +
      'Assess how well this result set would support the research question.\n' +
      'Address three points:\n' +
      '1. What is well represented.\n' +
      '2. What appears to be missing.\n' +
      '3. Whether the set is sufficient to proceed, or what additional searching is needed.\n\n' +
      '{{values}}',
  },
  {
    id:                 'builtin-field-comparative-analysis',
    name:               '3.3 Comparative analysis across time',
    nodeFamily:         'field',
    mode:               'aggregate',
    builtIn:            true,
    model:              'arc:nexus',
    temperature:        0.4,
    systemPrompt:       'You are a research assistant helping to analyse humanities research data.',
    userPromptTemplate:
      'The following are summaries of [NUMBER] texts or records relating to [TOPIC],\n' +
      'spanning [DATE RANGE].\n\n' +
      'Compare the positions or perspectives represented:\n' +
      'what do they agree on, where do they differ, and what types\n' +
      'of evidence or argument does each rely on?\n' +
      'Is there a consistent thread across all of them despite those differences?\n\n' +
      '{{values}}',
  },
  {
    id:                 'builtin-field-interpret-extraction',
    name:               '3.4 Interpret an aggregated extraction',
    nodeFamily:         'field',
    mode:               'aggregate',
    builtIn:            true,
    model:              'arc:lite',
    temperature:        0.3,
    systemPrompt:       'You are a research assistant helping to analyse humanities research data.',
    userPromptTemplate:
      'The following is a list of [FIELD — e.g. persons / places / materials]\n' +
      'extracted from a set of records retrieved by a federated search.\n\n' +
      'What patterns are visible in this list?\n' +
      'Note any concentrations, absences, or unexpected entries\n' +
      'that might be significant for a researcher working on [YOUR TOPIC].\n\n' +
      '{{values}}',
  },
  {
    id:                 'builtin-field-documentation-audit',
    name:               '3.5 Cross-collection documentation audit',
    nodeFamily:         'field',
    mode:               'aggregate',
    builtIn:            true,
    model:              'arc:lite',
    temperature:        0.3,
    systemPrompt:       'You are a research assistant helping to analyse humanities research data.',
    userPromptTemplate:
      'The following records come from [NUMBER] different data services or collections.\n' +
      'Each record represents the same class of object: [OBJECT TYPE].\n\n' +
      'Compare how the collections document this class of object.\n' +
      'Which fields are consistently present across all sources?\n' +
      'Which are absent or inconsistently applied?\n' +
      'What would a researcher lose by relying on any single collection alone?\n\n' +
      '{{values}}',
  },
]

// ── Exported combined list ─────────────────────────────────────────────────────

export const FIELD_STARTERS: PromptRecipe[] = [
  ...PER_RECORD_STARTERS,
  ...AGGREGATE_STARTERS,
]

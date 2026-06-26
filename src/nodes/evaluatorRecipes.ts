/**
 * Built-in rubric presets for EvaluatorNode.
 *
 * All presets use {{__reference}} and {{__candidate}} tokens which are
 * injected by the runner/component before template substitution, so they
 * work regardless of which field names the user has selected.
 *
 * Temperature is always 0 for repeatability; the prompts are structured
 * to elicit constrained JSON output with reason-then-score ordering.
 */

export interface EvaluatorRecipe {
  key:    string
  label:  string
  prompt: string
}

export const EVALUATOR_RECIPES: EvaluatorRecipe[] = [
  {
    key:   'extraction-agreement',
    label: 'Extraction agreement',
    prompt: `You are scoring a model's field extraction against a human annotation.
Judge ONLY using the two texts provided. Do not use outside knowledge.
Length and fluency are not criteria.

HUMAN ANNOTATION (gold standard):
{{__reference}}

MODEL OUTPUT (to be judged):
{{__candidate}}

Score each criterion. Give a one-sentence reason, then the score.
c1 site_type: 2 = same type; 1 = related but less/more specific; 0 = wrong or missing
c2 period:    2 = same period; 1 = correct era, wrong specificity; 0 = wrong or missing
c3 region:    2 = same place; 1 = correct but broader/narrower; 0 = wrong or missing
c4 hallucination: 0 = introduces a value absent from the annotation; 1 = no invented values

Respond with ONLY this JSON, no other text:
{"c1_reason":"","c1":0,"c2_reason":"","c2":0,"c3_reason":"","c3":0,"c4_reason":"","c4":1}`,
  },
  {
    key:   'interpretive-agreement',
    label: 'Interpretive agreement',
    prompt: `You are comparing a model's interpretation of a historical text against a
human scholar's annotation of the same text. Judge ONLY on agreement between
the two provided texts. Do not use outside knowledge about the subject.
A short, correct interpretation scores higher than a long, partly-wrong one.

HUMAN SCHOLAR'S NOTE (reference):
{{__reference}}

MODEL INTERPRETATION (candidate):
{{__candidate}}

c1 core_claim: does the candidate identify the same central claim as the note?
   2 = same claim; 1 = related but materially different emphasis; 0 = different or absent
c2 evidence: does it cite the same reasoning/authority the note relies on?
   2 = same; 1 = partial; 0 = none or wrong
c3 fabrication: 0 = adds a claim, name, or date not in the note or source; 1 = stays grounded

Give a one-sentence reason then a score for each.
Respond with ONLY this JSON:
{"c1_reason":"","c1":0,"c2_reason":"","c2":0,"c3_reason":"","c3":0}`,
  },
  {
    key:   'rubric-from-note',
    label: 'Rubric from note',
    prompt: `You are applying a human-written rubric to a model output. The rubric below
was written by a researcher. Apply it exactly as written; do not add or relax
criteria. Judge only on the provided output. Do not use outside knowledge.

RUBRIC (apply exactly):
{{__reference}}

MODEL OUTPUT (to be judged):
{{__candidate}}

For each numbered criterion in the rubric, give a one-sentence reason and a
score on the scale that criterion specifies. If the rubric is ambiguous about
a criterion, score it 0 and say why in the reason.

Respond with ONLY a JSON object keyed by criterion number, e.g.:
{"1_reason":"","1":0,"2_reason":"","2":0}`,
  },
]

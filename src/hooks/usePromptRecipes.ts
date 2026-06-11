import { useState, useEffect } from 'react'

export interface PromptRecipe {
  id:                 string
  name:               string
  nodeFamily:         'standard' | 'field'
  mode?:              'per-record' | 'aggregate'
  systemPrompt:       string
  userPromptTemplate: string
  builtIn?:           true
}

const RECIPES_VERSION = '2026-06-11-v1'

const BUILT_IN_RECIPES: PromptRecipe[] = [
  // Standard nodes (KCLNode, OllamaNode)
  {
    id: 'builtin-extract-persons-json',
    name: 'Extract persons — JSON',
    nodeFamily: 'standard',
    builtIn: true,
    systemPrompt: 'You are a precise data extraction assistant. Return only valid JSON, no explanation.',
    userPromptTemplate: 'Identify every person mentioned in the following text. Return a JSON array of objects with "name" (string) and "type" (one of: historical, contemporary, mythological, unknown) fields. Return an empty array [] if no persons are found.\n\n{{content}}',
  },
  {
    id: 'builtin-extract-places-json',
    name: 'Extract places — JSON',
    nodeFamily: 'standard',
    builtIn: true,
    systemPrompt: 'You are a precise data extraction assistant. Return only valid JSON, no explanation.',
    userPromptTemplate: 'Identify every place mentioned in the following text. Return a JSON array of objects with "name" (string) and "type" (one of: settlement, region, country, landmark, mythological, unknown) fields. Return [] if none.\n\n{{content}}',
  },
  {
    id: 'builtin-summarise-briefly',
    name: 'Summarise briefly',
    nodeFamily: 'standard',
    builtIn: true,
    systemPrompt: 'You are a concise research assistant.',
    userPromptTemplate: 'Summarise the following in 2–3 sentences:\n\n{{content}}',
  },

  // Field nodes, per-record
  {
    id: 'builtin-extract-persons-field-per',
    name: 'Extract persons from field — JSON',
    nodeFamily: 'field',
    mode: 'per-record',
    builtIn: true,
    systemPrompt: 'You are a precise data extraction assistant. Return only valid JSON, no explanation.',
    userPromptTemplate: 'Identify every person mentioned in the following {{field}} text. Return a JSON array of objects with "name" and "type" (historical/contemporary/mythological/unknown). Return [] if none.\n\n{{value}}',
  },
  {
    id: 'builtin-extract-places-field-per',
    name: 'Extract places from field — JSON',
    nodeFamily: 'field',
    mode: 'per-record',
    builtIn: true,
    systemPrompt: 'You are a precise data extraction assistant. Return only valid JSON, no explanation.',
    userPromptTemplate: 'Identify every place mentioned in the following {{field}} text. Return a JSON array with "name" and "type" (settlement/region/country/landmark/mythological/unknown). Return [] if none.\n\n{{value}}',
  },
  {
    id: 'builtin-summarise-field-per',
    name: 'Summarise record field',
    nodeFamily: 'field',
    mode: 'per-record',
    builtIn: true,
    systemPrompt: 'You are a concise research assistant.',
    userPromptTemplate: 'Summarise the following {{field}} in 2–3 sentences:\n\n{{value}}',
  },

  // Field nodes, aggregate
  {
    id: 'builtin-thematic-summary-agg',
    name: 'Thematic summary',
    nodeFamily: 'field',
    mode: 'aggregate',
    builtIn: true,
    systemPrompt: 'You are a concise research assistant.',
    userPromptTemplate: 'The following are {{field}} values from {{count}} research records. Provide a concise thematic summary of what this collection covers:\n\n{{values}}',
  },
  {
    id: 'builtin-list-entities-agg',
    name: 'List unique entities',
    nodeFamily: 'field',
    mode: 'aggregate',
    builtIn: true,
    systemPrompt: 'You are a precise data extraction assistant. Return only valid JSON, no explanation.',
    userPromptTemplate: 'The following are {{count}} {{field}} values from research records. List the distinct named entities (persons, places, organisations) mentioned across all values, grouped by type.\n\n{{values}}',
  },
]

export function usePromptRecipes() {
  const [userRecipes, setUserRecipes] = useState<PromptRecipe[]>([])

  // Load from localStorage on mount
  useEffect(() => {
    const storedVersion = localStorage.getItem('nfcs_prompt_recipes_version')
    const stored = localStorage.getItem('nfcs_prompt_recipes')

    if (storedVersion === RECIPES_VERSION && stored) {
      try {
        const parsed = JSON.parse(stored) as PromptRecipe[]
        setUserRecipes(parsed)
      } catch { setUserRecipes([]) }
    } else {
      localStorage.removeItem('nfcs_prompt_recipes')
      setUserRecipes([])
    }
  }, [])

  // All recipes: built-ins first, then user-created
  const recipes: PromptRecipe[] = [...BUILT_IN_RECIPES, ...userRecipes]

  const saveRecipe = (r: Omit<PromptRecipe, 'id' | 'builtIn'>) => {
    const id = `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const recipe: PromptRecipe = { ...r, id }
    const next = [...userRecipes, recipe]
    setUserRecipes(next)
    localStorage.setItem('nfcs_prompt_recipes', JSON.stringify(next))
    localStorage.setItem('nfcs_prompt_recipes_version', RECIPES_VERSION)
  }

  const deleteRecipe = (id: string) => {
    if (BUILT_IN_RECIPES.some(r => r.id === id)) return // ignore built-ins
    const next = userRecipes.filter(r => r.id !== id)
    setUserRecipes(next)
    localStorage.setItem('nfcs_prompt_recipes', JSON.stringify(next))
  }

  return { recipes, saveRecipe, deleteRecipe }
}

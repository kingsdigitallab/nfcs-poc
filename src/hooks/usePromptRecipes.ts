import { useState, useEffect } from 'react'
import { FIELD_STARTERS } from '../utils/promptStarters'
import { STORAGE_KEYS } from '../config/storageKeys'

export interface PromptRecipe {
  id:                 string
  name:               string
  nodeFamily:         'standard' | 'field'
  mode?:              'per-record' | 'aggregate'
  systemPrompt:       string
  userPromptTemplate: string
  builtIn?:           true
  /** Recommended model for this recipe (applied only if available in live model list) */
  model?:             string
  /** Recommended temperature for this recipe */
  temperature?:       number
}

// Bump version when built-in recipes change so the stored user-recipe cache is reset
const RECIPES_VERSION = '2026-06-14-v2'

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

  // Field node starters (17 tasks from prompt-template reference)
  ...FIELD_STARTERS,
]

export function usePromptRecipes() {
  const [userRecipes, setUserRecipes] = useState<PromptRecipe[]>([])

  // Load from localStorage on mount
  useEffect(() => {
    const storedVersion = localStorage.getItem(STORAGE_KEYS.PROMPT_RECIPES_VERSION)
    const stored = localStorage.getItem(STORAGE_KEYS.PROMPT_RECIPES)

    if (storedVersion === RECIPES_VERSION && stored) {
      try {
        const parsed = JSON.parse(stored) as PromptRecipe[]
        setUserRecipes(parsed)
      } catch { setUserRecipes([]) }
    } else {
      localStorage.removeItem(STORAGE_KEYS.PROMPT_RECIPES)
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
    localStorage.setItem(STORAGE_KEYS.PROMPT_RECIPES, JSON.stringify(next))
    localStorage.setItem(STORAGE_KEYS.PROMPT_RECIPES_VERSION, RECIPES_VERSION)
  }

  const deleteRecipe = (id: string) => {
    if (BUILT_IN_RECIPES.some(r => r.id === id)) return // ignore built-ins
    const next = userRecipes.filter(r => r.id !== id)
    setUserRecipes(next)
    localStorage.setItem(STORAGE_KEYS.PROMPT_RECIPES, JSON.stringify(next))
  }

  return { recipes, saveRecipe, deleteRecipe }
}

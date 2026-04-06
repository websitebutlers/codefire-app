// ─── Media Model Registry ────────────────────────────────────────────────────
// Only models verified working on OpenRouter as of 2026-04-06.
// UI shows/hides options based on selected model's capabilities.

export type MediaType = 'image'

export interface ModelCapabilities {
  textToImage?: boolean
  imageToImage?: boolean
  styleTransfer?: boolean
  characterReference?: boolean
  maxReferenceImages?: number
  inpainting?: boolean
  seed?: boolean
}

export interface AspectRatioOption {
  value: string
  label: string
}

export interface ResolutionOption {
  value: string
  label: string
}

export interface MediaModel {
  id: string
  name: string
  provider: string
  type: MediaType
  /** Whether model outputs text alongside images (Gemini/GPT) or image-only (FLUX/Seedream) */
  outputModalities: string[]
  capabilities: ModelCapabilities
  aspectRatios: AspectRatioOption[]
  resolutions: ResolutionOption[]
  defaultAspectRatio: string
  defaultResolution: string
  description: string
}

// ─── Shared Options ──────────────────────────────────────────────────────────

const STANDARD_ASPECT_RATIOS: AspectRatioOption[] = [
  { value: '1:1', label: '1:1' },
  { value: '16:9', label: '16:9' },
  { value: '9:16', label: '9:16' },
  { value: '4:3', label: '4:3' },
  { value: '3:2', label: '3:2' },
  { value: '2:3', label: '2:3' },
  { value: '3:4', label: '3:4' },
  { value: '4:5', label: '4:5' },
  { value: '5:4', label: '5:4' },
  { value: '21:9', label: '21:9' },
]

const GEMINI_EXTENDED_RATIOS: AspectRatioOption[] = [
  ...STANDARD_ASPECT_RATIOS,
  { value: '1:4', label: '1:4' },
  { value: '4:1', label: '4:1' },
  { value: '1:8', label: '1:8' },
  { value: '8:1', label: '8:1' },
]

const STANDARD_IMAGE_SIZES: ResolutionOption[] = [
  { value: '1K', label: '1K' },
  { value: '2K', label: '2K' },
  { value: '4K', label: '4K' },
]

const GEMINI_31_SIZES: ResolutionOption[] = [
  { value: '0.5K', label: '0.5K' },
  { value: '1K', label: '1K' },
  { value: '2K', label: '2K' },
  { value: '4K', label: '4K' },
]

// ─── Image Models (verified working 2026-04-06) ─────────────────────────────

export const IMAGE_MODELS: MediaModel[] = [
  // --- Gemini / GPT: output both image + text ---
  {
    id: 'google/gemini-2.5-flash-image',
    name: 'Gemini 2.5 Flash Image',
    provider: 'Google',
    type: 'image',
    outputModalities: ['image', 'text'],
    capabilities: {
      textToImage: true,
      imageToImage: true,
      inpainting: true,
      seed: true,
    },
    aspectRatios: STANDARD_ASPECT_RATIOS,
    resolutions: STANDARD_IMAGE_SIZES,
    defaultAspectRatio: '1:1',
    defaultResolution: '1K',
    description: 'Fast, affordable image generation',
  },
  {
    id: 'google/gemini-3.1-flash-image-preview',
    name: 'Gemini 3.1 Flash Image',
    provider: 'Google',
    type: 'image',
    outputModalities: ['image', 'text'],
    capabilities: {
      textToImage: true,
      imageToImage: true,
      inpainting: true,
      seed: true,
    },
    aspectRatios: GEMINI_EXTENDED_RATIOS,
    resolutions: GEMINI_31_SIZES,
    defaultAspectRatio: '1:1',
    defaultResolution: '1K',
    description: 'Pro-level quality at flash speed, extended aspect ratios',
  },
  {
    id: 'google/gemini-3-pro-image-preview',
    name: 'Gemini 3 Pro Image',
    provider: 'Google',
    type: 'image',
    outputModalities: ['image', 'text'],
    capabilities: {
      textToImage: true,
      imageToImage: true,
      characterReference: true,
      maxReferenceImages: 5,
      inpainting: true,
      seed: true,
    },
    aspectRatios: STANDARD_ASPECT_RATIOS,
    resolutions: STANDARD_IMAGE_SIZES,
    defaultAspectRatio: '1:1',
    defaultResolution: '2K',
    description: 'Best Gemini — multi-subject identity, text rendering',
  },
  {
    id: 'openai/gpt-5-image',
    name: 'GPT-5 Image',
    provider: 'OpenAI',
    type: 'image',
    outputModalities: ['image', 'text'],
    capabilities: {
      textToImage: true,
      imageToImage: true,
      inpainting: true,
    },
    aspectRatios: STANDARD_ASPECT_RATIOS,
    resolutions: STANDARD_IMAGE_SIZES,
    defaultAspectRatio: '1:1',
    defaultResolution: '1K',
    description: 'Full GPT-5 reasoning + image generation',
  },
  {
    id: 'openai/gpt-5-image-mini',
    name: 'GPT-5 Image Mini',
    provider: 'OpenAI',
    type: 'image',
    outputModalities: ['image', 'text'],
    capabilities: {
      textToImage: true,
      imageToImage: true,
      inpainting: true,
    },
    aspectRatios: STANDARD_ASPECT_RATIOS,
    resolutions: STANDARD_IMAGE_SIZES,
    defaultAspectRatio: '1:1',
    defaultResolution: '1K',
    description: 'Cost-optimized GPT-5 image generation',
  },

  // --- FLUX / Seedream: image-only output ---
  {
    id: 'black-forest-labs/flux.2-max',
    name: 'FLUX.2 Max',
    provider: 'Black Forest Labs',
    type: 'image',
    outputModalities: ['image'],
    capabilities: {
      textToImage: true,
      imageToImage: true,
      styleTransfer: true,
      characterReference: true,
      maxReferenceImages: 8,
      seed: true,
    },
    aspectRatios: STANDARD_ASPECT_RATIOS,
    resolutions: STANDARD_IMAGE_SIZES,
    defaultAspectRatio: '1:1',
    defaultResolution: '2K',
    description: 'Top-tier quality, character/style consistency',
  },
  {
    id: 'black-forest-labs/flux.2-pro',
    name: 'FLUX.2 Pro',
    provider: 'Black Forest Labs',
    type: 'image',
    outputModalities: ['image'],
    capabilities: {
      textToImage: true,
      imageToImage: true,
      styleTransfer: true,
      characterReference: true,
      maxReferenceImages: 8,
      seed: true,
    },
    aspectRatios: STANDARD_ASPECT_RATIOS,
    resolutions: STANDARD_IMAGE_SIZES,
    defaultAspectRatio: '1:1',
    defaultResolution: '1K',
    description: 'High-end quality, multi-reference inputs',
  },
  {
    id: 'black-forest-labs/flux.2-flex',
    name: 'FLUX.2 Flex',
    provider: 'Black Forest Labs',
    type: 'image',
    outputModalities: ['image'],
    capabilities: {
      textToImage: true,
      imageToImage: true,
      styleTransfer: true,
      characterReference: true,
      maxReferenceImages: 8,
      seed: true,
    },
    aspectRatios: STANDARD_ASPECT_RATIOS,
    resolutions: STANDARD_IMAGE_SIZES,
    defaultAspectRatio: '1:1',
    defaultResolution: '1K',
    description: 'Complex text/typography, up to 8 reference images',
  },
  {
    id: 'black-forest-labs/flux.2-klein-4b',
    name: 'FLUX.2 Klein 4B',
    provider: 'Black Forest Labs',
    type: 'image',
    outputModalities: ['image'],
    capabilities: {
      textToImage: true,
      seed: true,
    },
    aspectRatios: STANDARD_ASPECT_RATIOS,
    resolutions: STANDARD_IMAGE_SIZES,
    defaultAspectRatio: '1:1',
    defaultResolution: '1K',
    description: 'Fastest/cheapest FLUX model',
  },
  {
    id: 'bytedance-seed/seedream-4.5',
    name: 'Seedream 4.5',
    provider: 'ByteDance',
    type: 'image',
    outputModalities: ['image'],
    capabilities: {
      textToImage: true,
      imageToImage: true,
      characterReference: true,
      maxReferenceImages: 4,
      inpainting: true,
    },
    aspectRatios: STANDARD_ASPECT_RATIOS,
    resolutions: STANDARD_IMAGE_SIZES,
    defaultAspectRatio: '1:1',
    defaultResolution: '1K',
    description: 'Portrait refinement, multi-image composition',
  },
]

// ─── Helpers ─────────────────────────────────────────────────────────────────

export const ALL_MODELS: MediaModel[] = IMAGE_MODELS

export const DEFAULT_MODEL = IMAGE_MODELS[0]

export function getModelById(id: string): MediaModel | undefined {
  return ALL_MODELS.find((m) => m.id === id)
}

export function modelSupports(model: MediaModel, capability: keyof ModelCapabilities): boolean {
  return !!model.capabilities[capability]
}

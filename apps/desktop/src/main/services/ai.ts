import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type {
  AiChatInput,
  AiChatResult,
  AiConversationInfo,
  AiMessage,
  AiProviderInfo,
  AiProviderInput,
  AiProviderKind,
} from '@shared/ai'
import { paths } from '../lib/paths'

interface StoredProvider extends AiProviderInfo {
  apiKey: string
}

interface Store {
  providers: StoredProvider[]
  conversations: AiConversationInfo[]
}

function file(): string {
  return join(paths.root(), 'ai', 'agent.json')
}

function load(): Store {
  try {
    const raw = JSON.parse(readFileSync(file(), 'utf8')) as Partial<Store>
    return {
      providers: Array.isArray(raw.providers) ? raw.providers : [],
      conversations: Array.isArray(raw.conversations) ? raw.conversations : [],
    }
  } catch {
    return { providers: [], conversations: [] }
  }
}

function save(store: Store): void {
  mkdirSync(join(paths.root(), 'ai'), { recursive: true })
  writeFileSync(file(), JSON.stringify(store, null, 2), 'utf8')
}

export function getProviderSecret(id: string): { kind: string; baseUrl: string; model: string; apiKey: string } | null {
  const provider = load().providers.find((item) => item.id === id)
  return provider ? { kind: provider.kind, baseUrl: provider.baseUrl, model: provider.model, apiKey: provider.apiKey } : null
}

function publicProvider(provider: StoredProvider): AiProviderInfo {
  const { apiKey: _apiKey, ...rest } = provider
  return { ...rest, hasKey: Boolean(provider.apiKey) }
}

export function listProviders(): AiProviderInfo[] {
  return load().providers.map(publicProvider)
}

export function saveProvider(input: AiProviderInput): AiProviderInfo {
  const store = load()
  const id = input.id || `provider-${randomUUID().slice(0, 8)}`
  const existing = store.providers.find((item) => item.id === id)
  const provider: StoredProvider = {
    id,
    name: input.name.trim() || 'Custom',
    kind: input.kind,
    baseUrl: input.baseUrl.replace(/\/$/, ''),
    model: input.model.trim(),
    temperature: input.temperature ?? 0.7,
    hasKey: Boolean(input.apiKey || existing?.apiKey),
    apiKey: input.apiKey?.trim() || existing?.apiKey || '',
  }
  store.providers = [provider, ...store.providers.filter((item) => item.id !== id)]
  save(store)
  return publicProvider(provider)
}

export function removeProvider(id: string): void {
  const store = load()
  store.providers = store.providers.filter((item) => item.id !== id)
  save(store)
}

export function listConversations(): AiConversationInfo[] {
  return load().conversations.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export function removeConversation(id: string): void {
  const store = load()
  store.conversations = store.conversations.filter((item) => item.id !== id)
  save(store)
}

const SYSTEM_PROMPT = `You are the MossStudio prompt agent for MOSS-Image, an image generation model with strong text rendering and layout control.
Help the user turn ideas into precise English prompts, segmented into: subject, style, light, composition, text, negative.
Keep replies concise. When suggesting prompt changes, return the final prompt text. Prefer concrete visual language and do not invent unsupported UI actions.
If the user writes Chinese, answer in Chinese but keep the prompt itself in English.`

async function request(provider: StoredProvider, messages: Array<{ role: string; content: string }>, system: string): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 120_000)
  try {
    if (provider.kind === 'ollama') {
      const response = await fetch(`${provider.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: provider.model, stream: false, options: { temperature: provider.temperature }, messages: [{ role: 'system', content: system }, ...messages] }),
        signal: controller.signal,
      })
      const body = (await response.json()) as { message?: { content?: string }; error?: string }
      if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`)
      return body.message?.content?.trim() ?? ''
    }
    if (provider.kind === 'anthropic') {
      const response = await fetch(`${provider.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': provider.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({ model: provider.model, max_tokens: 4096, temperature: provider.temperature, system, messages }),
        signal: controller.signal,
      })
      const body = (await response.json()) as { content?: Array<{ text?: string }>; error?: { message?: string } }
      if (!response.ok) throw new Error(body.error?.message ?? `HTTP ${response.status}`)
      return body.content?.map((item) => item.text ?? '').join('').trim() ?? ''
    }
    if (provider.kind === 'gemini') {
      const url = `${provider.baseUrl}/models/${encodeURIComponent(provider.model)}:generateContent?key=${encodeURIComponent(provider.apiKey)}`
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: messages.map((message) => ({ role: message.role === 'assistant' ? 'model' : 'user', parts: [{ text: message.content }] })),
          generationConfig: { temperature: provider.temperature, maxOutputTokens: 4096 },
        }),
        signal: controller.signal,
      })
      const body = (await response.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>; error?: { message?: string } }
      if (!response.ok) throw new Error(body.error?.message ?? `HTTP ${response.status}`)
      return body.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('').trim() ?? ''
    }
    const response = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(provider.apiKey ? { authorization: `Bearer ${provider.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: provider.model,
        temperature: provider.temperature,
        messages: [{ role: 'system', content: system }, ...messages],
      }),
      signal: controller.signal,
    })
    const body = (await response.json()) as { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } }
    if (!response.ok) throw new Error(body.error?.message ?? `HTTP ${response.status}`)
    return body.choices?.[0]?.message?.content?.trim() ?? ''
  } finally {
    clearTimeout(timer)
  }
}

export async function chat(input: AiChatInput): Promise<AiChatResult> {
  const store = load()
  const provider = store.providers.find((item) => item.id === input.providerId)
  if (!provider) throw new Error('请先添加 AI Provider')
  const now = new Date().toISOString()
  const conversation: AiConversationInfo =
    store.conversations.find((item) => item.id === input.conversationId) ?? {
      id: `chat-${randomUUID().slice(0, 8)}`,
      title: input.messages.find((message) => message.role === 'user')?.content.slice(0, 48) ?? '新对话',
      providerId: provider.id,
      messages: [],
      createdAt: now,
      updatedAt: now,
    }
  const reply = await request(provider, input.messages, input.system || SYSTEM_PROMPT)
  const withMessages = [
    ...conversation.messages,
    ...input.messages.filter((message) => message.role !== 'system').map((message) => ({
      id: `msg-${randomUUID().slice(0, 8)}`,
      role: message.role as AiMessage['role'],
      content: message.content,
      createdAt: now,
    })),
    { id: `msg-${randomUUID().slice(0, 8)}`, role: 'assistant' as const, content: reply, createdAt: now },
  ]
  const next = { ...conversation, providerId: provider.id, messages: withMessages, updatedAt: new Date().toISOString() }
  store.conversations = [next, ...store.conversations.filter((item) => item.id !== next.id)]
  save(store)
  return { reply, conversation: next }
}

export const AI_PROVIDER_KINDS: AiProviderKind[] = ['openai', 'anthropic', 'gemini', 'ollama']

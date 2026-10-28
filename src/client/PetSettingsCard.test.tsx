// @vitest-environment jsdom
/**
 * The pet settings card under the aggregate shell, which serves no Host
 * settings form for the 'pet' namespace: the pet choice and its visibility
 * switch both write through the pet API, so the pet can still be turned off
 * when the Host form is absent.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import { BUBBLE_SCALE_RANGE, INSET_RANGE, PetSettingsCard, PetSettingsCardController, SIZE_RANGE, type PetSettings } from './PetSettingsCard.tsx'
import { BUBBLE_SCALE_MAX, BUBBLE_SCALE_MIN, DISPLAY_INSET_MAX, DISPLAY_SIZE_MAX, DISPLAY_SIZE_MIN } from '../persist.ts'
import { t } from './locales.ts'

vi.mock('@deepseek-ai/dsh-client-store', () => ({ // test-standards-allow: the SDK client bundle is a browser module factory and cannot be imported by Vitest
  createSnapshotStore: (initial: unknown) => {
    let value = initial
    const listeners = new Set<() => void>()
    return {
      getSnapshot: () => value,
      set: (next: unknown) => { value = next; for (const listener of listeners) listener() },
      subscribe: (listener: () => void) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
    }
  },
}))

function unavailableForm() {
  const mutate = vi.fn(async () => false)
  const scope = {
    getSnapshot: () => ({ status: 'unavailable', writable: true, value: undefined, base: undefined, user: undefined }),
    subscribe: () => () => {},
    mutate,
  } as unknown as ConfigForm<PetSettings>
  return { scope, mutate }
}

function response(value: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 500, json: async () => value } as Response
}

/**
 * A Host-served pet namespace: the settings document, its user layer, and a
 * mutate that applies the card's batch and publishes the settled view back,
 * which is what the card's read-back judgment reads.
 */
function readyForm(value: PetSettings) {
  let section: PetSettings = { ...value }
  // The Host document's user layer is keyed by field name, so the test seam
  // writes through a record view of the same shape the form contract serves.
  let user: Record<string, unknown> = {}
  const listeners = new Set<() => void>()
  const publish = () => { for (const listener of listeners) listener() }
  const mutate = vi.fn(async (ops: ReadonlyArray<{ op: 'set' | 'unset'; path: string[]; value?: unknown }>) => {
    for (const op of ops) {
      const field = op.path[0] as string
      if (op.op === 'set') user[field] = op.value
      else delete user[field]
    }
    section = { ...value, ...user }
    publish()
    return true
  })
  const scope = {
    getSnapshot: () => ({ status: 'ready', writable: true, value: section, base: value, user, revision: 1 }),
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    mutate,
  } as unknown as ConfigForm<PetSettings>
  return { scope, mutate, value: () => ({ user }) }
}

beforeAll(() => {
  document.documentElement.lang = 'zh'
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('pet selection without a Host settings form', () => {
  it('user saves the selected pet through its persisted API and confirms the read-back', async () => {
    // Given the aggregate shell exposes no pet configuration form
    vi.useFakeTimers()
    const { scope, mutate } = unavailableForm()
    let selected = 'whale-girl'
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input)
      if (path === '/api/pet/pets') return response([{ id: 'whale-girl', displayName: '鲸鱼娘' }, { id: 'jyn', displayName: '女仆鲸鱼娘' }])
      if (path === '/api/pet/state') return response({ pet: { id: selected } })
      if (path === '/api/pet/set-pet') {
        selected = JSON.parse(String(init?.body)).petId as string
        return response({ ok: true, petId: selected })
      }
      throw new Error('unexpected request: ' + path)
    })
    vi.stubGlobal('fetch', fetch)
    const controller = new PetSettingsCardController(scope)
    await vi.advanceTimersByTimeAsync(0)
    const face = controller.inject()
    const state = () => face.hooks.petSettingsCard.getSnapshot()

    // When the user chooses the maid whale
    expect(state()).toMatchObject({ petSelectionFallback: true, petId: { text: 'whale-girl' }, dirty: false })
    face.edit('petId', '')
    expect(state()).toMatchObject({ dirty: false, petId: { text: 'whale-girl' } })
    face.edit('petId', 'jyn')
    expect(state()).toMatchObject({ petId: { text: 'jyn' } })
    await vi.waitFor(() => { expect(state().saving).toBe(false) })

    // Then the pet service holds it, the draft clears, and the absent Host form is untouched
    expect(selected).toBe('jyn')
    expect(state()).toMatchObject({ dirty: false, failed: false, petId: { text: 'jyn' } })
    expect(mutate).not.toHaveBeenCalled()
    expect(fetch).toHaveBeenCalledWith('/api/pet/set-pet', expect.objectContaining({ body: JSON.stringify({ petId: 'jyn' }) }))
    controller.dispose()
  })

  it('user sees the selection go back when the pet API refuses it', async () => {
    // Given the Host has no pet form and the pet API still serves its selection
    vi.useFakeTimers()
    const { scope } = unavailableForm()
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input)
      if (path === '/api/pet/pets') return response([{ id: 'whale-girl', displayName: '鲸鱼娘' }, { id: 'jyn', displayName: '女仆鲸鱼娘' }])
      if (path === '/api/pet/state') return response({ pet: { id: 'whale-girl' } })
      if (path === '/api/pet/set-pet') return response({ ok: false, error: 'unknown-pet' })
      throw new Error('unexpected request: ' + path)
    }))
    const controller = new PetSettingsCardController(scope)
    await vi.advanceTimersByTimeAsync(0)
    const face = controller.inject()
    // When the user picks a pet the pet API refuses
    face.edit('petId', 'jyn')
    await vi.waitFor(() => { expect(face.hooks.petSettingsCard.getSnapshot().saving).toBe(false) })
    // Then the choice is back on the persisted pet and the failure is visible
    expect(face.hooks.petSettingsCard.getSnapshot()).toMatchObject({ dirty: false, failed: true, petId: { text: 'whale-girl' } })
    controller.dispose()
  })
})

describe('pet visibility without a Host settings form', () => {
  it('user turns the pet off through its persisted API and confirms the read-back', async () => {
    // Given the aggregate shell exposes no pet configuration form and the pet is showing
    vi.useFakeTimers()
    const { scope, mutate } = unavailableForm()
    let visible = true
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input)
      if (path === '/api/pet/pets') return response([{ id: 'whale-girl', displayName: '鲸鱼娘' }])
      if (path === '/api/pet/state') return response({ pet: { id: 'whale-girl' }, display: { visible } })
      if (path === '/api/pet/set-visible') {
        visible = JSON.parse(String(init?.body)).visible as boolean
        return response({ ok: true, display: { visible } })
      }
      throw new Error('unexpected request: ' + path)
    })
    vi.stubGlobal('fetch', fetch)
    const controller = new PetSettingsCardController(scope)
    await vi.advanceTimersByTimeAsync(0)
    const face = controller.inject()
    const state = () => face.hooks.petSettingsCard.getSnapshot()

    // When the user switches the pet off
    expect(state()).toMatchObject({ petSelectionFallback: true, visible: { text: 'true' }, dirty: false })
    face.edit('visible', 'false')
    expect(state()).toMatchObject({ visible: { text: 'false' } })
    await vi.waitFor(() => { expect(state().saving).toBe(false) })

    // Then the pet service holds it, the draft clears, and the absent Host form is untouched
    expect(visible).toBe(false)
    expect(state()).toMatchObject({ dirty: false, failed: false, visible: { text: 'false' } })
    expect(mutate).not.toHaveBeenCalled()
    expect(fetch).toHaveBeenCalledWith('/api/pet/set-visible', expect.objectContaining({ body: JSON.stringify({ visible: false }) }))
    controller.dispose()
  })

  it('user sees the switch go back when the pet API refuses the visibility write', async () => {
    // Given the Host has no pet form and the pet API refuses visibility writes
    vi.useFakeTimers()
    const { scope } = unavailableForm()
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input)
      if (path === '/api/pet/pets') return response([{ id: 'whale-girl', displayName: '鲸鱼娘' }])
      if (path === '/api/pet/state') return response({ pet: { id: 'whale-girl' }, display: { visible: true } })
      if (path === '/api/pet/set-visible') return response({ ok: false }, false)
      throw new Error('unexpected request: ' + path)
    }))
    const controller = new PetSettingsCardController(scope)
    await vi.advanceTimersByTimeAsync(0)
    const face = controller.inject()
    // When the user flips a visibility the pet API refuses
    face.edit('visible', 'false')
    await vi.waitFor(() => { expect(face.hooks.petSettingsCard.getSnapshot().saving).toBe(false) })
    // Then the switch is back on the persisted visibility and the failure is visible
    expect(face.hooks.petSettingsCard.getSnapshot()).toMatchObject({ dirty: false, failed: true, visible: { text: 'true' } })
    controller.dispose()
  })
})

describe('pet settings card rendered without a Host settings form', () => {
  it('shows the visibility switch beside the pet choice and hides the Host-only fields', async () => {
    // Given the aggregate shell exposes no pet configuration form
    vi.useFakeTimers()
    const { scope } = unavailableForm()
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input)
      if (path === '/api/pet/pets') return response([{ id: 'whale-girl', displayName: '鲸鱼娘' }])
      if (path === '/api/pet/state') return response({ pet: { id: 'whale-girl' }, display: { visible: true } })
      throw new Error('unexpected request: ' + path)
    }))
    const controller = new PetSettingsCardController(scope)
    await vi.advanceTimersByTimeAsync(0)
    const face = controller.inject()
    const store = face.hooks.petSettingsCard

    // When the card renders
    render(
      <PetSettingsCard
        t={t}
        usePetSettingsCard={select => useSyncExternalStore(store.subscribe, () => select(store.getSnapshot()))}
        save={face.save}
        discard={face.discard}
        edit={face.edit}
        resetField={face.resetField}
        refreshPets={face.refreshPets}
      />,
    )

    // Then the pet choice and the switch that turns the pet off are both on screen
    expect(screen.getByLabelText(t('settings.pet'))).toBeTruthy()
    expect(screen.getByLabelText(t('settings.visible'))).toBeTruthy()
    // ...while the fields only the absent Host form owns stay hidden
    expect(screen.queryByRole('switch')).toBeNull()
    expect(screen.queryByLabelText(t('settings.size'))).toBeNull()
    controller.dispose()
  })
})

describe('the status bubble switch on the Host settings form', () => {
  it('user switches the pet own bubbles off and the form writes the mode', async () => {
    // Given a Host that serves the pet namespace with the shipped default
    vi.useFakeTimers()
    const { scope, value, mutate } = readyForm({ statusBubbles: 'auto' })
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input)
      if (path === '/api/pet/pets') return response([{ id: 'whale-girl', displayName: '鲸鱼娘' }])
      if (path === '/api/pet/state') return response({ pet: { id: 'whale-girl' }, display: { visible: true } })
      throw new Error('unexpected request: ' + path)
    }))
    const controller = new PetSettingsCardController(scope)
    await vi.advanceTimersByTimeAsync(0)
    const face = controller.inject()
    const state = () => face.hooks.petSettingsCard.getSnapshot()

    // When the card renders, the switch is on screen beside the other fields
    render(
      <PetSettingsCard
        t={t}
        usePetSettingsCard={select => useSyncExternalStore(face.hooks.petSettingsCard.subscribe, () => select(face.hooks.petSettingsCard.getSnapshot()))}
        save={face.save}
        discard={face.discard}
        edit={face.edit}
        resetField={face.resetField}
        refreshPets={face.refreshPets}
      />,
    )
    expect(screen.getByLabelText(t('settings.statusBubbles'))).toBeTruthy()
    expect(state()).toMatchObject({ statusBubbles: { text: 'auto', invalid: false } })

    // When the user picks Off
    face.edit('statusBubbles', 'off')
    expect(state()).toMatchObject({ statusBubbles: { text: 'off' } })
    await vi.waitFor(() => { expect(state().saving).toBe(false) })

    // Then the settings document holds the mode with no further step, and the draft clears
    expect(mutate).toHaveBeenCalledWith([{ op: 'set', path: ['statusBubbles'], value: 'off' }])
    expect(value().user?.statusBubbles).toBe('off')
    expect(state()).toMatchObject({ dirty: false, failed: false, statusBubbles: { text: 'off' } })
    controller.dispose()
  })

  it('refuses a draft the switch does not accept instead of writing it', () => {
    const { scope } = readyForm({ statusBubbles: 'auto' })
    const face = new PetSettingsCardController(scope).inject()

    face.edit('statusBubbles', 'maybe')

    // The save stays blocked: a mode the host schema has no union member for
    // must never reach the settings document.
    expect(face.hooks.petSettingsCard.getSnapshot()).toMatchObject({
      invalid: true,
      statusBubbles: { text: 'maybe', invalid: true },
    })
  })
})

describe('the coarse sliders on the display fields', () => {
  it('cover the bounds the host schema accepts for size and bubble scale', () => {
    // The card spells the spans as literals because the browser half never
    // imports the host module; this keeps the two from drifting apart.
    expect(SIZE_RANGE).toMatchObject({ min: DISPLAY_SIZE_MIN, max: DISPLAY_SIZE_MAX })
    expect(BUBBLE_SCALE_RANGE).toMatchObject({ min: BUBBLE_SCALE_MIN, max: BUBBLE_SCALE_MAX })
    expect(INSET_RANGE.max).toBeLessThanOrEqual(DISPLAY_INSET_MAX)
  })
})

describe('the pet registry while the plugin is off', () => {
  it('re-reads the list when the master switch is turned on, without a page reload', async () => {
    // Given the plugin is off, so the pet API never served the registry
    vi.useFakeTimers()
    const { scope } = readyForm({ enabled: false })
    let apiServing = false
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input)
      if (path === '/api/pet/pets') {
        // The host registers '/api/pet/*' only while the plugin is enabled.
        if (!apiServing) return response({ error: 'not registered' }, false)
        return response([{ id: 'whale-girl', displayName: '鲸鱼娘' }])
      }
      if (path === '/api/pet/state') return response({ pet: { id: 'whale-girl' }, display: { visible: false } })
      throw new Error('unexpected request: ' + path)
    })
    vi.stubGlobal('fetch', fetch)
    const controller = new PetSettingsCardController(scope)
    await vi.advanceTimersByTimeAsync(0)
    const face = controller.inject()
    const state = () => face.hooks.petSettingsCard.getSnapshot()

    // When the card renders with the plugin off, there is nothing to pick
    render(
      <PetSettingsCard
        t={t}
        usePetSettingsCard={select => useSyncExternalStore(face.hooks.petSettingsCard.subscribe, () => select(face.hooks.petSettingsCard.getSnapshot()))}
        save={face.save}
        discard={face.discard}
        edit={face.edit}
        resetField={face.resetField}
        refreshPets={face.refreshPets}
      />,
    )
    await vi.advanceTimersByTimeAsync(10_000)
    expect(state().petPreviews).toHaveLength(0)

    // When the plugin is turned on, the API exists and the card asks it again
    apiServing = true
    face.edit('enabled', 'true')

    // Then the picker fills without the reader touching the page
    await vi.waitFor(() => { expect(state().petPreviews).toHaveLength(1) })
    expect(state().petId.text).toBe('whale-girl')
    controller.dispose()
  })
})

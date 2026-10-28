/**
 * The pet settings card: pet selection plus display layout, staged over the
 * 'pet' profile entry's own configuration (a plugin's settings ARE its Cordis
 * Config since 0.1.7, so the Host serves one form per profile entry).
 * Rendered as an always-open first-level settings page; the section wrapper
 * below mounts it as the content of the top-level 'settings.section' nav
 * entry. The petId choices come from the registry endpoint ('/api/pet/pets') —
 * the same list the sprite renders from — so the card carries no per-pet
 * knowledge.
 */

import { useEffect, type ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
// Type-only: pulls the settings-surface SlotMap merge (the 'settings.section' entry).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from './web-extension-contract.ts'
import { PluginSettingsCard, ValueField, BooleanField, ChoiceField, ToggleSwitch } from './PluginSettingsCard.tsx'
import { PetPreview, type PetPreviewDefinition } from './PetPreview.tsx'
import { CardForm, booleanField, choiceField, numberField, type CardActions, type CardShell, type FieldState as CardFieldState } from './settings-form.ts'
import sectionCss from './settings-section.module.css'

/** The pet's settings fields this card edits (the namespace's full schema). */
export interface PetSettings {
  /** Master switch for the plugin. */
  enabled?: boolean
  /** Master switch. */
  visible?: boolean
  /** Scale of the rendered pet in px (sprite cell height). */
  size?: number
  /** Horizontal inset from the viewport right edge, px. */
  right?: number
  /** Vertical inset from the viewport bottom edge, px. */
  bottom?: number
  /** Bubble typography multiplier on the automatic size following (#1549). */
  bubbleScale?: number
  /** Selected pet id (a registry entry). */
  petId?: string
  /** Status-decoration master switch (pet-center M5, #567). */
  decorationEnabled?: boolean
  /** Whether the pet's own session/status bubbles render (issue #6). */
  statusBubbles?: string
}

/** What the pet settings card renders. */
export interface PetSettingsCardState extends CardShell {
  /** The aggregate shell has no Host settings form; pet selection uses its own persisted API. */
  petSelectionFallback: boolean
  /** Plugin master switch. */
  enabled: CardFieldState
  /** Master switch. */
  visible: CardFieldState
  /** Pet scale. */
  size: CardFieldState
  /** Right inset. */
  right: CardFieldState
  /** Bottom inset. */
  bottom: CardFieldState
  /** Bubble typography multiplier. */
  bubbleScale: CardFieldState
  /** Selected pet. */
  petId: CardFieldState
  /** Status-decoration master switch. */
  decorationEnabled: CardFieldState
  /** Whether the pet's own session/status bubbles render. */
  statusBubbles: CardFieldState
  /** Pet choices (registry ids + display names), loaded from the host. */
  petChoices: readonly { value: string; label: string }[]
  /** The same registry entries with the visual data their thumbnails need. */
  petPreviews: readonly PetPreviewDefinition[]
}

/** The registration-side face the card's slot entry injects. */
export interface PetSettingsCardFace extends CardActions {
  hooks: {
    /** Card snapshot bound by the renderer as usePetSettingsCard. */
    petSettingsCard: SnapshotStore<PetSettingsCardState>
  }
  /**
   * Ask the card for the pet registry again. The pet API only exists while the
   * plugin is enabled, so opening the master switch has to be able to re-ask
   * instead of leaving the picker empty until the page reloads.
   */
  refreshPets(): void
}

/**
 * The bubble modes this card can write, in render order. Mirrors the host
 * schema's union (see PetStatusBubbleMode); the browser half never imports the
 * host module for a value, so the accepted set is spelled here as literals.
 */
const STATUS_BUBBLE_CHOICES = ['auto', 'off'] as const

/**
 * The spans the coarse sliders cover, spelled as literals for the same reason.
 * Size and bubble scale are the schema's own bounds (src/persist.ts); the
 * insets reach the schema's far end only by typing, so their slider covers the
 * distances a window can show.
 */
export const SIZE_RANGE = { min: 32, max: 1024, step: 1 }
export const INSET_RANGE = { min: 0, max: 1000, step: 1 }
export const BUBBLE_SCALE_RANGE = { min: 0.5, max: 2, step: 0.05 }

/** One registry choice as served by '/api/pet/pets'. */
type PetChoice = PetPreviewDefinition

/** Fetch the registry list (the same data the sprite renders from). */
async function fetchPetChoices(): Promise<PetChoice[]> {
  // Never from cache: the list is exactly what changes when the plugin is
  // switched on (the API only exists then) or a pet is installed.
  const response = await fetch('/api/pet/pets', { cache: 'no-store' })
  if (!response.ok) throw new Error('pet pets failed: ' + response.status)
  return (await response.json()) as PetChoice[]
}

/** The persisted state the fallback mirrors: the selection and its visibility. */
interface PetState {
  /** Selected registry id. */
  petId: string
  /** Whether the pet is currently rendered. */
  visible: boolean
}

/** Read the selection and visibility from the same persisted state the pet renders. */
async function fetchPetState(): Promise<PetState> {
  const response = await fetch('/api/pet/state')
  if (!response.ok) throw new Error('pet state failed: ' + response.status)
  const body = (await response.json()) as { pet?: { id?: unknown }; display?: { visible?: unknown } }
  if (typeof body.pet?.id !== 'string') throw new Error('pet state has no selected pet')
  // A Host without the display block predates the visibility switch; the pet shows.
  return { petId: body.pet.id, visible: body.display?.visible !== false }
}

/** Bridges the 'pet' scope onto the card's staged form. */
export class PetSettingsCardController {
  private readonly form: CardForm<PetSettings>
  private readonly store: SnapshotStore<PetSettingsCardState>
  // The choice list rides a mutable array shared with the choiceField spec,
  // so loading the registry re-validates and re-formats the petId field
  // without rebuilding the form.
  private readonly petChoices: string[] = []
  private readonly petLabels = new Map<string, string>()
  private petPreviews: PetPreviewDefinition[] = []
  private selectedPetId: string | undefined
  private selectedVisible: boolean | undefined
  private stagedPetId: string | undefined
  private stagedVisible: boolean | undefined
  private savingPet = false
  /** A fallback pick made while a write was in flight. */
  private fallbackQueued = false
  private petSaveFailed = false
  private loaded = false
  /** A registry request is in flight. */
  private loading = false
  private attempts = 0
  private disposed = false
  /** Pending deferred-load or retry timer; cancelled by dispose(). */
  private pendingTimer: number | undefined

  /** @param scope - the bound configuration form for the 'pet' entry. */
  constructor(scope: ConfigForm<PetSettings>) {
    this.form = new CardForm(scope, [
      booleanField('enabled'),
      booleanField('decorationEnabled'),
      // The bubble switch is a two-value mode, not a boolean: 'off' is the
      // opt-out, and a future mode (say, one that keeps only the current
      // session's bubble) has to be able to join the same field without
      // breaking every settings document already written.
      choiceField('statusBubbles', STATUS_BUBBLE_CHOICES),
      booleanField('visible'),
      numberField('size'),
      numberField('right'),
      numberField('bottom'),
      numberField('bubbleScale'),
      choiceField('petId', this.petChoices),
    ])
    this.store = this.form.bind(() => this.projection())
    // Client plugins are applied synchronously during shell startup. Defer
    // the first registry request until that pass completes so transport
    // plugins (notably remote-web-ui on a paired non-loopback origin) can
    // install their fetch channel before /api/pet/pets is issued.
    this.pendingTimer = window.setTimeout(() => {
      this.pendingTimer = undefined
      if (this.disposed) return
      void this.loadPets()
      void this.loadPetState()
    }, 0)
  }

  /** Resolve the registry choices once (retried a few times on failure). */
  private async loadPets(): Promise<void> {
    if (this.loaded || this.disposed || this.loading) return
    this.loading = true
    try {
      const list = await fetchPetChoices()
      if (this.disposed) return
      this.petChoices.splice(0, this.petChoices.length, ...list.map(choice => choice.id))
      this.petPreviews = list
      for (const choice of list) this.petLabels.set(choice.id, choice.displayName)
      this.loaded = true
      this.store.set(this.projection())
    } catch {
      if (this.disposed) return
      this.attempts += 1
      if (this.attempts < 3) {
        this.pendingTimer = window.setTimeout(() => {
          this.pendingTimer = undefined
          if (this.disposed) return
          void this.loadPets()
        }, 3000)
      }
    } finally {
      this.loading = false
    }
  }

  /**
   * Re-read the registry on demand. The pet API is registered only while the
   * plugin is enabled, so the first read can fail while the master switch is
   * off; this lets the card try again the moment the switch opens instead of
   * waiting for a page reload.
   */
  refreshPets(): void {
    if (this.disposed || this.loading) return
    this.loaded = false
    this.attempts = 0
    void this.loadPets()
  }

  private async loadPetState(): Promise<void> {
    try {
      const state = await fetchPetState()
      if (this.disposed) return
      this.selectedPetId = state.petId
      this.selectedVisible = state.visible
      this.store.set(this.projection())
    } catch {
      // The Host form remains the authority when it is available. An absent
      // pet API leaves the fallback unavailable rather than inventing state.
    }
  }

  private fallback(): boolean {
    const shell = this.form.shell()
    return shell.available && !shell.exposed && this.selectedPetId !== undefined
  }

  /**
   * The visibility the fallback switch renders: the staged draft when the user
   * moved it, the persisted value otherwise. There is no user layer to override
   * here, so the field is never marked overridden.
   */
  private fallbackVisible(): CardFieldState {
    const value = this.stagedVisible ?? this.selectedVisible
    return { text: value === undefined ? '' : String(value), overridden: false, invalid: false }
  }

  /**
   * Persist the staged selection and visibility through the pet API — the only
   * writer available when the aggregate shell serves this card, since there is
   * no Host settings form to mutate — then confirm the read-back before the
   * drafts are cleared. A refused write puts both picks back to what the pet
   * persisted. A pick made while a write is in flight runs once it settles.
   */
  private async saveFallback(): Promise<void> {
    const petId = this.stagedPetId
    const visible = this.stagedVisible
    if (this.savingPet) {
      this.fallbackQueued = true
      return
    }
    if (petId === undefined && visible === undefined) return
    if (petId !== undefined && !this.petChoices.includes(petId)) return
    this.savingPet = true
    this.petSaveFailed = false
    this.store.set(this.projection())
    try {
      if (petId !== undefined) {
        const response = await fetch('/api/pet/set-pet', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ petId }),
        })
        const result = (await response.json()) as { ok?: boolean; petId?: string }
        if (!response.ok || result.ok !== true || result.petId !== petId) {
          throw new Error('pet selection was not persisted')
        }
      }
      if (visible !== undefined) {
        const response = await fetch('/api/pet/set-visible', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ visible }),
        })
        if (!response.ok) throw new Error('pet visibility was not persisted')
      }
      const persisted = await fetchPetState()
      if (petId !== undefined && persisted.petId !== petId) throw new Error('pet selection was not persisted')
      if (visible !== undefined && persisted.visible !== visible) throw new Error('pet visibility was not persisted')
      this.selectedPetId = persisted.petId
      this.selectedVisible = persisted.visible
      if (this.stagedPetId === petId) this.stagedPetId = undefined
      if (this.stagedVisible === visible) this.stagedVisible = undefined
    } catch {
      this.petSaveFailed = true
      if (this.stagedPetId === petId) this.stagedPetId = undefined
      if (this.stagedVisible === visible) this.stagedVisible = undefined
    } finally {
      this.savingPet = false
      if (!this.disposed) this.store.set(this.projection())
    }
    if (this.fallbackQueued && !this.disposed) {
      this.fallbackQueued = false
      await this.saveFallback()
    }
  }

  private projection(): PetSettingsCardState {
    const fallback = this.fallback()
    const shell = this.form.shell()
    const configuredPet = this.form.field('petId')
    return {
      ...shell,
      ...(fallback ? {
        exposed: true,
        writable: true,
        dirty: this.stagedPetId !== undefined && this.stagedPetId !== this.selectedPetId
          || this.stagedVisible !== undefined && this.stagedVisible !== this.selectedVisible,
        invalid: this.stagedPetId !== undefined && !this.petChoices.includes(this.stagedPetId),
        saving: this.savingPet,
        failed: this.petSaveFailed,
        failedReason: undefined,
      } : {}),
      petSelectionFallback: fallback,
      enabled: this.form.field('enabled'),
      decorationEnabled: this.form.field('decorationEnabled'),
      statusBubbles: this.form.field('statusBubbles'),
      visible: fallback ? this.fallbackVisible() : this.form.field('visible'),
      size: this.form.field('size'),
      right: this.form.field('right'),
      bottom: this.form.field('bottom'),
      bubbleScale: this.form.field('bubbleScale'),
      petId: fallback
        ? { text: this.stagedPetId ?? this.selectedPetId ?? '', overridden: false, invalid: this.stagedPetId !== undefined && !this.petChoices.includes(this.stagedPetId) }
        : configuredPet.text === '' && this.selectedPetId !== undefined
          ? { ...configuredPet, text: this.selectedPetId }
          : configuredPet,
      petChoices: this.petChoices.map(id => ({ value: id, label: this.petLabels.get(id) ?? id })),
      petPreviews: this.petPreviews,
    }
  }

  /**
   * Build the face the card's slot registration injects.
   * @returns the card's snapshot and its form actions.
   */
  inject(): PetSettingsCardFace {
    const actions = this.form.actions()
    return {
      hooks: { petSettingsCard: this.store },
      // The fallback's two fields are both picks, so each is written through
      // the pet API the moment it is made, as the form writes its own picks.
      edit: (field, value) => {
        if (!this.fallback()) return actions.edit(field, value)
        if (field === 'petId') this.stagedPetId = value === '' ? undefined : value
        else if (field === 'visible') this.stagedVisible = value === '' ? undefined : value === 'true'
        else return
        this.petSaveFailed = false
        this.store.set(this.projection())
        void this.saveFallback()
      },
      resetField: (field) => {
        if (!this.fallback()) return actions.resetField(field)
        if (field === 'petId') this.stagedPetId = undefined
        else if (field === 'visible') this.stagedVisible = undefined
        else return
        this.petSaveFailed = false
        this.store.set(this.projection())
      },
      save: () => { if (this.fallback()) void this.saveFallback(); else actions.save() },
      discard: () => {
        if (!this.fallback()) return actions.discard()
        this.stagedPetId = undefined
        this.stagedVisible = undefined
        this.petSaveFailed = false
        this.store.set(this.projection())
      },
      refreshPets: () => { this.refreshPets() },
    }
  }

  /**
   * Release the card's scope subscription, bound stores and pending load
   * timers; the slot disposer calls this on teardown.
   */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (this.pendingTimer !== undefined) {
      window.clearTimeout(this.pendingTimer)
      this.pendingTimer = undefined
    }
    this.form.dispose()
  }
}

/** Props the renderer binds for the pet settings card. */
export type PetSettingsCardProps =
  PropsLocale<'pet'>
  & InjectFace<PetSettingsCardFace>

/**
 * Render the pet settings card.
 * @param props - locale copy, the card snapshot, and its form actions.
 * @returns the card.
 */
export function PetSettingsCard(props: PetSettingsCardProps) {
  const { t } = props
  const state = props.usePetSettingsCard(snapshot => snapshot)
  const disabled = !state.writable
  // The registry is read once, when the plugin starts; the pet API that serves
  // it exists only while the master switch is on. A card that opened empty
  // therefore asks again as soon as the switch is on, instead of leaving the
  // picker blank until the page reloads (the deferred reads had already spent
  // their retries while the API was absent).
  const enabled = state.enabled.text !== 'false'
  const hasChoices = state.petPreviews.length > 0
  const { refreshPets } = props
  useEffect(() => {
    if (enabled && !hasChoices) refreshPets()
  }, [enabled, hasChoices, refreshPets])
  const fieldProps = {
    overriddenLabel: t('settings.overridden'),
    resetLabel: t('settings.reset'),
    invalidLabel: t('settings.invalidNumber'),
    disabled,
    presentation: 'segment' as const,
  }
  // The master switch sits in the header, as the Workshop and Usage pages
  // carry theirs; the fallback has no Host form to write it through.
  const enabledSwitch = state.petSelectionFallback
    ? undefined
    : (
      <ToggleSwitch
        labelledBy="settings-pet-title"
        checked={state.enabled.text !== 'false'}
        disabled={disabled}
        onChange={(next) => { props.edit('enabled', String(next)) }}
      />
    )
  return (
    <PluginSettingsCard
      t={t}
      titleKey="settings.title"
      titleId="settings-pet-title"
      descriptionKey="settings.description"
      descriptionNode={state.petSelectionFallback ? t('settings.petHint') : undefined}
      headerAction={enabledSwitch}
      state={state}
      onSave={props.save}
      onDiscard={props.discard}
      alwaysOpen
    >
      <div className={sectionCss.settingsLayout}>
        <section className={sectionCss.selectionGroup}>
          <div className={sectionCss.groupHeader}>
            <h3 className={sectionCss.groupTitle} id="settings-pet-selection-title">{t('settings.pet')}</h3>
            {state.petId.overridden
              ? (
                <button
                  type="button"
                  className={sectionCss.textAction}
                  disabled={disabled}
                  onClick={() => { props.resetField('petId') }}
                >
                  {t('settings.reset')}
                </button>
              )
              : null}
          </div>
          <div
            id="settings-pet-pet"
            className={sectionCss.petGrid}
            role="group"
            aria-labelledby="settings-pet-selection-title"
          >
            {state.petPreviews.map(pet => {
              const selected = state.petId.text === pet.id
              return (
                <button
                  key={pet.id}
                  type="button"
                  className={selected ? `${sectionCss.petChoice} ${sectionCss.petChoiceSelected}` : sectionCss.petChoice}
                  aria-pressed={selected}
                  title={pet.displayName}
                  disabled={disabled}
                  onClick={() => { props.edit('petId', pet.id) }}
                >
                  <PetPreview pet={pet} />
                  <span className={sectionCss.petChoiceLabel}>{pet.displayName}</span>
                </button>
              )
            })}
          </div>
          <p className={state.petId.invalid ? sectionCss.invalid : sectionCss.groupHint}>
            {state.petId.invalid ? t('settings.invalidNumber') : t('settings.petHint')}
          </p>
        </section>

        <div className={sectionCss.settingsColumn}>
          <section className={sectionCss.settingsGroup}>
            <div className={sectionCss.groupHeader}>
              <h3 className={sectionCss.groupTitle} id="settings-pet-display-title">{t('settings.displayGroup')}</h3>
            </div>
            <div className={sectionCss.fields}>
              <BooleanField
                id="settings-pet-visible"
                label={t('settings.visible')}
                hint={t('settings.visibleHint')}
                inheritLabel={t('settings.inherit')}
                onLabel={t('settings.on')}
                offLabel={t('settings.off')}
                {...fieldProps}
                {...state.visible}
                onEdit={(text) => { props.edit('visible', text) }}
                onReset={() => { props.resetField('visible') }}
              />
              {state.petSelectionFallback ? null : <ValueField
                id="settings-pet-size"
                label={t('settings.size')}
                hint={t('settings.sizeHint')}
                numeric
                range={SIZE_RANGE}
                {...fieldProps}
                {...state.size}
                onEdit={(text) => { props.edit('size', text) }}
                onReset={() => { props.resetField('size') }}
              />}
              {state.petSelectionFallback ? null : <ValueField
                id="settings-pet-right"
                label={t('settings.right')}
                hint={t('settings.rightHint')}
                numeric
                range={INSET_RANGE}
                {...fieldProps}
                {...state.right}
                onEdit={(text) => { props.edit('right', text) }}
                onReset={() => { props.resetField('right') }}
              />}
              {state.petSelectionFallback ? null : <ValueField
                id="settings-pet-bottom"
                label={t('settings.bottom')}
                hint={t('settings.bottomHint')}
                numeric
                range={INSET_RANGE}
                {...fieldProps}
                {...state.bottom}
                onEdit={(text) => { props.edit('bottom', text) }}
                onReset={() => { props.resetField('bottom') }}
              />}
            </div>
          </section>

          {state.petSelectionFallback ? null : (
            <section className={sectionCss.settingsGroup}>
              <div className={sectionCss.groupHeader}>
                <h3 className={sectionCss.groupTitle} id="settings-pet-behavior-title">{t('settings.bubbleGroup')}</h3>
              </div>
              <div className={sectionCss.fields}>
                <BooleanField
                  id="settings-pet-decoration"
                  label={t('settings.decoration')}
                  hint={t('settings.decorationHint')}
                  inheritLabel={t('settings.inherit')}
                  onLabel={t('settings.on')}
                  offLabel={t('settings.off')}
                  {...fieldProps}
                  {...state.decorationEnabled}
                  onEdit={(text) => { props.edit('decorationEnabled', text) }}
                  onReset={() => { props.resetField('decorationEnabled') }}
                />
                <ChoiceField
                  id="settings-pet-status-bubbles"
                  label={t('settings.statusBubbles')}
                  hint={t('settings.statusBubblesHint')}
                  inheritLabel={t('settings.inherit')}
                  {...fieldProps}
                  {...state.statusBubbles}
                  choices={[
                    { value: STATUS_BUBBLE_CHOICES[0], label: t('settings.on') },
                    { value: STATUS_BUBBLE_CHOICES[1], label: t('settings.off') },
                  ]}
                  onEdit={(text) => { props.edit('statusBubbles', text) }}
                  onReset={() => { props.resetField('statusBubbles') }}
                />
                <ValueField
                  id="settings-pet-bubble-scale"
                  label={t('settings.bubbleScale')}
                  hint={t('settings.bubbleScaleHint')}
                  numeric
                  range={BUBBLE_SCALE_RANGE}
                  {...fieldProps}
                  {...state.bubbleScale}
                  onEdit={(text) => { props.edit('bubbleScale', text) }}
                  onReset={() => { props.resetField('bubbleScale') }}
                />
              </div>
            </section>
          )}
        </div>
      </div>
    </PluginSettingsCard>
  )
}

/** Props the settings section binds for the pet card page. */
export type PetSettingsSectionProps =
  (PropsRuntime<'settings.section'> | PropsRuntime<'web-ui.extension'>)
  & PropsLocale<'pet'>
  & InjectFace<PetSettingsCardFace>

/** Render the pet settings card as a first-level settings page. */
export function PetSettingsSection(props: PetSettingsSectionProps): ReactNode {
  const { t, usePetSettingsCard, save, discard, edit, resetField, refreshPets } = props
  return (
    <ul className={sectionCss.sectionList} data-dsh-plugin="pet" data-dsh-part="panel">
      <PetSettingsCard
        t={t}
        usePetSettingsCard={usePetSettingsCard}
        save={save}
        discard={discard}
        edit={edit}
        resetField={resetField}
        refreshPets={refreshPets}
      />
    </ul>
  )
}

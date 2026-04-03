import { useState, useCallback, useRef, useEffect } from 'react'
import { appMessage as message } from '../utils/appMessage'

export interface FormState<T> {
  data: T
  isDirty: boolean
  isValid: boolean
  lastSaved?: Date
}

export interface AutoSaveOptions<T> {
  initialData: T
  saveFunction: (data: T) => Promise<void>
  onSaveSuccess?: (data: T) => void
  onSaveError?: (error: Error) => void
  interval?: number
  validate?: (data: T) => boolean
  debounce?: number
}

export interface AutoSaveResult<T> {
  formState: FormState<T>
  updateData: (newData: Partial<T>) => void
  resetForm: () => void
  forceSave: () => Promise<void>
  discardChanges: () => void
  hasUnsavedChanges: boolean
  lastSaved?: Date
}

export const useAutoSave = <T extends Record<string, unknown>>(
  options: AutoSaveOptions<T>
): AutoSaveResult<T> => {
  const {
    initialData,
    saveFunction,
    onSaveSuccess,
    onSaveError,
    interval = 30000, // 30 seconds
    validate = () => true,
    debounce = 1000 // 1 second debounce
  } = options

  const [formState, setFormState] = useState<FormState<T>>({
    data: initialData,
    isDirty: false,
    isValid: true
  })

  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const intervalRef = useRef<NodeJS.Timeout | null>(null)
  const lastSaveRef = useRef<Date | null>(null)

  const performSave = useCallback(async () => {
    if (!formState.isDirty || !formState.isValid) {
      return
    }

    try {
      // logger.debug('Auto-saving form data', 'AutoSave')
      await saveFunction(formState.data)

      setFormState((prev) => ({
        ...prev,
        isDirty: false,
        lastSaved: new Date()
      }))

      lastSaveRef.current = new Date()

      if (onSaveSuccess) {
        onSaveSuccess(formState.data)
      }

      // logger.info('Form auto-saved successfully', 'AutoSave')
    } catch (error) {
      // logger.error('Auto-save failed', error as Error, 'AutoSave')

      if (onSaveError) {
        onSaveError(error as Error)
      } else {
        message.error('Auto-save failed. Your changes may not be saved.')
      }
    }
  }, [
    formState.data,
    formState.isDirty,
    formState.isValid,
    saveFunction,
    onSaveSuccess,
    onSaveError
  ])

  // Auto-save interval
  useEffect(() => {
    intervalRef.current = setInterval(() => {
      if (formState.isDirty && formState.isValid) {
        void performSave()
      }
    }, interval)

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
      }
    }
  }, [formState.isDirty, formState.isValid, interval, performSave])

  const updateData = useCallback(
    (newData: Partial<T>) => {
      const updatedData = { ...formState.data, ...newData }
      const isValid = validate(updatedData)

      setFormState((prev) => ({
        ...prev,
        data: updatedData,
        isDirty: true,
        isValid
      }))

      // Debounced save
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }

      saveTimeoutRef.current = setTimeout(() => {
        if (isValid) {
          void performSave()
        }
      }, debounce)
    },
    [formState.data, validate, performSave, debounce]
  )

  const resetForm = useCallback(() => {
    setFormState({
      data: initialData,
      isDirty: false,
      isValid: true
    })

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }
  }, [initialData])

  const forceSave = useCallback(async () => {
    await performSave()
  }, [performSave])

  const discardChanges = useCallback(() => {
    setFormState((prev) => ({
      ...prev,
      data: initialData,
      isDirty: false
    }))

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }

    // logger.info('Form changes discarded', 'AutoSave')
  }, [initialData])

  return {
    formState,
    updateData,
    resetForm,
    forceSave,
    discardChanges,
    hasUnsavedChanges: formState.isDirty,
    lastSaved: formState.lastSaved
  }
}

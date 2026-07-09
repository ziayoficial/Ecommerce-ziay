'use client'
import { useSyncExternalStore } from 'react'

// Idiomatic mounted hook (avoids setState-in-effect lint).
// Returns true only after hydration on the client.
const subscribe = () => () => {}
const getSnapshot = () => true
const getServerSnapshot = () => false

export function useMounted() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

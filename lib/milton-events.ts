// lib/milton-events.ts
import { EventEmitter } from 'events'

// Keep a global singleton for reliability across reloads
const globalKey = '__miltonEventsEmitter'
const emitter: EventEmitter =
  (globalThis as any)[globalKey] || ((globalThis as any)[globalKey] = new EventEmitter())

export const miltonEventsAPI = {
  publish(event: string, payload?: any) {
    console.log(`[miltonEventsAPI] publish -> ${event}`, payload)
    emitter.emit(event, payload)
  },
  subscribe(event: string, handler: (payload: any) => void) {
    console.log(`[miltonEventsAPI] subscribe -> ${event}`)
    emitter.on(event, handler)
    return () => {
      console.log(`[miltonEventsAPI] unsubscribe -> ${event}`)
      emitter.off(event, handler)
    }
  },
  emitter,
}

export type MiltonEventName =
  | 'datasets.linked'
  | 'dataset.ready'
  | 'insight.requested'
  | 'insight.generated'
  | 'chat.intent'
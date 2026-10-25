/**
 * Screen focus is UI state only: which foreground material is open and who is highlighted.
 * Changing focus never calls the server and never touches drafts, tasks or input text.
 */
import type { CharacterId } from '../../../shared/contracts.ts';
export type Panel = 'none' | 'document' | 'map' | 'record' | 'command' | 'audience';

export interface FocusState {
  panel: Panel;
  /** Highlighted speaker in the hall (S2); server owns the actual audience roster. */
  speaker: CharacterId | null;
  meeting?: boolean;
  documentId: string | null;
  devOpen: boolean;
}

export type FocusEvent =
  | { type: 'open'; panel: Exclude<Panel, 'none'>; documentId?: string }
  | { type: 'close' }
  | { type: 'toggle-dev' }
  | { type: 'address'; speaker: CharacterId | null; meeting?: boolean };

export const INITIAL_FOCUS: FocusState = { panel: 'none', speaker: null, documentId: null, devOpen: false };

export function reduceFocus(state: FocusState, event: FocusEvent): FocusState {
  switch (event.type) {
    case 'open':
      if (state.panel === event.panel && (event.documentId ?? state.documentId) === state.documentId) {
        return { ...state, panel: 'none' };
      }
      return { ...state, panel: event.panel, documentId: event.documentId ?? state.documentId };
    case 'close':
      // Closing a panel keeps the last document selection so reopening returns to it.
      return { ...state, panel: 'none' };
    case 'toggle-dev':
      return { ...state, devOpen: !state.devOpen };
    case 'address':
      return { ...state, speaker: event.speaker, meeting: event.meeting ?? state.meeting };
  }
}

/** Scene state ID used by the visual direction documents. */
export function sceneId(state: FocusState): 'S0' | 'S1' | 'S2' | 'S3' | 'S4' | 'S5' {
  if (state.panel === 'document') return 'S1';
  if (state.panel === 'map') return 'S4';
  if (state.panel === 'command') return 'S5';
  if (state.meeting) return 'S3';
  if (state.speaker) return 'S2';
  return 'S0';
}

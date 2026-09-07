import { createContext, useContext } from 'react';
import type { DemoState, Product, Workspace } from '../types';

type DemoContextValue = {
  state: DemoState; products: Product[]; busy: string | null;
  act: (label: string, action: () => Promise<DemoState>, message: string) => Promise<boolean>;
  navigate: (workspace: Workspace) => void; setState: (state: DemoState) => void;
  notify: (message: string, error?: boolean) => void;
};
export const DemoContext = createContext<DemoContextValue | null>(null);
export function useDemo() { const context = useContext(DemoContext); if (!context) throw new Error('Demo context missing'); return context; }

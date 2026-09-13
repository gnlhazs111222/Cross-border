import { useCallback } from 'react';
import type { Fact } from '../types';
import { useDemo } from './DemoContext';
import { useI18n } from '../i18n/I18nContext';
import { mockApi } from '../services/mockApi';

/**
 * The correction editor belongs to the fact-card comparison, so anything that needs it asks by fact
 * key instead of carrying a second copy of the form: the check panel's picture answers, and the alarm
 * that a pricing fact is still missing.
 */
export type FactEditRequest = { key: string; /** True when the edit answers an open picture disagreement. */ disputed?: boolean };
export const EDIT_FACT_EVENT = 'prismlaunch:edit-fact';
export const requestFactEdit = (factKey: string, disputed = false) => {
  window.dispatchEvent(new CustomEvent<FactEditRequest>(EDIT_FACT_EVENT, { detail: { key: factKey, disputed } }));
};
export const factRowSelector = (factKey: string) => `[data-testid="fact-review-${factKey}"]`;

/**
 * A workspace that has to send the person somewhere else to fix a fact cannot open the editor itself: the
 * key is handed over here and the page that owns the editor opens it once it is on screen.
 */
let pendingFactEdit: string | null = null;
export const requestFactEditAfterNavigation = (factKey: string) => { pendingFactEdit = factKey; };
export const takePendingFactEdit = () => { const key = pendingFactEdit; pendingFactEdit = null; return key; };

/** The fact cards are collapsed by default, so anything that points at a row opens them first. */
export const openFactComparison = () => {
  const panel = document.getElementById('fact-review');
  if (panel instanceof HTMLDetailsElement) panel.open = true;
  return panel;
};

/** Brings one row of the comparison into view, opening the block first because it starts collapsed. */
export const scrollToFactRow = (factKey: string) => {
  openFactComparison();
  document.querySelector(factRowSelector(factKey))?.scrollIntoView({ block: 'center', behavior: 'smooth' });
};

export function useFactCheckActions(onFocus?: (factKey: string) => void) {
  const { act, navigate } = useDemo();
  const { t } = useI18n();
  const scrollToFact = useCallback((factKey: string) => scrollToFactRow(factKey), []);
  const adoptPrintedText = async (f: Fact) => {
    onFocus?.(f.key);
    await act(`image-adopt-${f.key}`, () => mockApi.adoptPrintedText(f.key), 'The stored value now follows the text printed in the picture. Confirm it before it can enter copy.');
  };
  const discardPicture = async (f: Fact) => {
    const asset = f.imageCheck?.asset ?? '';
    onFocus?.(f.key);
    await act(`image-discard-${f.key}`, () => mockApi.discardImageCheck(asset), t('Picture {asset} is dropped from the checks and will not be read again. The other pictures still are.', { asset }));
  };
  /**
   * The reading disagrees because the picture itself is the wrong one: the picture leaves the checks and
   * the person goes to where pictures are kept to put the right one in. The fact is not touched.
   */
  const replacePicture = async (f: Fact) => {
    const asset = f.imageCheck?.asset ?? '';
    onFocus?.(f.key);
    const done = await act(`image-replace-${f.key}`, () => mockApi.discardImageCheck(asset), t('Picture {asset} is dropped from the checks so it can be replaced. Upload the corrected picture in Materials, then run the check again.', { asset }));
    if (done) navigate('materials');
  };
  const editDisputedFact = (f: Fact) => { onFocus?.(f.key); requestFactEdit(f.key, true); };
  return { adoptPrintedText, discardPicture, replacePicture, editDisputedFact, scrollToFact };
}

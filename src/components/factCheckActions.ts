import { useCallback } from 'react';
import type { Fact } from '../types';
import { useDemo } from './DemoContext';
import { useI18n } from '../i18n/I18nContext';
import { mockApi } from '../services/mockApi';

/**
 * The three answers to a picture disagreement: save what the picture prints, correct the value by
 * hand, or drop the picture. The check alarm panel and the Fact Review table both offer them, so
 * they live here once and both stay in step. The correction editor belongs to Fact Review, so the
 * alarm panel asks for it by fact key instead of carrying a second copy of the form.
 */
export const EDIT_DISPUTED_FACT_EVENT = 'prismlaunch:edit-disputed-fact';
export const requestDisputedFactEdit = (factKey: string) => {
  window.dispatchEvent(new CustomEvent<string>(EDIT_DISPUTED_FACT_EVENT, { detail: factKey }));
};
export const factRowSelector = (factKey: string) => `[data-testid="fact-review-${factKey}"]`;

/** The fact cards are collapsed by default, so anything that points at a row opens them first. */
export const openFactComparison = () => {
  const panel = document.getElementById('fact-review');
  if (panel instanceof HTMLDetailsElement) panel.open = true;
  return panel;
};

export function useFactCheckActions(onFocus?: (factKey: string) => void) {
  const { act } = useDemo();
  const { t } = useI18n();
  const scrollToFact = useCallback((factKey: string) => {
    openFactComparison();
    document.querySelector(factRowSelector(factKey))?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, []);
  const adoptPrintedText = async (f: Fact) => {
    onFocus?.(f.key);
    await act(`image-adopt-${f.key}`, () => mockApi.adoptPrintedText(f.key), 'The stored value now follows the text printed in the picture. Confirm it before it can enter copy.');
  };
  const discardPicture = async (f: Fact) => {
    const asset = f.imageCheck?.asset ?? '';
    onFocus?.(f.key);
    await act(`image-discard-${f.key}`, () => mockApi.discardImageCheck(asset), t('Picture {asset} is dropped from the checks and will not be read again. The other pictures still are.', { asset }));
  };
  const editDisputedFact = (f: Fact) => { onFocus?.(f.key); requestDisputedFactEdit(f.key); };
  return { adoptPrintedText, discardPicture, editDisputedFact, scrollToFact };
}

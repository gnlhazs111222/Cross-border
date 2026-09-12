import { UNIT_CHOICES, type UnitSystem } from '../../shared/units';
import { mockApi } from '../services/mockApi';
import { useDemo } from './DemoContext';
import { useI18n } from '../i18n/I18nContext';

/**
 * Top bar dropdown: the current unit system, switched with one click. Display only — stored values
 * stay metric, and the new state must go through DemoContext or the select snaps back.
 */
export function UnitSwitcher() {
  const { t } = useI18n();
  const { state, setState } = useDemo();
  const system = state.units ?? mockApi.unitSystem();
  // Short labels keep the top bar on one row on a phone; the full system stays in the tooltip.
  const label: Record<UnitSystem, string> = { us: t('US'), uk: t('UK'), metric: t('Metric') };
  return <label className="language-switcher unit-switcher" title={t('Unit conversion')}>
    <select aria-label={t('Unit conversion')} value={system} onChange={event => setState(mockApi.setUnits(event.target.value as UnitSystem))}>
      {UNIT_CHOICES.map(choice => <option key={choice.system} value={choice.system} title={t(choice.label)}>{label[choice.system]}</option>)}
    </select>
  </label>;
}

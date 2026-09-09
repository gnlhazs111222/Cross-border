import { useI18n } from '../i18n/I18nContext';
import type { Review } from '../types';
import { Badge } from './ui';
import './semantic-review.css';

export const semanticStatusLabel = (status: Review['status']) => ({ passed: 'Semantic review passed', blocked: 'Review blocked', needs_human_review: 'Human review required', failed: 'Review failed — retry required', running: 'Review in progress' })[status];
export const semanticStatusDescription = (status: Review['status']) => ({ passed: 'No issue was found within this review scope. This is not a compliance certification.', blocked: 'Resolve the reported issues and run review again. Publishing is locked.', needs_human_review: 'The evidence is ambiguous. Clarify the facts or copy and run review again. Publishing is locked.', failed: 'No approval was recorded. Use Run Review to retry. Publishing is locked.', running: 'Wait for the review result. Publishing is locked.' })[status];

export function SemanticReviewDetails({ review, approvalExpired = false }: { review: Review; approvalExpired?: boolean }) {
  const { t } = useI18n();
  const metadata = review.metadata;
  const errorCode = metadata?.errorCode && /^[a-zA-Z0-9_-]{1,80}$/.test(metadata.errorCode) ? metadata.errorCode : metadata?.errorCode ? 'review_failed' : null;
  const categories = { spec_conflict: 'Specification conflict', unsupported_claim: 'Unsupported claim', unauthorized_fact: 'Unauthorized fact', internal_disclosure: 'Internal information disclosure' };
  return <div className="semantic-review-details" data-testid="semantic-review-details">
    <p><Badge tone="blue">{t(metadata?.modelCalled ? 'Rules + Qwen semantic review' : 'Rules + Qwen mode — model not called')}</Badge></p>
    {!metadata?.modelCalled && <p>{t('This result does not establish that Qwen reviewed the copy.')}</p>}
    <h3>{t(approvalExpired ? 'Historical review passed — approval expired' : semanticStatusLabel(review.status))}</h3>
    <p>{t(approvalExpired ? 'This saved result no longer authorizes publication. Run Review again using the current configuration and versions.' : semanticStatusDescription(review.status))}</p>
    {errorCode && <p role="alert">{t('Error code')}: <code>{errorCode}</code></p>}
    {review.issues.map((issue, index) => <article className="risk-issue" key={`${issue.id}-${index}`}>
      <Badge tone="red">{issue.id} · {t(issue.category ? categories[issue.category] : issue.title)}</Badge>
      {issue.location && <p className="footnote">{t('Location')}: {t(issue.location.field)}{issue.location.index !== undefined ? ` [${issue.location.index + 1}]` : ''}{issue.location.key ? ` / ${issue.location.key}` : ''}{issue.location.occurrence !== undefined ? ` · ${t('Occurrence')} ${issue.location.occurrence + 1}` : ''}</p>}
      <blockquote lang="en">{issue.text}</blockquote>
      <p>{issue.reason}</p>
      {!!issue.factKeys?.length && <p>{t('Related facts')}: {issue.factKeys.join(', ')}</p>}
      {issue.suggestedFix && <p><strong>{t('Suggested correction')}: </strong>{issue.suggestedFix}</p>}
      {issue.origin && <small>{t('Issue source')}: {issue.origin === 'qwen' ? 'Qwen' : t('Rules')}</small>}
    </article>)}
    {metadata && <details><summary>{t('Review trace')}</summary><dl>
      <dt>{t('Model')}</dt><dd>{metadata.modelCalled ? metadata.model : t('Not called')}</dd>
      <dt>{t('Prompt version')}</dt><dd>{metadata.promptVersion}</dd>
      <dt>{t('Rule version')}</dt><dd>{metadata.ruleVersion}</dd>
      <dt>{t('Listing / facts / task revisions')}</dt><dd>{metadata.listingRevision} / {metadata.factsRevision} / {metadata.taskRevision}</dd>
      {metadata.validationIssues?.length ? <><dt>{t('Output validation')}</dt><dd>{metadata.validationIssues.map((issue, index) => <div key={index}><code>{issue.path}: {issue.code}</code></div>)}</dd></> : null}
      {metadata.aiCallId && <><dt>{t('Call ID')}</dt><dd>{metadata.aiCallId}</dd></>}
    </dl></details>}
  </div>;
}

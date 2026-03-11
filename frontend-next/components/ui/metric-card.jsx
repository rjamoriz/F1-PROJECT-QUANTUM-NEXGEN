import clsx from 'clsx';

export default function MetricCard({
  label,
  value,
  subtitle,
  tone = 'neutral',
}) {
  return (
    <article
      className={clsx(
        'qa-card qa-metric-card',
        tone === 'good' && 'qa-card-good',
        tone === 'warn' && 'qa-card-warn',
        tone === 'danger' && 'qa-card-danger'
      )}
    >
      <p className="qa-metric-label">{label}</p>
      <p className="qa-metric-value">{value}</p>
      {subtitle ? <p className="qa-metric-subtitle">{subtitle}</p> : null}
    </article>
  );
}

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Minus, Plus, Trophy, X } from 'lucide-react';
import { CANDIDATES, COMPARE_KEY, METRICS, MIN_COMPARE, NOTES, best, parseCompare, summarize, toggleCompare, type Metric, type Tip } from './compare.ts';
import { MINUTE_OPTIONS, USER_OPTIONS, formatCount, type Usage } from './cost.ts';

const loadCompare = () => { try { return parseCompare(localStorage.getItem(COMPARE_KEY)); } catch { return parseCompare(null); } };
const TIP_HALF = 150;   // tooltip en fazla 280 px; ekran kenarına bu kadar yaklaşmaz

type ShownTip = { tip: Tip; x: number; y: number; below: boolean; shift: number };

/** Kutuların altında açılan kıyaslama paneli: seçilen her aday dikey bir kart; üstte artılar ve eksiler,
 *  ayraçtan sonra en altta kıyaslanan değer. Değerler kartlar arasında aynı hizadadır. */
export default function ComparePanel({ metric, usage, onUsage, onClose }: { metric: Metric; usage: Usage; onUsage: (usage: Usage) => void; onClose: () => void }) {
  const [selected, setSelected] = useState<string[]>(loadCompare);
  const [tip, setTip] = useState<ShownTip | null>(null);
  useEffect(() => { try { localStorage.setItem(COMPARE_KEY, JSON.stringify(selected)); } catch { /* yalnızca oturumda kalır */ } }, [selected]);
  useEffect(() => {
    if (!tip) return;
    const hide = () => setTip(null);
    addEventListener('scroll', hide, true); addEventListener('resize', hide);
    return () => { removeEventListener('scroll', hide, true); removeEventListener('resize', hide); };
  }, [tip]);
  useEffect(() => setTip(null), [metric, selected]);
  // Kartlar taşanı kestiği için tooltip sayfaya sabit konumla, hedefin üstünde (yer yoksa altında) çizilir.
  const showTip = (value: Tip) => (event: { currentTarget: Element }) => {
    const rect = event.currentTarget.getBoundingClientRect(), center = rect.left + rect.width / 2;
    const x = Math.min(Math.max(center, TIP_HALF), innerWidth - TIP_HALF), below = rect.top < 150;
    setTip({ tip: value, x, y: below ? rect.bottom : rect.top, below, shift: center - x });
  };
  const hideTip = () => setTip(null);
  const info = METRICS.find(item => item.value === metric)!;
  const shown = CANDIDATES.filter(candidate => selected.includes(candidate.id)), rest = CANDIDATES.filter(candidate => !selected.includes(candidate.id));
  const winners = selected.length >= MIN_COMPARE ? best(metric, selected, usage) : [];
  return <section className="compare-panel" data-metric={metric} aria-label={`${info.title} kıyaslaması`}>
    <header className="compare-head">
      <div><h2>{info.title}</h2><p>{info.hint}</p></div>
      {metric === 'price' && <>
        <label className="compare-add"><select aria-label="Kişi başı aylık dakika" value={usage.minutes} onChange={event => onUsage({ ...usage, minutes: Number(event.target.value) })}>{MINUTE_OPTIONS.map(option => <option key={option} value={option}>{option} dk / kişi</option>)}</select><ChevronDown size={14} aria-hidden="true" /></label>
        <label className="compare-add"><select aria-label="Kullanıcı sayısı" value={usage.users} onChange={event => onUsage({ ...usage, users: Number(event.target.value) })}>{USER_OPTIONS.map(option => <option key={option} value={option}>{formatCount(option)} kullanıcı</option>)}</select><ChevronDown size={14} aria-hidden="true" /></label>
      </>}
      <label className="compare-add"><select aria-label="Kıyaslamaya ekle" value="" disabled={!rest.length} onChange={event => { if (event.target.value) setSelected(toggleCompare(selected, event.target.value)); }}>
        <option value="">{rest.length ? 'Kıyaslamaya ekle…' : 'Tümü kıyaslanıyor'}</option>
        {rest.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.label}</option>)}
      </select><ChevronDown size={14} aria-hidden="true" /></label>
      <button type="button" className="compare-close" aria-label="Kıyaslamayı kapat" onClick={onClose}><X size={17} strokeWidth={1.8} /></button>
    </header>
    {shown.length < MIN_COMPARE && <p className="compare-hint" role="status">Kıyaslamak için en az {MIN_COMPARE} seçenek ekleyin.</p>}
    {shown.length > 0 && <div className="compare-cards" style={{ gridTemplateColumns: `repeat(${Math.max(shown.length, MIN_COMPARE)}, minmax(0, 1fr))` }}>
      {shown.map(candidate => {
        const notes = NOTES[metric][candidate.id], summary = summarize(metric, candidate, usage), winner = winners.includes(candidate.id);
        const badge = winner && <em><Trophy size={11} aria-hidden="true" />en düşük</em>;
        return <article key={candidate.id} className={`compare-card ${candidate.role}${winner ? ' best' : ''}`} data-candidate={candidate.id}>
          <header>
            <h3>{candidate.label}</h3>
            <p>{candidate.models}</p>
            <button type="button" aria-label={`${candidate.label} kıyaslamadan çıkar`} title="Kıyaslamadan çıkar" onClick={() => setSelected(toggleCompare(selected, candidate.id))}><X size={14} /></button>
          </header>
          <div className="compare-notes">
            <h4>Avantajlar</h4>
            <ul className="pros">{notes.pros.map(line => <li key={line}><Plus size={13} aria-hidden="true" />{line}</li>)}</ul>
            <h4>Dezavantajlar</h4>
            <ul className="cons">{notes.cons.map(line => <li key={line}><Minus size={13} aria-hidden="true" />{line}</li>)}</ul>
          </div>
          <footer>
            {metric === 'latency' ? <>
              <span className="compare-caption">{info.unit}{badge}</span>
              <dl className="compare-rows">{summary.values.map(item => <div key={item.label} className={item.missing ? 'missing' : ''} tabIndex={0}
                aria-label={`${item.label}: ${item.missing ? 'ölçülmedi' : item.value}. ${item.tip ? [item.tip.title, ...item.tip.lines].join(' ') : ''}`}
                onMouseEnter={item.tip && showTip(item.tip)} onFocus={item.tip && showTip(item.tip)} onMouseLeave={hideTip} onBlur={hideTip}>
                <dt>{item.label}</dt><dd data-compare-value>{item.value}</dd>
              </div>)}</dl>
            </> : <>
              <span className="compare-caption">{summary.values[0].label}{badge}</span>
              <strong data-compare-value>{summary.values[0].value}</strong>
              <ul>{summary.detail.map(line => <li key={line}>{line}</li>)}</ul>
            </>}
          </footer>
        </article>;
      })}
    </div>}
    {/* Panelin backdrop-filter'ı sabit konumu panele bağlar; tooltip bu yüzden body'ye çizilir. */}
    {tip && createPortal(<div role="tooltip" className={`compare-tooltip${tip.below ? ' below' : ''}`} style={{ left: tip.x, top: tip.y, ['--arrow-shift' as string]: `${tip.shift}px` }}>
      <strong>{tip.tip.title}</strong>
      {tip.tip.lines.map(line => <p key={line}>{line}</p>)}
    </div>, document.body)}
  </section>;
}

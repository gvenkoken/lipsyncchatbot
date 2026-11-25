import { useState } from 'react';
import { ChevronDown, Info } from 'lucide-react';
import type { Choices, Mode } from './flow.ts';
import { ASSUMPTIONS, MINUTE_OPTIONS, PRICES_AS_OF, USER_OPTIONS, estimate, formatCount, formatUsd, type Usage } from './cost.ts';

/** Sayfanın alt ortasında duran maliyet alanı: panodaki seçimler + aylık dakika ve kullanıcı sayısı. */
export default function CostDock({ mode, choices, usage, onUsage: setUsage }: { mode: Mode; choices: Choices; usage: Usage; onUsage: (usage: Usage) => void }) {
  const [details, setDetails] = useState(false);
  const result = estimate(mode, choices, usage);
  return <section className="cost-dock" aria-label="Maliyet hesabı">
    {details && <div id="cost-details" className="cost-details">
      <table>
        <thead><tr><th scope="col">Kalem</th><th scope="col">Dayanak</th><th scope="col">Konuşma dk</th><th scope="col">Aylık</th></tr></thead>
        <tbody>{result.parts.map(part => <tr key={part.key}><th scope="row"><i className={`cost-swatch ${part.role}`} />{part.label}</th><td>{part.basis}{!part.verified && <em>doğrulanmadı</em>}</td><td>{formatUsd(part.perMinute)}</td><td>{formatUsd(part.monthly)}</td></tr>)}</tbody>
      </table>
      <p>Bir konuşma dakikası: %{ASSUMPTIONS.listenShare * 100} kullanıcı konuşur, %{ASSUMPTIONS.speakShare * 100} avatar konuşur, {ASSUMPTIONS.turnsPerMinute} soru-yanıt; her yanıtta {ASSUMPTIONS.inputTokensPerTurn} giriş ve {ASSUMPTIONS.outputTokensPerTurn} çıkış tokenı. Liste fiyatları, {PRICES_AS_OF}; vergi, hacim indirimi ve barındırma hariç.</p>
    </div>}
    <div className="cost-bar">
      <label className="cost-field"><span>Kişi başı aylık</span><span className="cost-select"><select aria-label="Kişi başı aylık dakika" value={usage.minutes} onChange={event => setUsage({ ...usage, minutes: Number(event.target.value) })}>{MINUTE_OPTIONS.map(option => <option key={option} value={option}>{option} dk</option>)}</select><ChevronDown size={14} aria-hidden="true" /></span></label>
      <label className="cost-field"><span>Kullanıcı</span><span className="cost-select"><select aria-label="Kullanıcı sayısı" value={usage.users} onChange={event => setUsage({ ...usage, users: Number(event.target.value) })}>{USER_OPTIONS.map(option => <option key={option} value={option}>{formatCount(option)}</option>)}</select><ChevronDown size={14} aria-hidden="true" /></span></label>
      <div className="cost-total" role="status" aria-live="polite">
        <span>Tahmini aylık maliyet</span>
        <strong data-cost-monthly={result.monthly.toFixed(2)}>{formatUsd(result.monthly)}</strong>
        <small>{formatUsd(result.perUser)} / kullanıcı · {formatUsd(result.perMinute)} / dk</small>
      </div>
      <button type="button" className={`cost-toggle${details ? ' selected' : ''}`} aria-expanded={details} aria-controls="cost-details" title="Kalemler ve varsayımlar" aria-label="Kalemler ve varsayımlar" onClick={() => setDetails(!details)}><Info size={17} strokeWidth={1.8} /></button>
    </div>
  </section>;
}

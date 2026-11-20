import { useEffect, useRef, useState } from 'react';
import { AudioLines, Brain, Check, ChevronDown, CircleDollarSign, CircleUserRound, GitCompareArrows, Mic, Timer } from 'lucide-react';
import { BOARD, CHOICES_KEY, EDGES, NODE, NODES, applyChoice, chatReady, choicesFor, edgePath, isWired, menuGroups, parseState, selection, type ChoiceState, type FlowOption, type Mode, type Role } from './flow.ts';

import CostDock from './CostDock.tsx';
import ComparePanel from './ComparePanel.tsx';
import { METRICS, type Metric } from './compare.ts';
import { USAGE_KEY, parseUsage, type Usage } from './cost.ts';

const METRIC_ICONS = { tokens: GitCompareArrows, latency: Timer, price: CircleDollarSign } satisfies Record<Metric, unknown>;
const loadUsage = () => { try { return parseUsage(localStorage.getItem(USAGE_KEY)); } catch { return parseUsage(null); } };
const ICONS = { avatar: CircleUserRound, stt: Mic, llm: Brain, tts: AudioLines } satisfies Record<Role, unknown>;
export const loadChoiceState = () => { try { return parseState(localStorage.getItem(CHOICES_KEY)); } catch { return parseState(null); } };

/** Izgaralı pano: sohbet akışının adımları kutu, veri akışı ok olarak çizilir. Kutuya tıklanınca altında seçenekler açılır. */
export default function FlowBoard({ mode, onMode, onReady }: { mode: Mode; onMode: (mode: Mode) => void; onReady: (ready: boolean) => void }) {
  const [state, setState] = useState<ChoiceState>(loadChoiceState);
  const choices = choicesFor(mode, state), ready = chatReady(mode, state);
  useEffect(() => { onReady(ready); }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps
  const [openId, setOpenId] = useState<string | null>(null);
  const [usage, setUsage] = useState<Usage>(loadUsage);
  const [metric, setMetric] = useState<Metric | null>(null);
  useEffect(() => { try { localStorage.setItem(USAGE_KEY, JSON.stringify(usage)); } catch { /* yalnızca oturumda kalır */ } }, [usage]);
  const board = useRef<HTMLDivElement>(null);
  useEffect(() => { try { localStorage.setItem(CHOICES_KEY, JSON.stringify(state)); } catch { /* kalıcı depolama yoksa yalnızca oturumda kalır */ } }, [state]);
  useEffect(() => {
    if (!openId) return;
    const outside = (event: PointerEvent) => { if (!(event.target as Element).closest?.('.flow-node')) setOpenId(null); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpenId(null); board.current?.querySelector<HTMLButtonElement>(`[data-node="${openId}"] .flow-box`)?.focus(); } };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [openId]);
  const pick = (role: Role, option: FlowOption) => {
    if (role === 'avatar') { if (option.mode && option.mode !== mode) onMode(option.mode); } else setState(applyChoice(state, mode, role, option.value));
    setOpenId(null);
  };
  const byId = Object.fromEntries(NODES.map(node => [node.id, node]));
  return <div className={`flow-scroll${metric ? ' comparing' : ''}`}>
    <nav className="compare-tools" aria-label="Kıyaslamalar">
      {METRICS.map(item => { const Icon = METRIC_ICONS[item.value]; return <button key={item.value} type="button" className={metric === item.value ? 'selected' : ''} title={`${item.title} kıyaslaması`} aria-label={`${item.title} kıyaslaması`} aria-pressed={metric === item.value} data-metric={item.value} onClick={() => setMetric(metric === item.value ? null : item.value)}><Icon size={19} strokeWidth={1.8} /></button>; })}
    </nav>
    <div ref={board} className="flow-board" style={{ width: BOARD.width, height: BOARD.height }} role="group" aria-label="Sohbet akışı">
      <svg className="flow-edges" width={BOARD.width} height={BOARD.height} aria-hidden="true">
        <defs><marker id="flow-arrow" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 1 L 9 5 L 0 9 z" /></marker></defs>
        {EDGES.map(edge => { const path = edgePath(byId[edge.from], byId[edge.to]); return <g key={edge.from + edge.to}><path d={path.d} markerEnd="url(#flow-arrow)" /><text x={path.labelX} y={path.labelY - 9} textAnchor="middle">{edge.label}</text></g>; })}
      </svg>
      {NODES.map(node => {
        const { option, locked } = selection(node.role, mode, choices), open = openId === node.id, Icon = ICONS[node.role];
        return <div key={node.id} className={`flow-node ${node.role}${open ? ' open' : ''}${locked ? ' locked' : ''}`} data-node={node.id} style={{ left: node.x, top: node.y, width: NODE.width }}>
          <button type="button" className="flow-box" style={{ height: NODE.height }} disabled={locked} aria-haspopup="listbox" aria-expanded={open} title={locked ? 'Bu avatarda STT, LLM ve TTS tek bir sesten sese modelde çalışır; ayrı seçilemez' : node.caption} onClick={() => setOpenId(open ? null : node.id)}>
            <span className="flow-head"><Icon size={15} strokeWidth={1.9} aria-hidden="true" /><span>{node.title}</span>{!locked && <ChevronDown size={14} className="flow-chevron" aria-hidden="true" />}</span>
            <strong>{option.label}</strong>
            <span className="flow-detail">{option.detail}{!option.wired && <em>bağlı değil</em>}</span>
          </button>
          {open && <ul className="flow-menu" role="listbox" aria-label={`${node.title} seçenekleri`}>
            {menuGroups(node.role, mode).map(group => <li key={String(group.litellm)} role="presentation" className={group.litellm ? 'flow-group litellm' : 'flow-group'}>
              {group.litellm && <span className="flow-group-label" aria-hidden="true">LiteLLM</span>}
              <ul role="group" aria-label={group.litellm ? 'LiteLLM üzerinden' : undefined}>
                {group.options.map(item => <li key={item.value} role="option" aria-selected={item.value === option.value}>
                  <button type="button" onClick={() => pick(node.role, item)}><span><strong>{item.label}</strong><small>{item.detail}{!isWired(node.role, item, mode) && ' · bağlı değil'}</small></span>{item.value === option.value && <Check size={15} aria-hidden="true" />}</button>
                </li>)}
              </ul>
            </li>)}
          </ul>}
        </div>;
      })}
    </div>
    {metric ? <ComparePanel metric={metric} usage={usage} onUsage={setUsage} onClose={() => setMetric(null)} /> : <CostDock mode={mode} choices={choices} usage={usage} onUsage={setUsage} />}
  </div>;
}

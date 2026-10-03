import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion, useInView, useReducedMotion } from 'motion/react';
import { Activity, Check, CheckCheck, ChevronDown, Code2, Copy, GitPullRequest, Menu, Pause, Play, RotateCcw, ScanLine, ShieldCheck, Terminal, X } from 'lucide-react';

const REPOSITORY = 'https://github.com/SriVarshini09/self-healing-api';
const DOCS = `${REPOSITORY}#readme`;
const EASE = [0.22, 1, 0.36, 1] as const;
const STAGES = ['Event received', 'Outcome failed', 'Diagnosis', 'Patch ready for review'] as const;

type Scenario = {
  id: 'payment' | 'subscription';
  label: string;
  event: string;
  success: string;
  failure: string;
  outcome: string;
  reason: string;
  target: string;
};

const SCENARIOS: Scenario[] = [
  { id: 'payment', label: 'Payment provisioning', event: 'invoice.payment_succeeded', success: 'provisioning.completed', failure: 'provisioning.failed', outcome: 'Customer access', reason: 'The handler acknowledged the payment but skipped provisioning.', target: 'apps/demo-saas/src/business-outcome.ts' },
  { id: 'subscription', label: 'Subscription activation', event: 'customer.subscription.created', success: 'subscription.activated', failure: 'subscription.activation_failed', outcome: 'Subscription access', reason: 'The handler received the subscription event but skipped account activation.', target: 'apps/demo-saas/src/subscription-outcome.ts' },
];

const SDK_EXAMPLE = `import { createClient } from '@shapi/sdk';

const shapi = createClient({
  apiKey: process.env.SHAPI_API_KEY!,
  apiUrl: process.env.SHAPI_API_URL!,
});

const report = shapi.webhookReporter('stripe', {
  success: 'provisioning.completed',
  failure: 'provisioning.failed',
});

await report(event.type, event.data.object, async () => {
  const result = await provisionCustomer(customerId);
  return { success: result.ok, details: result };
});`;

function Mark({ className = '' }: { className?: string }) {
  return <svg className={`brand-mark ${className}`} viewBox="0 0 36 36" fill="none" aria-hidden="true"><path d="M2 19h9l5-12 6 24 4-12h8" stroke="currentColor" strokeWidth="3" strokeLinejoin="miter" /></svg>;
}

function Reveal({ children, className = '' }: { children: ReactNode; className?: string }) {
  const reduced = useReducedMotion();
  return <motion.div className={className} initial={reduced ? false : { opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.12 }} transition={{ duration: 0.55, ease: EASE }}>{children}</motion.div>;
}

function Eyebrow({ number, children, light = false }: { number: string; children: ReactNode; light?: boolean }) {
  return <div className={`eyebrow ${light ? 'eyebrow-dark' : ''}`}><span className="section-number">{number}</span><span>{children}</span></div>;
}

function Navigation() {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(false); buttonRef.current?.focus(); }
    };
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('keydown', key);
    document.addEventListener('pointerdown', outside);
    return () => { document.removeEventListener('keydown', key); document.removeEventListener('pointerdown', outside); };
  }, [open]);

  return <header className="site-header">
    <div className="shell nav-inner" ref={menuRef}>
      <a className="wordmark" href="#top" aria-label="SHAPI home"><Mark /><span>SHAPI<span className="wordmark-period">.</span></span></a>
      <nav className="desktop-nav" aria-label="Main navigation"><a href="#demo">Demo</a><a href="#how-it-works">How it works</a><a href="#developers">Developers</a></nav>
      <a className="button button-small button-outline desktop-dashboard" href="/">Open dashboard</a>
      <button ref={buttonRef} className="menu-button" aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open} aria-controls="mobile-navigation" onClick={() => setOpen(!open)}>{open ? <X /> : <Menu />}</button>
      <nav id="mobile-navigation" className="mobile-nav" aria-label="Mobile navigation" hidden={!open}>
        <a href="#demo" onClick={() => setOpen(false)}>Demo</a><a href="#how-it-works" onClick={() => setOpen(false)}>How it works</a><a href="#developers" onClick={() => setOpen(false)}>Developers</a><a href="/">Open dashboard</a>
      </nav>
    </div>
  </header>;
}

function HeroTrace() {
  const reduced = useReducedMotion();
  return <motion.div className="hero-trace" initial={reduced ? false : { y: 18 }} animate={{ y: 0 }} transition={{ duration: 0.8, ease: EASE }}>
    <div className="trace-cap"><span className="mono">EVENT TRACE / 001</span><span className="trace-example">Example</span></div>
    <div className="transport-receipt">
      <div className="receipt-label"><span>01 — TRANSPORT</span><Check size={18} /></div>
      <div className="http-status">200<span>OK</span></div>
      <p>Payment received.</p>
      <code>invoice.payment_succeeded</code>
    </div>
    <div className="trace-bridge" aria-hidden="true"><svg viewBox="0 0 400 76" preserveAspectRatio="none"><path className="bridge-track" d="M38 0 V38 H362 V76" /><motion.path className="bridge-signal" d="M38 0 V38 H362 V76" initial={{ pathLength: reduced ? 1 : 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.8, delay: reduced ? 0 : 0.1, ease: EASE }} /></svg><span>But did the work happen?</span></div>
    <div className="outcome-receipt">
      <div className="receipt-label"><span>02 — BUSINESS OUTCOME</span><span className="status status-fail">Failed</span></div>
      <div className="outcome-title"><span>Customer<br />access</span><span className="missing-symbol" aria-hidden="true">×</span></div>
      <div className="outcome-detail"><code>provisioning.failed</code><span>Not provisioned</span></div>
    </div>
    <div className="trace-footer"><Mark /><span>This is where SHAPI looks.</span></div>
  </motion.div>;
}

function Hero() {
  return <section className="hero shell" aria-labelledby="hero-title">
    <div className="hero-topline"><span className="mono">BEHAVIORAL ASSURANCE FOR INTEGRATIONS</span><span className="hero-edition mono">BEYOND THE STATUS CODE</span></div>
    <div className="hero-grid">
      <div className="hero-copy">
        <h1 id="hero-title">A <span className="headline-code">200 OK</span><br />doesn’t prove<br /><span className="headline-success">success<span className="headline-period">.</span></span></h1>
        <p className="hero-description">The webhook arrived. The customer still has no access. SHAPI checks the business outcome and helps you find and review a repair.</p>
        <div className="hero-actions"><a className="button button-lime" href="#demo"><Play size={16} fill="currentColor" />Explore the demo</a><a className="text-link" href={DOCS}>Read the docs<span className="link-line" /></a></div>
        <p className="hero-note mono">EVENT → OUTCOME → EVIDENCE</p>
      </div>
      <HeroTrace />
    </div>
    <div className="hero-bottom"><span>Delivery is the beginning.</span><a href="#demo">Follow what happens next<ChevronDown size={16} /></a><span className="mono hero-bottom-end">SCROLL TO TRACE</span></div>
  </section>;
}

function StageIcon({ index }: { index: number }) {
  const Icon = [Activity, ScanLine, Terminal, GitPullRequest][index];
  return <Icon size={24} strokeWidth={1.5} />;
}

function DemoEvidence({ scenario, stage }: { scenario: Scenario; stage: number }) {
  const explanations = [
    { title: 'The delivery looks healthy.', body: 'The provider’s event reaches the handler. An HTTP 200 acknowledges receipt; the application still has work to do.' },
    { title: 'The customer is still waiting.', body: `${scenario.reason} The application explicitly reports a failed business outcome to SHAPI.` },
    { title: 'The failure has evidence.', body: 'The reported failure violates the outcome predicate. SHAPI evaluates the sampled window and attaches evidence to the incident for diagnosis.' },
    { title: 'A repair you can inspect.', body: 'For this reviewed demo target, a patch can be previewed before opening a PR. Required checks and human review are part of the repair workflow.' },
  ];
  return <div className="demo-evidence" data-stage={stage}>
    <div className="evidence-explanation"><span className="mono evidence-index">0{stage + 1} / 04</span><h3>{explanations[stage].title}</h3><p>{explanations[stage].body}</p></div>
    <div className="evidence-record">
      <div className="record-header"><Terminal size={15} /><span>{stage === 3 ? 'REVIEWED TARGET' : 'TRACE EVIDENCE'}</span><span className="record-tag">EXAMPLE</span></div>
      {stage === 0 && <dl className="record-lines"><div><dt>event</dt><dd>{scenario.event}</dd></div><div><dt>http.status</dt><dd className="lime-text">200 OK</dd></div><div><dt>delivery</dt><dd>acknowledged</dd></div><div><dt>outcome</dt><dd className="muted-text">not yet evaluated</dd></div></dl>}
      {stage === 1 && <dl className="record-lines"><div><dt>http.status</dt><dd className="lime-text">200 OK</dd></div><div><dt>reported</dt><dd className="orange-text">{scenario.failure}</dd></div><div><dt>success</dt><dd className="orange-text">false</dd></div><div><dt>customer</dt><dd>access unavailable</dd></div></dl>}
      {stage === 2 && <div className="evaluation-record"><span className="mono muted-text">OUTCOME PREDICATE</span><code>event.type !==<br /><span className="orange-text">'{scenario.failure}'</span></code><div className="evaluation-result"><X size={16} /><span>Failed sample</span></div><p>Window: 5 min · Minimum: 5 samples<br />Expected success rate: 99%</p></div>}
      {stage === 3 && <div className="review-record"><code>{scenario.target}</code><p>Required checks</p><div className="check-tags"><span><ShieldCheck size={14} />verify</span><span><ShieldCheck size={14} />business-outcome</span></div><div className="review-note"><GitPullRequest size={16} />Preview patch → Human review → PR</div><span className="mono muted-text">No repository action is performed in this demo.</span></div>}
    </div>
  </div>;
}

function InteractiveDemo() {
  const [scenarioIndex, setScenarioIndex] = useState(0);
  const [stage, setStage] = useState(0);
  const [playing, setPlaying] = useState(false);
  const sectionRef = useRef<HTMLElement>(null);
  const inView = useInView(sectionRef, { amount: 0.2 });
  const reduced = useReducedMotion();
  const [pageVisible, setPageVisible] = useState(true);
  const scenario = SCENARIOS[scenarioIndex];

  useEffect(() => {
    const onVisibility = () => setPageVisible(!document.hidden);
    onVisibility();
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  useEffect(() => {
    if (!inView || !pageVisible) setPlaying(false);
  }, [inView, pageVisible]);

  useEffect(() => {
    if (!playing || !inView || !pageVisible) return;
    const timer = window.setTimeout(() => {
      if (stage < 3) setStage(stage + 1);
      else setPlaying(false);
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [playing, stage, inView, pageVisible]);

  const selectStage = (index: number) => { setStage(index); setPlaying(false); };
  const togglePlayback = () => {
    if (!playing && stage === 3) setStage(0);
    setPlaying(!playing);
  };

  return <section ref={sectionRef} id="demo" className="demo-section section-pad" aria-labelledby="demo-title">
    <div className="shell">
      <Reveal><Eyebrow number="01">FOLLOW THE FAILURE</Eyebrow><div className="section-heading demo-heading"><h2 id="demo-title">The request passed.<br /><span className="muted-text">The outcome failed.</span></h2><p>See the gap between a successful response and a successful customer experience.</p></div></Reveal>
      <div className="demo-console">
        <div className="demo-toolbar"><div className="scenario-switch" role="group" aria-label="Demo scenario">{SCENARIOS.map((item, index) => <button key={item.id} aria-pressed={index === scenarioIndex} onClick={() => { setScenarioIndex(index); setStage(0); setPlaying(false); }}>{item.label}</button>)}</div><span className="demo-label"><span aria-hidden="true">◈</span> Illustrative demo</span></div>
        <div className="trace-stages" aria-label="Demo stages">
          <div className="trace-rail" aria-hidden="true"><motion.div animate={{ scaleX: stage / 3 }} transition={{ duration: reduced ? 0 : 0.65, ease: EASE }} /></div>
          {STAGES.map((label, index) => <button key={label} className={`trace-step ${index === stage ? 'is-current' : ''} ${index < stage ? 'is-complete' : ''} ${index === 1 && stage >= 1 ? 'is-failure' : ''}`} aria-current={index === stage ? 'step' : undefined} onClick={() => selectStage(index)}><span className="step-glyph"><StageIcon index={index} /></span><span className="step-number mono">0{index + 1}</span><span className="step-label">{label}</span></button>)}
        </div>
        <div aria-live="polite" aria-atomic="true" className="sr-only">{scenario.label}: {STAGES[stage]}</div>
        <AnimatePresence mode="wait" initial={false}><motion.div key={`${scenario.id}-${stage}`} initial={{ opacity: reduced ? 1 : 0 }} animate={{ opacity: 1 }} exit={{ opacity: reduced ? 1 : 0 }} transition={{ duration: reduced ? 0 : 0.13 }}><DemoEvidence scenario={scenario} stage={stage} /></motion.div></AnimatePresence>
        <div className="demo-controls"><button className="button button-lime button-small" onClick={togglePlayback} aria-label={playing ? 'Pause demo' : 'Play demo'}>{playing ? <Pause size={16} /> : <Play size={16} fill="currentColor" />}{playing ? 'Pause demo' : stage === 3 ? 'Play again' : 'Play demo'}</button><button className="restart-button" onClick={() => { setStage(0); setPlaying(false); }}><RotateCcw size={16} /><span>Restart</span></button><span className="demo-duration mono">{playing ? 'PLAYING' : 'INSPECT AT YOUR PACE'}<span> / ~12 SEC</span></span></div>
      </div>
      <p className="demo-caption"><span className="caption-rule" />This example uses instrumented outcomes. SHAPI needs your application to report what happened.</p>
    </div>
  </section>;
}

const WORKFLOW = [
  { title: 'Define the outcome.', description: 'A paid invoice should lead to a provisioned customer. Report the application’s result and give that expectation an executable rule.', label: '01 / THE EXPECTATION' },
  { title: 'Find the failure.', description: 'Evaluate real event samples over a configured window. When the outcome breaks its rule, inspect the incident, diagnosis, and supporting evidence.', label: '02 / THE EVIDENCE' },
  { title: 'Review the repair.', description: 'Inspect an exact patch for a supported, mapped target. Review it before opening a pull request, then require the configured checks before accepting the repair.', label: '03 / THE REVIEW' },
];

function WorkflowEvidence({ index }: { index: number }) {
  return <div className="workflow-evidence">
    <div className="workflow-evidence-top"><span className="mono">{WORKFLOW[index].label}</span><Code2 size={18} /></div>
    {index === 0 && <><div className="evidence-large-symbol"><Activity size={56} strokeWidth={1} /></div><h3>Make the promise<br />executable.</h3><div className="workflow-code"><span className="code-comment">// No failed provisioning outcomes</span><code>event.type !==<br /><span className="lime-text">'provisioning.failed'</span></code></div><div className="evidence-footnote"><span>Input</span><span>Reported business outcomes</span></div></>}
    {index === 1 && <><div className="evidence-large-symbol orange-text"><ScanLine size={56} strokeWidth={1} /></div><h3>A failure with<br />a paper trail.</h3><dl className="workflow-failure"><div><dt>Transport</dt><dd className="lime-text">200 OK</dd></div><div><dt>Business outcome</dt><dd className="orange-text">Failed</dd></div><div><dt>Evidence</dt><dd>Reported event + evaluation</dd></div></dl><div className="evidence-footnote"><span>Next</span><span>Inspect incident diagnosis</span></div></>}
    {index === 2 && <><div className="evidence-large-symbol"><GitPullRequest size={56} strokeWidth={1} /></div><h3>Understand the fix<br />before it ships.</h3><div className="patch-example"><span className="mono muted-text">REPAIR WORKFLOW</span><span><Check size={16} />Reviewed target mapping</span><span><Check size={16} />Exact source preview</span><span><ShieldCheck size={16} />Required verification checks</span></div><div className="evidence-footnote"><span>Decision</span><span>Human review required</span></div></>}
    <span className="workflow-example-label mono">ILLUSTRATIVE EVIDENCE</span>
  </div>;
}

function Workflow() {
  const [activeIndex, setActiveIndex] = useState(0);
  const rowsRef = useRef<Array<HTMLElement | null>>([]);
  const reduced = useReducedMotion();
  useEffect(() => {
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) setActiveIndex(Number((entry.target as HTMLElement).dataset.workflowIndex));
      });
    }, { rootMargin: '-30% 0px -40% 0px', threshold: 0 });
    rowsRef.current.forEach(row => row && observer.observe(row));
    return () => observer.disconnect();
  }, []);

  return <section id="how-it-works" className="workflow-section section-pad shell" aria-labelledby="workflow-title">
    <Reveal><Eyebrow number="02">THE ASSURANCE LOOP</Eyebrow><div className="section-heading"><h2 id="workflow-title">From something’s wrong<br />to here’s the evidence.</h2></div></Reveal>
    <div className="workflow-grid"><div className="workflow-rows">{WORKFLOW.map((item, index) => <article key={item.title} data-workflow-index={index} ref={node => { rowsRef.current[index] = node; }} className={`workflow-row ${index === activeIndex ? 'is-active' : ''}`}><div className="workflow-row-title"><span className="mono">0{index + 1}</span><h3>{item.title}</h3></div><p>{item.description}</p><div className="mobile-evidence"><WorkflowEvidence index={index} /></div></article>)}</div><div className="workflow-sticky" aria-hidden="true"><AnimatePresence mode="wait" initial={false}><motion.div key={activeIndex} initial={{ opacity: reduced ? 1 : 0 }} animate={{ opacity: 1 }} exit={{ opacity: reduced ? 1 : 0 }} transition={{ duration: reduced ? 0 : 0.16 }}><WorkflowEvidence index={activeIndex} /></motion.div></AnimatePresence></div></div>
  </section>;
}

function HighlightedCode({ code }: { code: string }) {
  return <>{code.split('\n').map((line, index) => <span key={index} className="code-line"><span className="line-number" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span><span>{line.split(/('[^']*')/g).map((part, partIndex) => <span className={part.startsWith("'") ? 'code-string' : undefined} key={partIndex}>{part}</span>) || ' '}</span></span>)}</>;
}

function Developers() {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const resetTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(resetTimer.current), []);
  const copy = async () => {
    clearTimeout(resetTimer.current);
    try { await navigator.clipboard.writeText(SDK_EXAMPLE); setCopyState('copied'); }
    catch { setCopyState('failed'); }
    resetTimer.current = setTimeout(() => setCopyState('idle'), 5000);
  };
  return <section id="developers" className="developers-section section-pad" aria-labelledby="developers-title"><div className="shell">
    <Reveal><Eyebrow number="03" light>BUILT AROUND YOUR BUSINESS LOGIC</Eyebrow></Reveal>
    <div className="developers-grid"><div className="developers-copy"><Reveal><h2 id="developers-title">Make success<br />explicit<span>.</span></h2><p>Your application knows whether the work succeeded. Give SHAPI that signal.</p><p>Wrap your server-side handler with the SDK, report the result, and evaluate it with a behavioral invariant.</p><a className="button button-dark" href={DOCS}>Read the integration guide</a></Reveal><div className="developer-note"><ShieldCheck size={20} /><p>API credentials stay on your server.<br />The demo on this page uses local examples.</p></div></div>
      <Reveal className="sdk-panel"><div className="sdk-toolbar"><span><Terminal size={16} />webhook-handler.ts</span><button onClick={() => void copy()} aria-label="Copy SDK example">{copyState === 'copied' ? <CheckCheck size={16} /> : <Copy size={16} />}{copyState === 'copied' ? 'Copied' : 'Copy'}</button></div><pre tabIndex={0} aria-label="Server-side SDK example"><code><HighlightedCode code={SDK_EXAMPLE} /></code></pre><div className="sdk-footnote"><span className="mono">SERVER-SIDE TYPESCRIPT</span><span>Use your own provisioning function.</span></div><p className="copy-feedback" role="status">{copyState === 'failed' ? 'Could not copy. Select the code above to copy it manually.' : copyState === 'copied' ? 'Example copied to clipboard.' : ''}</p></Reveal>
    </div>
    <div className="invariant-strip"><span className="mono">THE INVARIANT</span><code>event.type !== <span>'provisioning.failed'</span></code><p>A failed outcome becomes a failed sample in the configured evaluation window.</p></div>
  </div></section>;
}

const FAQ = [
  { question: 'How does SHAPI know the outcome?', answer: 'Your application reports its business result through the SDK or ingestion API. SHAPI evaluates those reported events against configured predicates over time windows. It needs instrumentation: a completely unreported outcome is not automatically detected by the demonstrated rule.' },
  { question: 'Does this replace webhook delivery infrastructure?', answer: 'SHAPI operates alongside your delivery infrastructure. Your provider or gateway delivers the event; SHAPI evaluates reported business outcomes, detects rule violations and drift, and helps you investigate the incident.' },
  { question: 'Do repairs merge automatically?', answer: 'No. Operators inspect the exact patch before opening a pull request. The configured verification checks and human review remain part of the workflow. Passing CI is not, by itself, proof that a business outcome recovered in production.' },
  { question: 'Which repairs are supported today?', answer: 'Structured patches are available for supported, explicitly mapped targets. The repository includes reviewed demo adapters for payment provisioning and subscription activation, plus mapped predicate repairs. Other targets may require manual review and their own reviewed adapter and verification command.' },
];

function Faq() {
  return <section className="faq-section section-pad shell" aria-labelledby="faq-title"><Reveal className="faq-intro"><Eyebrow number="04">A FEW THINGS TO KNOW</Eyebrow><h2 id="faq-title">Good questions.<br /><span className="muted-text">Clear answers.</span></h2></Reveal><div className="faq-list">{FAQ.map((item, index) => <details key={item.question}><summary><span className="faq-number mono">0{index + 1}</span><span>{item.question}</span><span className="faq-toggle" aria-hidden="true">+</span></summary><p>{item.answer}</p></details>)}</div></section>;
}

function Closing() {
  return <><section className="closing-section" aria-labelledby="closing-title"><div className="shell closing-inner"><div className="closing-rule" aria-hidden="true"><span /><Mark /><span /></div><Reveal><p className="mono">FOLLOW THROUGH.</p><h2 id="closing-title">Trace the<br /><span>outcome.</span></h2><div className="closing-actions"><a className="button button-lime" href="#demo"><Play size={16} fill="currentColor" />Explore the demo</a><a className="text-link" href="/">Open dashboard<span className="link-line" /></a></div></Reveal><span className="closing-index mono" aria-hidden="true">END OF TRACE / START OF ASSURANCE</span></div></section><footer className="site-footer shell"><a className="wordmark" href="#top" aria-label="SHAPI home"><Mark /><span>SHAPI.</span></a><p>Prove the outcome.</p><nav aria-label="Footer navigation"><a href={DOCS}>Documentation</a><a href={REPOSITORY}>GitHub</a><a href="/">Dashboard</a></nav><span className="mono footer-year">© {new Date().getFullYear()} SHAPI</span></footer></>;
}

export function LandingPage() {
  return <div className="landing-page" id="top"><a className="skip-link" href="#main">Skip to content</a><Navigation /><main id="main"><Hero /><InteractiveDemo /><Workflow /><Developers /><Faq /><Closing /></main></div>;
}

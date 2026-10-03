import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Presentation, PresentationFile } from "@oai/artifact-tool";

const workspaceDir = process.env.WORKSPACE_DIR;
const tmpDir = process.env.TMP_DIR;
const skillDir = process.env.SKILL_DIR;
const finalPptx = process.env.FINAL_PPTX;
const nodeModules = process.env.RUNTIME_NODE_MODULES;
if (![workspaceDir, tmpDir, skillDir, finalPptx, nodeModules].every((p) => p && path.isAbsolute(p))) {
  throw new Error("Missing absolute runtime paths");
}

const { resolvePresentationFont } = await import(
  pathToFileURL(path.join(skillDir, "container_tools/artifact_tool_utils.mjs")).href,
);

await fs.mkdir(tmpDir, { recursive: true });
await fs.mkdir(path.dirname(finalPptx), { recursive: true });
const family = resolvePresentationFont();

const W = 1280;
const H = 720;
const C = {
  navy: "#0B1220",
  ink: "#F5F7FB",
  muted: "#AAB7C7",
  panel: "#142238",
  panel2: "#1A2C45",
  coral: "#FF6B5E",
  lime: "#B9F35A",
  cyan: "#58D7E3",
  red: "#F45A66",
  white: "#FFFFFF",
  black: "#080D16",
};

function rect(slide, x, y, width, height, fill, geometry = "rect") {
  return slide.shapes.add({
    geometry,
    position: { left: x, top: y, width, height },
    fill,
    line: { fill: "none", width: 0 },
  });
}

function line(slide, x, y, width, height, fill) {
  return rect(slide, x, y, width, height, fill);
}

function txt(slide, value, x, y, width, height, {
  size = 24,
  color = C.ink,
  bold = false,
  align = "left",
  italic = false,
  typeface = family,
} = {}) {
  const shape = slide.shapes.add({
    geometry: "textbox",
    position: { left: x, top: y, width, height },
    fill: "none",
    line: { fill: "none", width: 0 },
  });
  shape.text = value;
  shape.text.style = {
    typeface,
    fontSize: size,
    color,
    bold,
    italic,
    alignment: align,
    autoFit: "none",
  };
  return shape;
}

function footer(slide, n) {
  txt(slide, "SHAPI  /  AI CONFERENCE HACK DAY '26", 72, 682, 500, 20, {
    size: 14,
    color: C.muted,
    bold: true,
  });
  txt(slide, String(n).padStart(2, "0"), 1160, 682, 48, 20, {
    size: 14,
    color: C.muted,
    bold: true,
    align: "right",
  });
}

function heading(slide, kicker, title, subtitle = "") {
  txt(slide, kicker.toUpperCase(), 72, 48, 420, 24, { size: 16, color: C.cyan, bold: true });
  txt(slide, title, 72, 82, 1136, 70, { size: 42, color: C.ink, bold: true });
  if (subtitle) txt(slide, subtitle, 72, 156, 1040, 42, { size: 21, color: C.muted });
}

function notes(slide, value) {
  slide.speakerNotes.textFrame.setText(value);
}

const presentation = Presentation.create({ slideSize: { width: W, height: H } });

// 1. Cover
{
  const s = presentation.slides.add();
  const light = { navy: "#17233F", blue: "#5FAAF1", pale: "#DCEEFF", pale2: "#F5FAFF", line: "#A9D9FF", gray: "#52627E" };
  s.background.fill = "linear(135deg, #FFFFFF 0%, #F8FCFF 52%, #DCEEFF 100%)";
  rect(s, 0, 0, W, 8, light.blue);
  const glow = (x, y, width, height, color) => s.shapes.add({
    geometry: "ellipse",
    position: { left: x, top: y, width, height },
    fill: `radial(${color}/78 0%, ${color}/0 100%)`,
    line: { fill: "none", width: 0 },
  });
  glow(0, 80, 360, 360, "#CBE8FF");
  glow(980, 0, 300, 300, "#CBE8FF");
  glow(1020, 510, 260, 210, "#D9EEFF");
  s.shapes.add({ geometry: "ellipse", position: { left: 0, top: 150, width: 330, height: 330 }, fill: "none", line: { fill: "#FFFFFF/85", width: 1 } });
  s.shapes.add({ geometry: "ellipse", position: { left: 1000, top: 0, width: 280, height: 280 }, fill: "none", line: { fill: "#FFFFFF/85", width: 1 } });
  txt(s, "SHAPI", 86, 50, 260, 34, { size: 22, color: light.blue, bold: true });
  txt(s, "Self-healing APIs for\nbusiness-critical integrations", 150, 104, 700, 72, { size: 27, color: light.navy, bold: true, align: "center" });
  txt(s, "SHAPI", 438, 184, 404, 84, { size: 72, color: light.navy, bold: true, align: "center" });
  line(s, 438, 278, 404, 5, light.blue);

  const profile = s.shapes.add({
    geometry: "roundRect",
    position: { left: 906, top: 42, width: 300, height: 160 },
    fill: "#FFFFFF",
    line: { fill: light.line, width: 2 },
  });
  txt(s, "BUILT BY", 932, 62, 120, 20, { size: 14, color: light.blue, bold: true });
  txt(s, "Tulasi Venkata\nSri Varshini Padamata", 932, 88, 246, 48, { size: 17, color: light.navy, bold: true });
  txt(s, "AI Conference Hack Day '26", 932, 146, 246, 22, { size: 15, color: light.gray });
  line(s, 932, 176, 244, 1, light.pale);
  txt(s, "GitHub  @SriVarshini09   ·   LinkedIn  /in/ptvsv", 932, 182, 244, 14, { size: 10, color: light.blue, bold: true });

  const hook = s.shapes.add({
    geometry: "roundRect",
    position: { left: 216, top: 362, width: 848, height: 102 },
    fill: "#FFFFFF",
    line: { fill: light.line, width: 2 },
  });
  txt(s, "A", 266, 393, 50, 44, { size: 38, color: light.navy, bold: true, align: "center" });
  const ok = s.shapes.add({
    geometry: "roundRect",
    position: { left: 326, top: 382, width: 198, height: 62 },
    fill: light.pale,
    line: { fill: light.line, width: 1 },
  });
  txt(s, "200 OK", 344, 395, 162, 34, { size: 30, color: light.blue, bold: true, align: "center" });
  txt(s, "can still fail the customer", 554, 394, 454, 38, { size: 30, color: light.navy, bold: true });

  txt(s, "API reports success", 194, 536, 220, 28, { size: 18, color: light.gray, align: "center" });
  txt(s, "→", 426, 532, 46, 32, { size: 26, color: light.blue, bold: true, align: "center" });
  txt(s, "SHAPI verifies the outcome", 474, 536, 260, 28, { size: 18, color: light.gray, align: "center" });
  txt(s, "→", 744, 532, 46, 32, { size: 26, color: light.blue, bold: true, align: "center" });
  txt(s, "silent failure detected", 796, 536, 220, 28, { size: 18, color: light.gray, align: "center" });
  txt(s, "→ recovery", 1020, 536, 130, 28, { size: 18, color: light.blue, bold: true, align: "center" });
  txt(s, "Self-healing APIs, beyond 200 OK.", 874, 638, 320, 24, { size: 16, color: light.blue, bold: true, align: "right" });
  txt(s, "01", 1160, 682, 48, 20, { size: 14, color: light.gray, bold: true, align: "right" });
  notes(s, "Open with the thesis: a provider can report a successful delivery while the customer still does not receive access. SHAPI monitors the business outcome behind the webhook. Introduce yourself briefly as the builder.");
}

// 2. Problem
{
  const s = presentation.slides.add();
  s.background.fill = C.navy;
  heading(s, "The problem", "The gap between delivery and outcome", "Most webhook tooling stops at the HTTP response.");
  rect(s, 72, 250, 432, 240, C.panel, "roundRect");
  txt(s, "Third-party event", 104, 284, 330, 26, { size: 17, color: C.muted, bold: true });
  txt(s, "invoice.payment_succeeded", 104, 326, 370, 42, { size: 22, color: C.ink, bold: true, typeface: family });
  txt(s, "Stripe says the event arrived", 104, 400, 320, 30, { size: 19, color: C.lime });
  rect(s, 576, 306, 130, 102, C.lime, "roundRect");
  txt(s, "200\nOK", 592, 321, 98, 72, { size: 30, color: C.black, bold: true, align: "center" });
  line(s, 508, 356, 68, 4, C.lime);
  rect(s, 778, 250, 430, 240, C.panel, "roundRect");
  txt(s, "Customer outcome", 810, 284, 330, 26, { size: 17, color: C.muted, bold: true });
  txt(s, "provisioning.completed", 810, 326, 350, 42, { size: 27, color: C.ink, bold: true, typeface: family });
  txt(s, "But the user never gets access", 810, 400, 340, 30, { size: 19, color: C.red });
  line(s, 706, 356, 72, 4, C.red);
  txt(s, "The failure is silent because the transport layer looks healthy.", 72, 548, 1050, 38, { size: 27, color: C.ink, bold: true });
  txt(s, "For SaaS teams, that means paid customers without access.", 72, 594, 900, 28, { size: 19, color: C.muted });
  footer(s, 2);
  notes(s, "Explain the hidden failure mode. The payment event is delivered and acknowledged, but the downstream provisioning step silently fails. The provider dashboard remains green.");
}

// 3. Invariant
{
  const s = presentation.slides.add();
  s.background.fill = C.navy;
  heading(s, "The core abstraction", "A behavioral invariant", "SHAPI turns the business promise into an executable assertion.");
  rect(s, 72, 242, 1136, 126, C.panel2, "roundRect");
  txt(s, "payment_succeeded  →  provisioning.completed within 5 min", 112, 279, 1056, 56, { size: 34, color: C.lime, bold: true, align: "center", typeface: family });
  txt(s, "The platform evaluates real event streams over time, then records the evidence when the promise breaks.", 72, 408, 1080, 34, { size: 21, color: C.muted });
  const xs = [72, 442, 812];
  const labels = [
    ["01", "Observe", "Capture webhook and SDK events"],
    ["02", "Evaluate", "Check the expected outcome"],
    ["03", "Explain", "Create evidence for an incident copilot"],
  ];
  for (let i = 0; i < labels.length; i++) {
    rect(s, xs[i], 504, 300, 112, C.panel, "roundRect");
    txt(s, labels[i][0], xs[i] + 24, 522, 52, 28, { size: 18, color: C.coral, bold: true });
    txt(s, labels[i][1], xs[i] + 88, 520, 180, 28, { size: 24, color: C.ink, bold: true });
    txt(s, labels[i][2], xs[i] + 24, 562, 250, 36, { size: 16, color: C.muted });
    if (i < 2) line(s, xs[i] + 300, 558, 70, 3, C.cyan);
  }
  footer(s, 3);
  notes(s, "This is the product primitive. Instead of asking only whether the webhook arrived, SHAPI asserts that the expected business outcome happened within a time window.");
}

// 4. Demo flow
{
  const s = presentation.slides.add();
  s.background.fill = C.navy;
  heading(s, "The live demo", "The failure appears in 90 seconds", "Use the existing Demo SaaS and dashboard to make the contrast visible.");
  const steps = [
    ["1", "Baseline", "Show healthy monitoring", C.cyan],
    ["2", "Trigger", "simulate:failure", C.coral],
    ["3", "Detect", "200 OK + violated invariant", C.red],
    ["4", "Explain", "Diagnose + suggest repairs", C.lime],
  ];
  const x0 = 84;
  for (let i = 0; i < steps.length; i++) {
    const x = x0 + i * 282;
    rect(s, x, 278, 54, 54, steps[i][3], "ellipse");
    txt(s, steps[i][0], x, 290, 54, 28, { size: 22, color: C.black, bold: true, align: "center" });
    txt(s, steps[i][1], x - 4, 360, 180, 28, { size: 24, color: C.ink, bold: true });
    txt(s, steps[i][2], x - 4, 402, 222, 56, { size: 18, color: C.muted, typeface: family });
    if (i < 3) line(s, x + 54, 304, 228, 3, C.panel2);
  }
  rect(s, 72, 548, 1136, 66, C.panel2, "roundRect");
  txt(s, "pnpm --filter @shapi/demo-saas simulate:failure", 100, 567, 1080, 30, { size: 23, color: C.lime, bold: true, typeface: family });
  footer(s, 4);
  notes(s, "Demo sequence: start on the dashboard, show a healthy baseline, run the failure simulation, refresh, open the new incident, and click Diagnose + suggest repairs. Keep the drift simulation as an optional appendix if time allows.");
}

// 5. AI evidence
{
  const s = presentation.slides.add();
  s.background.fill = C.navy;
  heading(s, "The AI payoff", "Better evidence makes better incident reasoning", "SHAPI gives an AI incident workflow the business context that logs alone miss.");
  rect(s, 72, 244, 540, 330, C.panel, "roundRect");
  txt(s, "Observed event chain", 104, 274, 360, 28, { size: 20, color: C.cyan, bold: true });
  txt(s, "invoice.payment_succeeded", 104, 334, 420, 28, { size: 21, color: C.ink, bold: true, typeface: family });
  line(s, 128, 375, 3, 42, C.cyan);
  txt(s, "provisioning.failed", 104, 430, 420, 28, { size: 21, color: C.red, bold: true, typeface: family });
  txt(s, "correlationId: cus_demo_…", 104, 488, 420, 26, { size: 18, color: C.muted, typeface: family });
  txt(s, "Invariant: VIOLATED", 104, 532, 420, 28, { size: 19, color: C.red, bold: true });
  rect(s, 684, 244, 524, 330, C.panel2, "roundRect");
  txt(s, "Incident context", 716, 274, 360, 28, { size: 20, color: C.lime, bold: true });
  txt(s, "Root cause", 716, 334, 170, 22, { size: 16, color: C.muted, bold: true });
  txt(s, "Provisioning was skipped after payment success.", 716, 360, 420, 52, { size: 23, color: C.ink, bold: true });
  txt(s, "Suggested repair", 716, 442, 190, 22, { size: 16, color: C.muted, bold: true });
  txt(s, "Restore provisioning, then replay the event.", 716, 468, 430, 58, { size: 20, color: C.ink });
  txt(s, "TRIAGED  ·  evidence attached", 716, 536, 420, 24, { size: 17, color: C.cyan, bold: true });
  footer(s, 5);
  notes(s, "Frame the AI angle carefully. SHAPI creates the structured evidence an AI incident assistant needs: event chain, invariant result, correlation, root cause, and suggested repair. The live product already generates this context through its diagnosis workflow.");
}

// 6. Close
{
  const s = presentation.slides.add();
  s.background.fill = C.navy;
  rect(s, 72, 72, 10, 560, C.coral);
  txt(s, "SHAPI", 128, 92, 300, 28, { size: 20, color: C.cyan, bold: true });
  txt(s, "Monitor what\nintegrations accomplish", 128, 180, 760, 132, { size: 54, color: C.ink, bold: true });
  txt(s, "A payment succeeds. Access follows. SHAPI proves the link.", 132, 356, 820, 42, { size: 27, color: C.lime, bold: true });
  txt(s, "Live proof: dashboard + Demo SaaS + one silent failure", 132, 486, 700, 30, { size: 20, color: C.muted });
  rect(s, 944, 182, 230, 230, C.panel2, "ellipse");
  txt(s, "200", 982, 222, 154, 60, { size: 48, color: C.lime, bold: true, align: "center" });
  txt(s, "≠", 982, 292, 154, 54, { size: 44, color: C.coral, bold: true, align: "center" });
  txt(s, "success", 982, 350, 154, 34, { size: 28, color: C.red, bold: true, align: "center" });
  footer(s, 6);
  notes(s, "Close on the memorable distinction: delivery success is not business success. SHAPI detects the missing link and turns it into actionable incident context.");
}

const candidatePath = path.join(tmpDir, "shapi-hack-day-draft.pptx");
await (await PresentationFile.exportPptx(presentation)).save(candidatePath);
for (const [idx, slide] of presentation.slides.items.entries()) {
  const preview = await presentation.export({ slide, format: "png", scale: 1 });
  await fs.writeFile(path.join(tmpDir, `slide-${idx + 1}.png`), new Uint8Array(await preview.arrayBuffer()));
}
const { finalizePresentation } = await import(
  pathToFileURL(path.join(skillDir, "container_tools/artifact_tool_utils.mjs")).href,
);
const stagingDir = path.join(workspaceDir, ".codex-finalizer");
await fs.mkdir(stagingDir, { recursive: true });
const result = await finalizePresentation({
  workspaceDir,
  candidatePath,
  finalPath: finalPptx,
  pythonExecutable: process.env.RUNTIME_PYTHON,
  integrityValidatorPath: path.join(skillDir, "container_tools/inspect_presentation_package_integrity.py"),
  layoutValidatorPath: path.join(skillDir, "container_tools/inspect_presentation_layout_geometry.py"),
  layoutArgs: ["--expected-slide-size-emu", "12192000,6858000", "--validate-heading-fit"],
  requiredNativeTableOwnerSlides: [],
  fontPolicy: { basis: "design", families: [family] },
  verifyArtifactToolImport: true,
  receiptPath: path.join(stagingDir, `${path.basename(finalPptx)}.validation.json`),
});
console.log(JSON.stringify({ candidatePath, finalPptx, family, result }, null, 2));

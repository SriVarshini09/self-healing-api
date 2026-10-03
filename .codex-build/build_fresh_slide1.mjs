import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Presentation, PresentationFile } from "@oai/artifact-tool";

const workspaceDir = process.env.WORKSPACE_DIR;
const tmpDir = process.env.TMP_DIR;
const skillDir = process.env.SKILL_DIR;
const finalPptx = process.env.FINAL_PPTX;
if (![workspaceDir, tmpDir, skillDir, finalPptx].every((p) => p && path.isAbsolute(p))) throw new Error("Missing runtime paths");

const { resolvePresentationFont, finalizePresentation } = await import(
  pathToFileURL(path.join(skillDir, "container_tools/artifact_tool_utils.mjs")).href,
);
await fs.mkdir(tmpDir, { recursive: true });
await fs.mkdir(path.dirname(finalPptx), { recursive: true });

const font = resolvePresentationFont();
const W = 1280;
const H = 720;
const colors = {
  canvas: "#FFFFFF",
  navy: "#10233F",
  blue: "#2F80ED",
  sky: "#70C8F4",
  pale: "#F1F8FF",
  slate: "#60708A",
  red: "#E96B72",
  green: "#20B981",
  white: "#FFFFFF",
  border: "#B9DFFF",
};

function shape(slide, geometry, x, y, width, height, fill, lineFill = "none", lineWidth = 0) {
  return slide.shapes.add({
    geometry,
    position: { left: x, top: y, width, height },
    fill,
    line: { fill: lineFill, width: lineWidth },
  });
}

function text(slide, value, x, y, width, height, opts = {}) {
  const node = slide.shapes.add({
    geometry: "textbox",
    position: { left: x, top: y, width, height },
    fill: "none",
    line: { fill: "none", width: 0 },
  });
  node.text = value;
  node.text.style = {
    typeface: font,
    fontSize: opts.size ?? 24,
    color: opts.color ?? colors.navy,
    bold: opts.bold ?? false,
    alignment: opts.align ?? "left",
    autoFit: "none",
  };
  return node;
}

const deck = Presentation.create({ slideSize: { width: W, height: H } });
const slide = deck.slides.add();
slide.background.fill = colors.canvas;

// Restrained blue framing
shape(slide, "rect", 0, 0, W, 10, colors.blue);
shape(slide, "rect", 0, 10, 10, H - 10, colors.pale);
shape(slide, "ellipse", 1050, 0, 230, 230, "radial(#D8EEFF/55 0%, #D8EEFF/0 100%)");
shape(slide, "ellipse", 0, 575, 145, 145, "radial(#D8EEFF/45 0%, #D8EEFF/0 100%)");

text(slide, "SHAPI", 74, 52, 200, 30, { size: 22, color: colors.blue, bold: true });
text(slide, "AI CONFERENCE HACK DAY '26", 930, 56, 255, 22, { size: 14, color: colors.slate, bold: true, align: "right" });

text(slide, "A 200 OK can still\nfail the customer", 74, 172, 630, 142, { size: 54, color: colors.navy, bold: true });
text(slide, "Self-healing API reliability for business-critical integrations", 78, 346, 560, 68, { size: 24, color: colors.slate });

// One visual idea: transport success beside business failure
shape(slide, "roundRect", 770, 166, 366, 340, colors.white, colors.border, 2);
text(slide, "TRANSPORT", 810, 204, 280, 22, { size: 15, color: colors.slate, bold: true, align: "center" });
shape(slide, "roundRect", 826, 244, 254, 66, colors.pale, colors.border, 1);
text(slide, "200 OK", 844, 261, 218, 34, { size: 31, color: colors.blue, bold: true, align: "center" });
shape(slide, "rect", 947, 326, 8, 36, colors.sky);
text(slide, "BUSINESS OUTCOME", 810, 376, 280, 22, { size: 15, color: colors.slate, bold: true, align: "center" });
shape(slide, "roundRect", 826, 414, 254, 66, "#FFF1F2", "#F4B5B9", 1);
text(slide, "no access", 844, 431, 218, 34, { size: 29, color: colors.red, bold: true, align: "center" });

shape(slide, "roundRect", 74, 566, 612, 78, colors.white, colors.border, 1);
text(slide, "Built by", 100, 586, 70, 22, { size: 14, color: colors.slate, bold: true });
text(slide, "Tulasi Venkata Sri Varshini Padamata", 178, 582, 420, 26, { size: 19, color: colors.navy, bold: true });
text(slide, "GitHub @SriVarshini09  ·  LinkedIn /in/ptvsv", 178, 611, 420, 18, { size: 13, color: colors.blue });
text(slide, "SHAPI verifies the outcome behind the webhook.", 774, 586, 394, 48, { size: 18, color: colors.blue, bold: true, align: "right" });
text(slide, "01", 1168, 682, 38, 18, { size: 13, color: colors.slate, bold: true, align: "right" });

slide.speakerNotes.textFrame.setText("Opening: A payment webhook can return 200 OK while the customer still does not receive access. SHAPI adds a behavioral assurance layer that verifies the business outcome. Introduce yourself briefly as the builder.");

// Slide 2: the problem, kept in the same light system
{
  const s = deck.slides.add();
  s.background.fill = colors.canvas;
  shape(s, "rect", 0, 0, W, 10, colors.blue);
  shape(s, "rect", 0, 10, 10, H - 10, colors.pale);
  shape(s, "ellipse", 1040, 0, 230, 230, "radial(#D8EEFF/45 0%, #D8EEFF/0 100%)");
  text(s, "SHAPI", 74, 52, 200, 30, { size: 22, color: colors.blue, bold: true });
  text(s, "02  /  THE PROBLEM", 930, 56, 255, 22, { size: 14, color: colors.slate, bold: true, align: "right" });
  text(s, "Transport success is not\ncustomer success", 74, 116, 720, 108, { size: 46, color: colors.navy, bold: true });
  text(s, "A webhook can arrive, return 200 OK, and still leave the customer without access.", 78, 250, 760, 60, { size: 22, color: colors.slate });

  // Editable flow diagram
  shape(s, "roundRect", 74, 364, 290, 156, colors.white, colors.border, 2);
  text(s, "1", 100, 388, 34, 34, { size: 22, color: colors.blue, bold: true });
  text(s, "Payment event", 150, 386, 170, 28, { size: 22, color: colors.navy, bold: true });
  text(s, "invoice.payment_succeeded", 100, 438, 244, 24, { size: 15, color: colors.slate });
  text(s, "Provider reports success", 100, 474, 228, 24, { size: 16, color: colors.green, bold: true });

  shape(s, "roundRect", 482, 364, 290, 156, colors.pale, colors.border, 2);
  text(s, "2", 508, 388, 34, 34, { size: 22, color: colors.blue, bold: true });
  text(s, "Transport response", 558, 386, 190, 28, { size: 22, color: colors.navy, bold: true });
  text(s, "200 OK", 534, 438, 186, 36, { size: 30, color: colors.blue, bold: true, align: "center" });
  text(s, "Webhook acknowledged", 534, 478, 186, 22, { size: 16, color: colors.slate, align: "center" });

  shape(s, "roundRect", 890, 364, 290, 156, "#FFF2F3", "#F2B5BA", 2);
  text(s, "3", 916, 388, 34, 34, { size: 22, color: colors.red, bold: true });
  text(s, "Business outcome", 966, 386, 190, 28, { size: 22, color: colors.navy, bold: true });
  text(s, "no access", 930, 438, 210, 36, { size: 30, color: colors.red, bold: true, align: "center" });
  text(s, "Provisioning silently skipped", 918, 478, 234, 22, { size: 16, color: colors.red, align: "center" });

  shape(s, "rect", 364, 438, 118, 4, colors.sky);
  shape(s, "rect", 772, 438, 118, 4, colors.red);
  text(s, "The failure lives after the HTTP response.", 74, 596, 760, 30, { size: 25, color: colors.navy, bold: true });
  text(s, "For SaaS teams, that means paid customers without access.", 74, 634, 660, 24, { size: 18, color: colors.slate });
  text(s, "SHAPI", 1030, 614, 150, 24, { size: 18, color: colors.blue, bold: true, align: "right" });
  text(s, "02", 1168, 682, 38, 18, { size: 13, color: colors.slate, bold: true, align: "right" });
  s.speakerNotes.textFrame.setText("The problem slide: delivery tooling can prove that a webhook arrived and was acknowledged. It cannot prove that the customer received the intended business outcome. That gap creates lost revenue and support work for SaaS teams.");
}

const candidatePath = path.join(tmpDir, "fresh-slide1-draft.pptx");
await (await PresentationFile.exportPptx(deck)).save(candidatePath);
const preview = await deck.export({ slide, format: "png", scale: 1 });
await fs.writeFile(path.join(tmpDir, "fresh-slide1.png"), new Uint8Array(await preview.arrayBuffer()));
const preview2 = await deck.export({ slide: deck.slides.items[1], format: "png", scale: 1 });
await fs.writeFile(path.join(tmpDir, "fresh-slide2.png"), new Uint8Array(await preview2.arrayBuffer()));

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
  fontPolicy: { basis: "design", families: [font] },
  verifyArtifactToolImport: true,
  receiptPath: path.join(stagingDir, `${path.basename(finalPptx)}.validation.json`),
});
console.log(JSON.stringify({ finalPptx, font, result }, null, 2));

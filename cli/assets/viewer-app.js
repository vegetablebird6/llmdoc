import { createDetailRenderer } from "./viewer-detail.js";
import { createGraphController } from "./viewer-graph.js";
import { colorOf, createTopicColors, documentName, matchesSearch, STATUS_COLOR } from "./viewer-model.js";

const elements = {
  repo: document.getElementById("repo"),
  statDocs: document.getElementById("stat-docs"),
  statBaseline: document.getElementById("stat-baseline"),
  statValidate: document.getElementById("stat-validate"),
  statDelta: document.getElementById("stat-delta"),
  refresh: document.getElementById("refresh"),
  modeTopics: document.getElementById("mode-topics"),
  modeDocs: document.getElementById("mode-docs"),
  search: document.getElementById("search"),
  documentList: document.getElementById("doc-list"),
  graphWrap: document.getElementById("graph-wrap"),
  graph: document.getElementById("graph"),
  graphHint: document.getElementById("graph-hint"),
  legend: document.getElementById("legend"),
  graphEmpty: document.getElementById("graph-empty"),
  detail: document.getElementById("detail"),
  detailContainer: document.querySelector("#detail .inner"),
  detailClose: document.getElementById("detail-close"),
  error: document.getElementById("load-error"),
  zoomIn: document.getElementById("zoom-in"),
  zoomOut: document.getElementById("zoom-out"),
  zoomReset: document.getElementById("zoom-reset")
};

let state = null;
let selectedDocument = null;
let selectedTopic = null;
let mode = "topics";
let topicColors = new Map();
let resizeTimer = null;

const graph = createGraphController({
  svg: elements.graph,
  hint: elements.graphHint,
  legend: elements.legend,
  empty: elements.graphEmpty,
  onSelectTopic: selectTopic,
  onSelectDocument: selectDocument
});

const detail = createDetailRenderer({
  panel: elements.detail,
  container: elements.detailContainer,
  onSelectDocument: selectDocument,
  getState: () => state
});

async function loadState() {
  elements.refresh.disabled = true;
  elements.refresh.setAttribute("aria-busy", "true");
  hideError();
  try {
    const response = await fetch("/api/state", { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const nextState = await response.json();
    if (!Array.isArray(nextState.nodes) || !Array.isArray(nextState.edges)) throw new Error("The server returned invalid state");
    state = adaptState(nextState);
    topicColors = createTopicColors(state.nodes);
    if (selectedDocument && !state.nodes.some((node) => node.path === selectedDocument)) selectedDocument = null;
    if (selectedTopic && !state.nodes.some((node) => node.topic === selectedTopic)) selectedTopic = null;
    renderHeader();
    renderSidebar();
    renderGraph();
    if (selectedDocument) await detail.showDocument(selectedDocument, state);
    else if (selectedTopic) detail.showTopic(selectedTopic, state, topicColors);
  } catch (error) {
    showError(error instanceof Error ? error.message : String(error));
  } finally {
    elements.refresh.disabled = false;
    elements.refresh.removeAttribute("aria-busy");
  }
}

function adaptState(nextState) {
  const nodes = (nextState.nodes ?? []).map((node) => ({
    ...node,
    path: node.id,
    codePaths: node.sourcePaths ?? []
  }));
  const issues = nextState.issues ?? [];
  const errors = issues.filter((issue) => issue.severity === "error").length;
  const warnings = issues.filter((issue) => issue.severity === "warning").length;
  return {
    ...nextState,
    nodes,
    edges: nextState.edges ?? [],
    growth: { currentTotalEstimatedTokens: nodes.reduce((sum, node) => sum + (node.estimatedTokens ?? 0), 0) },
    validate: { ok: errors === 0, errors, warnings, issues }
  };
}

function renderHeader() {
  elements.repo.textContent = `/ ${state.repository ?? "knowledge"}`;
  elements.statDocs.textContent = `${state.nodes.length} docs · ~${state.growth.currentTotalEstimatedTokens} tokens`;

  const knowledgeRevision = state.knowledgeRevision?.slice(0, 7);
  const sourceRevision = state.sourceRevision?.slice(0, 7);
  if (state.mode === "diagnostic" || !state.repositoryId) {
    setChip(elements.statBaseline, state.diagnostic ? `diagnostic · ${state.diagnostic.code}` : "no binding", "bad");
  } else if (state.sourceBlockers?.length) {
    setChip(elements.statBaseline, `source blocked · ${state.sourceBlockers.map((blocker) => blocker.code).join(", ")}`, "warn");
  } else {
    setChip(
      elements.statBaseline,
      `K ${knowledgeRevision ?? "unborn"} · S ${sourceRevision ?? "invalid"}`,
      state.historyAvailable ? "ok" : "warn"
    );
  }

  const validation = state.validate;
  setChip(
    elements.statValidate,
    validation.ok ? `validate ok${validation.warnings ? ` · ${validation.warnings} warn` : ""}` : `validate ${validation.errors} errors`,
    validation.ok ? "ok" : "bad"
  );

  const pending = state.nodes.filter((node) => node.status !== "current").length;
  if (state.mode === "diagnostic") setChip(elements.statDelta, "diagnostic only", "warn");
  else if (pending) setChip(elements.statDelta, `${pending} document(s) need review`, "warn");
  else setChip(elements.statDelta, "knowledge is current", "ok");
}

function setChip(chip, text, stateClass) {
  chip.textContent = text;
  chip.className = `chip ${stateClass}`;
}

function renderSidebar() {
  if (!state) return;
  const query = elements.search.value;
  const matchingNodes = state.nodes.filter((node) => matchesSearch(node, query));
  const groups = new Map([["", matchingNodes.filter((node) => !node.topic)]]);
  for (const node of matchingNodes) {
    if (!node.topic) continue;
    const documents = groups.get(node.topic) ?? [];
    documents.push(node);
    groups.set(node.topic, documents);
  }

  const fragment = document.createDocumentFragment();
  for (const [topic, nodes] of groups) {
    if (!nodes.length) continue;
    const label = document.createElement(topic ? "button" : "div");
    label.className = "group-label";
    if (topic) {
      label.type = "button";
      const swatch = element("span", "swatch");
      swatch.style.backgroundColor = colorOf(topicColors, topic);
      label.append(swatch, `${topic}/`);
      label.addEventListener("click", () => selectTopic(topic));
    } else {
      label.textContent = "root";
    }
    fragment.append(label);

    for (const node of nodes) {
      const item = element("button", `doc-item${selectedDocument === node.path ? " active" : ""}`);
      item.type = "button";
      item.title = node.path;
      item.setAttribute("aria-current", selectedDocument === node.path ? "true" : "false");
      const dot = element("span", "dot");
      dot.style.backgroundColor = STATUS_COLOR[node.status];
      dot.style.color = STATUS_COLOR[node.status];
      item.append(dot, element("span", "name", documentName(node.path)), element("span", "kind", node.kind));
      item.addEventListener("click", () => selectDocument(node.path));
      fragment.append(item);
    }
  }
  if (!fragment.childNodes.length) fragment.append(element("div", "empty-list", "No matching documents"));
  elements.documentList.replaceChildren(fragment);
}

function renderGraph() {
  if (!state) return;
  graph.render(graphInput());
}

function graphInput() {
  return { state, mode, selected: selectedDocument, topicColors };
}

function setMode(nextMode, { render = true } = {}) {
  mode = nextMode;
  elements.modeTopics.className = mode === "topics" ? "on" : "";
  elements.modeDocs.className = mode === "docs" ? "on" : "";
  elements.modeTopics.setAttribute("aria-pressed", String(mode === "topics"));
  elements.modeDocs.setAttribute("aria-pressed", String(mode === "docs"));
  if (render && state) renderGraph();
}

function selectTopic(topic) {
  selectedTopic = topic;
  selectedDocument = null;
  renderSidebar();
  if (mode !== "topics") setMode("topics");
  graph.highlight(`topic:${topic}`);
  detail.showTopic(topic, state, topicColors);
}

async function selectDocument(path) {
  selectedDocument = path;
  selectedTopic = null;
  renderSidebar();
  if (mode !== "docs") setMode("docs");
  else graph.highlight(path);
  await detail.showDocument(path, state);
}

function showError(message) {
  elements.error.textContent = `Viewer load failed: ${message}`;
  elements.error.hidden = false;
}

function hideError() {
  elements.error.hidden = true;
  elements.error.textContent = "";
}

function element(tagName, className, text) {
  const node = document.createElement(tagName);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

elements.search.addEventListener("input", renderSidebar);
elements.refresh.addEventListener("click", loadState);
elements.modeTopics.addEventListener("click", () => setMode("topics"));
elements.modeDocs.addEventListener("click", () => setMode("docs"));
elements.zoomIn.addEventListener("click", () => graph.zoomBy(1.15));
elements.zoomOut.addEventListener("click", () => graph.zoomBy(.87));
elements.zoomReset.addEventListener("click", graph.resetView);
elements.detailClose.addEventListener("click", detail.closePanel);

window.addEventListener("keydown", (event) => {
  const target = event.target;
  const isEditing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable;
  if (event.key === "/" && !isEditing) {
    event.preventDefault();
    elements.search.focus();
  } else if (event.key === "Escape") {
    detail.closePanel();
    if (document.activeElement === elements.search) elements.search.blur();
  }
});

const resizeObserver = new ResizeObserver(() => {
  if (!state) return;
  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => graph.resize(graphInput()), 120);
});
resizeObserver.observe(elements.graphWrap);

setMode("topics", { render: false });
loadState();

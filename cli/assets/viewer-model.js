export const PALETTE = ["#4c5fd5", "#0e8f6f", "#c26a12", "#7a4bc9", "#0d84ab", "#b13d72", "#5f8016", "#96591f"];

export const STATUS_COLOR = {
  current: "#2f9e5b",
  unverified: "#aab2bd",
  needs_review: "#c9a227"
};

const STATUS_RANK = { current: 0, unverified: 1, needs_review: 2 };

export function createTopicColors(nodes) {
  const topics = [...new Set(nodes.map((node) => node.topic).filter(Boolean))].sort();
  return new Map(topics.map((topic, index) => [topic, PALETTE[index % PALETTE.length]]));
}

export function colorOf(topicColors, topic) {
  return topic ? topicColors.get(topic) ?? PALETTE[0] : "#3c4657";
}

export function worstStatus(nodes) {
  return nodes.reduce(
    (worst, node) => (STATUS_RANK[node.status] > STATUS_RANK[worst] ? node.status : worst),
    "current"
  );
}

export function documentName(path) {
  return path.split("/").pop()?.replace(/\.md$/, "") ?? path;
}

export function compactLabel(label, limit = 24) {
  return label.length > limit ? `${label.slice(0, limit - 1)}…` : label;
}

export function matchesSearch(node, rawQuery) {
  const query = rawQuery.trim().toLocaleLowerCase();
  if (!query) return true;
  return [node.path, node.title, node.description, node.kind, node.topic]
    .filter(Boolean)
    .some((value) => String(value).toLocaleLowerCase().includes(query));
}

export function buildTopicGraph(state, topicColors) {
  const topics = [...new Set(state.nodes.map((node) => node.topic).filter(Boolean))].sort();
  const nodes = [];

  for (const topic of topics) {
    const documents = state.nodes.filter((node) => node.topic === topic);
    const tokens = documents.reduce((sum, node) => sum + node.estimatedTokens, 0);
    nodes.push({
      id: `topic:${topic}`,
      isTopic: true,
      topic,
      label: compactLabel(topic),
      subLabel: `${documents.length} docs · ~${tokens} tk`,
      radius: 26 + Math.min(26, Math.sqrt(tokens)),
      fill: colorOf(topicColors, topic),
      status: worstStatus(documents),
      tooltip: `${topic}/\n${documents.map((document) => `· ${documentName(document.path)}`).join("\n")}`,
      target: { type: "topic", value: topic }
    });
  }

  for (const node of state.nodes.filter((item) => !item.topic)) {
    nodes.push({
      id: `doc:${node.path}`,
      isTopic: false,
      label: compactLabel(node.path.replace(/\.md$/, "")),
      radius: 10 + Math.min(9, Math.sqrt(node.estimatedTokens)),
      fill: colorOf(topicColors, null),
      status: node.status,
      tooltip: `${node.path}\n${node.description}`,
      target: { type: "document", value: node.path }
    });
  }

  const groupByPath = new Map(
    state.nodes.map((node) => [node.path, node.topic ? `topic:${node.topic}` : `doc:${node.path}`])
  );
  const aggregated = new Map();
  for (const edge of state.edges) {
    const left = groupByPath.get(edge.from);
    const right = groupByPath.get(edge.to);
    if (!left || !right || left === right) continue;
    const [from, to] = [left, right].sort();
    const key = `${from}\u0000${to}`;
    const current = aggregated.get(key) ?? { from, to, count: 0, style: "aggregate" };
    current.count += 1;
    aggregated.set(key, current);
  }

  const edges = [...aggregated.values()]
    .sort((left, right) => `${left.from}\u0000${left.to}`.localeCompare(`${right.from}\u0000${right.to}`))
    .map((edge) => ({ ...edge, width: 1.4 + Math.min(6, edge.count * 1.1) }));
  return { nodes, edges };
}

export function buildDocumentGraph(state, topicColors) {
  const nodes = state.nodes.map((node) => ({
    id: node.path,
    isTopic: false,
    topic: node.topic,
    cluster: node.topic || "·root",
    label: compactLabel(documentName(node.path)),
    radius: 8 + Math.min(11, Math.sqrt(node.estimatedTokens)),
    fill: colorOf(topicColors, node.topic),
    status: node.status,
    tooltip: `${node.path}\n${node.description}`,
    target: { type: "document", value: node.path }
  }));
  const edges = state.edges.map((edge) => ({ ...edge, style: edge.type }));
  return { nodes, edges };
}

export function resolveRelativeDocumentPath(documentPath, href) {
  const rawTarget = href.split(/[?#]/)[0] ?? "";
  const base = documentPath.split("/").slice(0, -1);
  const parts = [...base, ...rawTarget.split("/")];
  const normalized = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") normalized.pop();
    else normalized.push(part);
  }
  return normalized.join("/");
}

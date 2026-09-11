import { buildDocumentGraph, buildTopicGraph, STATUS_COLOR } from "./viewer-model.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

export function layoutGraph(graph, width, height, mode) {
  const nodes = graph.nodes.map((node) => ({ ...node, x: 0, y: 0, vx: 0, vy: 0 }));
  const edges = graph.edges.map((edge) => ({ ...edge }));
  if (!nodes.length) return { nodes, edges };

  const margin = 54;
  const usableWidth = Math.max(160, width - margin * 2);
  const usableHeight = Math.max(160, height - margin * 2);
  const centerX = width / 2;
  const centerY = height / 2;
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const indexById = new Map(nodes.map((node, index) => [node.id, index]));

  if (mode === "docs") initializeDocumentClusters(nodes, centerX, centerY, usableWidth, usableHeight);
  else initializeRadial(nodes, centerX, centerY, Math.min(usableWidth, usableHeight) * .43);

  const iterations = nodes.length > 500 ? 22 : nodes.length > 200 ? 30 : nodes.length > 80 ? 42 : 64;
  const cellSize = Math.max(56, Math.min(110, Math.min(usableWidth, usableHeight) / 5));
  const clusterCenters = buildClusterCenters(nodes, centerX, centerY, usableWidth, usableHeight);

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const cells = new Map();
    for (const node of nodes) {
      const key = cellKey(node.x, node.y, cellSize);
      const bucket = cells.get(key) ?? [];
      bucket.push(node);
      cells.set(key, bucket);
    }

    for (const node of nodes) {
      const cellX = Math.floor(node.x / cellSize);
      const cellY = Math.floor(node.y / cellSize);
      for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
        for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
          const bucket = cells.get(`${cellX + offsetX}:${cellY + offsetY}`) ?? [];
          for (const other of bucket) {
            if ((indexById.get(other.id) ?? 0) <= (indexById.get(node.id) ?? 0)) continue;
            pushApart(node, other, cellSize);
          }
        }
      }
    }

    for (const edge of edges) {
      const source = byId.get(edge.from);
      const target = byId.get(edge.to);
      if (!source || !target) continue;
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const distance = Math.hypot(dx, dy) || 1;
      const desired = source.radius + target.radius + (mode === "topics" ? 110 : 68);
      const pull = (distance - desired) * (mode === "topics" ? .008 : .0055);
      const fx = dx / distance * pull;
      const fy = dy / distance * pull;
      source.vx += fx;
      source.vy += fy;
      target.vx -= fx;
      target.vy -= fy;
    }

    for (const node of nodes) {
      const clusterCenter = node.cluster ? clusterCenters.get(node.cluster) : null;
      const gravityX = clusterCenter?.x ?? centerX;
      const gravityY = clusterCenter?.y ?? centerY;
      const gravity = node.cluster ? .009 : .0035;
      node.vx += (gravityX - node.x) * gravity;
      node.vy += (gravityY - node.y) * gravity;
      node.x += node.vx *= .74;
      node.y += node.vy *= .74;
      node.x = Math.min(width - margin, Math.max(margin, node.x));
      node.y = Math.min(height - margin, Math.max(margin, node.y));
    }
  }

  return { nodes, edges };
}

function initializeRadial(nodes, centerX, centerY, spread) {
  const ordered = [...nodes].sort((left, right) => left.id.localeCompare(right.id));
  ordered.forEach((node, index) => {
    const radius = spread * Math.sqrt((index + .65) / ordered.length);
    const angle = index * GOLDEN_ANGLE + stableUnit(node.id) * .35;
    node.x = centerX + Math.cos(angle) * radius;
    node.y = centerY + Math.sin(angle) * radius;
  });
}

function initializeDocumentClusters(nodes, centerX, centerY, width, height) {
  const groups = new Map();
  for (const node of nodes) {
    const bucket = groups.get(node.cluster) ?? [];
    bucket.push(node);
    groups.set(node.cluster, bucket);
  }
  const clusterCenters = ellipseCenters([...groups.keys()].sort(), centerX, centerY, width, height);
  for (const [cluster, groupedNodes] of groups) {
    const center = clusterCenters.get(cluster);
    [...groupedNodes].sort((left, right) => left.id.localeCompare(right.id)).forEach((node, index) => {
      const radius = 18 + 23 * Math.sqrt(index);
      const angle = index * GOLDEN_ANGLE + stableUnit(node.id) * .4;
      node.x = center.x + Math.cos(angle) * radius;
      node.y = center.y + Math.sin(angle) * radius;
    });
  }
}

function buildClusterCenters(nodes, centerX, centerY, width, height) {
  const clusters = [...new Set(nodes.map((node) => node.cluster).filter(Boolean))].sort();
  return ellipseCenters(clusters, centerX, centerY, width, height);
}

function ellipseCenters(clusters, centerX, centerY, width, height) {
  const result = new Map();
  clusters.forEach((cluster, index) => {
    if (clusters.length === 1) {
      result.set(cluster, { x: centerX, y: centerY });
      return;
    }
    const angle = index / clusters.length * Math.PI * 2 - Math.PI / 2;
    result.set(cluster, {
      x: centerX + Math.cos(angle) * width * .31,
      y: centerY + Math.sin(angle) * height * .31
    });
  });
  return result;
}

function pushApart(left, right, cellSize) {
  let dx = right.x - left.x;
  let dy = right.y - left.y;
  let distance = Math.hypot(dx, dy);
  if (distance === 0) {
    const angle = stableUnit(`${left.id}:${right.id}`) * Math.PI * 2;
    dx = Math.cos(angle);
    dy = Math.sin(angle);
    distance = 1;
  }
  const desired = Math.min(cellSize * .92, left.radius + right.radius + 28);
  if (distance >= desired) return;
  const force = Math.min(5, (desired - distance) * .055);
  const fx = dx / distance * force;
  const fy = dy / distance * force;
  left.vx -= fx;
  left.vy -= fy;
  right.vx += fx;
  right.vy += fy;
}

function cellKey(x, y, cellSize) {
  return `${Math.floor(x / cellSize)}:${Math.floor(y / cellSize)}`;
}

function stableUnit(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

export function createGraphController(options) {
  const { svg, hint, legend, empty, onSelectTopic, onSelectDocument } = options;
  let current = null;
  let view = { x: 0, y: 0, scale: 1 };
  let interaction = null;
  let highlightedId = null;

  const onWheel = (event) => {
    event.preventDefault();
    zoomBy(event.deltaY < 0 ? 1.12 : .9, event.offsetX, event.offsetY);
  };

  const onPointerDown = (event) => {
    if (event.button !== 0 || !current) return;
    const nodeElement = event.target.closest?.(".node");
    const node = nodeElement ? current.nodesById.get(nodeElement.dataset.nodeId) : null;
    interaction = node
      ? { type: "node", node, nodeElement, startX: event.clientX, startY: event.clientY, nodeX: node.x, nodeY: node.y, moved: false }
      : { type: "pan", startX: event.clientX, startY: event.clientY, viewX: view.x, viewY: view.y, moved: false };
    svg.classList.add("dragging");
    svg.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event) => {
    if (!interaction || !current) return;
    const dx = event.clientX - interaction.startX;
    const dy = event.clientY - interaction.startY;
    interaction.moved ||= Math.hypot(dx, dy) > 3;
    if (interaction.type === "node") {
      interaction.node.x = interaction.nodeX + dx / view.scale;
      interaction.node.y = interaction.nodeY + dy / view.scale;
      current.position();
    } else {
      view.x = interaction.viewX + dx;
      view.y = interaction.viewY + dy;
      applyView();
    }
  };

  const onPointerUp = (event) => {
    if (!interaction) return;
    if (!interaction.moved) {
      if (interaction.type === "node") selectTarget(interaction.node.target);
      else highlight(null);
    }
    interaction = null;
    svg.classList.remove("dragging");
    if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
  };

  const onKeyDown = (event) => {
    const nodeElement = event.target.closest?.(".node");
    if (nodeElement && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      const node = current?.nodesById.get(nodeElement.dataset.nodeId);
      if (node) selectTarget(node.target);
      return;
    }
    if (event.key === "0") {
      event.preventDefault();
      resetView();
    } else if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      zoomBy(1.15);
    } else if (event.key === "-") {
      event.preventDefault();
      zoomBy(.87);
    }
  };

  svg.addEventListener("wheel", onWheel, { passive: false });
  svg.addEventListener("pointerdown", onPointerDown);
  svg.addEventListener("pointermove", onPointerMove);
  svg.addEventListener("pointerup", onPointerUp);
  svg.addEventListener("pointercancel", onPointerUp);
  svg.addEventListener("keydown", onKeyDown);

  function render(input) {
    const bounds = svg.getBoundingClientRect();
    const width = Math.max(240, bounds.width);
    const height = Math.max(240, bounds.height);
    const source = input.mode === "topics"
      ? buildTopicGraph(input.state, input.topicColors)
      : buildDocumentGraph(input.state, input.topicColors);
    const graph = layoutGraph(source, width, height, input.mode);
    svg.replaceChildren();
    empty.hidden = graph.nodes.length > 0;
    setGraphChrome(input.mode);

    const defs = svgElement("defs");
    defs.append(createArrowMarker(), createShadowFilter());
    const root = svgElement("g");
    svg.append(defs, root);

    const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
    const edgeElements = graph.edges.map((edge) => {
      const path = svgElement("path");
      path.setAttribute("class", "edge-path");
      path.setAttribute("stroke", edge.style === "link" ? "#c8cfd8" : "#9aa4b2");
      path.setAttribute("stroke-width", String(edge.width ?? (edge.style === "link" ? 1 : 1.7)));
      path.setAttribute("stroke-linecap", "round");
      path.setAttribute("stroke-opacity", edge.style === "link" ? ".75" : ".85");
      if (edge.style === "related") path.setAttribute("stroke-dasharray", "5 5");
      if (edge.style === "requires") path.setAttribute("marker-end", "url(#arrow)");
      root.append(path);
      return { edge, element: path };
    });

    const nodeElements = graph.nodes.map((node) => {
      const group = svgElement("g");
      group.setAttribute("class", "node");
      group.setAttribute("data-node-id", node.id);
      group.setAttribute("tabindex", "0");
      group.setAttribute("role", "button");
      group.setAttribute("aria-label", node.tooltip.replace(/\n/g, "，"));
      const circle = svgElement("circle");
      circle.setAttribute("r", String(node.radius));
      circle.setAttribute("fill", node.fill);
      circle.setAttribute("fill-opacity", node.isTopic ? ".92" : ".88");
      circle.setAttribute("stroke", node.status === "current" ? "#ffffff" : STATUS_COLOR[node.status]);
      circle.setAttribute("stroke-width", node.status === "current" ? "2" : "3.5");
      circle.setAttribute("filter", "url(#soft)");
      group.append(circle);
      if (node.isTopic) {
        group.append(
          textElement(node.label, 0, 4, 12.5, 700, "#ffffff"),
          textElement(node.subLabel, 0, node.radius + 15, 10.5, 500, null, "sub")
        );
      } else {
        group.append(textElement(node.label, 0, node.radius + 13, 10, 500));
      }
      const title = svgElement("title");
      title.textContent = node.tooltip;
      group.append(title);
      root.append(group);
      return { node, element: group };
    });

    const position = () => {
      for (const { edge, element } of edgeElements) {
        const sourceNode = nodesById.get(edge.from);
        const targetNode = nodesById.get(edge.to);
        if (!sourceNode || !targetNode) continue;
        element.setAttribute("d", edgePath(sourceNode, targetNode, edge.style));
      }
      for (const { node, element } of nodeElements) {
        element.setAttribute("transform", `translate(${node.x},${node.y})`);
      }
    };

    current = { root, graph, nodesById, nodeElements, edgeElements, position };
    view = { x: 0, y: 0, scale: 1 };
    position();
    applyView();
    highlight(input.mode === "docs" ? input.selected : highlightedId);
  }

  function resize(input) {
    render(input);
  }

  function selectTarget(target) {
    if (target.type === "topic") onSelectTopic(target.value);
    else onSelectDocument(target.value);
  }

  function setGraphChrome(mode) {
    hint.textContent = mode === "topics"
      ? "Topic topology · edge width shows cross-domain references · click to drill down"
      : "Document graph · click for details · drag to pan / scroll to zoom";
    legend.replaceChildren();
    const edgeItems = mode === "topics"
      ? [["", "Cross-domain references"]]
      : [["", "requires"], ["related", "related"], ["link", "link"]];
    for (const [className, label] of edgeItems) {
      const item = document.createElement("span");
      const sample = document.createElement("i");
      if (className) sample.className = className;
      item.append(sample, label);
      legend.append(item);
    }
    for (const [status, label] of [["unverified", "unverified"], ["needs_review", "needs review"]]) {
      const item = document.createElement("span");
      const bullet = document.createElement("b");
      bullet.textContent = "●";
      bullet.style.color = STATUS_COLOR[status];
      item.append(bullet, ` ${label}`);
      legend.append(item);
    }
  }

  function highlight(id) {
    highlightedId = id;
    if (!current) return;
    const neighbors = new Set();
    if (id) {
      neighbors.add(id);
      for (const edge of current.graph.edges) {
        if (edge.from === id) neighbors.add(edge.to);
        if (edge.to === id) neighbors.add(edge.from);
      }
    }
    for (const { node, element } of current.nodeElements) {
      element.setAttribute("class", `node${id && !neighbors.has(node.id) ? " dim" : ""}`);
    }
    for (const { edge, element } of current.edgeElements) {
      element.setAttribute("class", `edge-path${id && edge.from !== id && edge.to !== id ? " dim" : ""}`);
    }
  }

  function zoomBy(factor, anchorX, anchorY) {
    const bounds = svg.getBoundingClientRect();
    const x = anchorX ?? bounds.width / 2;
    const y = anchorY ?? bounds.height / 2;
    const next = Math.min(4, Math.max(.3, view.scale * factor));
    view.x = x - (x - view.x) / view.scale * next;
    view.y = y - (y - view.y) / view.scale * next;
    view.scale = next;
    applyView();
  }

  function resetView() {
    view = { x: 0, y: 0, scale: 1 };
    applyView();
  }

  function applyView() {
    current?.root.setAttribute("transform", `translate(${view.x},${view.y}) scale(${view.scale})`);
  }

  function destroy() {
    svg.removeEventListener("wheel", onWheel);
    svg.removeEventListener("pointerdown", onPointerDown);
    svg.removeEventListener("pointermove", onPointerMove);
    svg.removeEventListener("pointerup", onPointerUp);
    svg.removeEventListener("pointercancel", onPointerUp);
    svg.removeEventListener("keydown", onKeyDown);
  }

  return { render, resize, highlight, zoomBy, resetView, destroy };
}

function edgePath(source, target, style) {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const distance = Math.hypot(dx, dy) || 1;
  const sourceX = source.x + dx / distance * source.radius;
  const sourceY = source.y + dy / distance * source.radius;
  const arrowPadding = style === "requires" ? 4 : 0;
  const targetX = target.x - dx / distance * (target.radius + arrowPadding);
  const targetY = target.y - dy / distance * (target.radius + arrowPadding);
  const middleX = (sourceX + targetX) / 2 - dy / distance * distance * .09;
  const middleY = (sourceY + targetY) / 2 + dx / distance * distance * .09;
  return `M ${sourceX} ${sourceY} Q ${middleX} ${middleY} ${targetX} ${targetY}`;
}

function svgElement(name) {
  return document.createElementNS(SVG_NS, name);
}

function textElement(content, x, y, size, weight, fill, className) {
  const element = svgElement("text");
  element.setAttribute("text-anchor", "middle");
  element.setAttribute("x", String(x));
  element.setAttribute("y", String(y));
  element.setAttribute("font-size", String(size));
  element.setAttribute("font-weight", String(weight));
  if (fill) element.style.fill = fill;
  if (className) element.setAttribute("class", className);
  element.textContent = content;
  return element;
}

function createArrowMarker() {
  const marker = svgElement("marker");
  marker.setAttribute("id", "arrow");
  marker.setAttribute("viewBox", "0 0 8 8");
  marker.setAttribute("refX", "7.5");
  marker.setAttribute("refY", "4");
  marker.setAttribute("markerWidth", "5.5");
  marker.setAttribute("markerHeight", "5.5");
  marker.setAttribute("orient", "auto");
  const path = svgElement("path");
  path.setAttribute("d", "M0 .8 L8 4 L0 7.2 z");
  path.setAttribute("fill", "#9aa4b2");
  marker.append(path);
  return marker;
}

function createShadowFilter() {
  const filter = svgElement("filter");
  filter.setAttribute("id", "soft");
  filter.setAttribute("x", "-40%");
  filter.setAttribute("y", "-40%");
  filter.setAttribute("width", "180%");
  filter.setAttribute("height", "180%");
  const shadow = svgElement("feDropShadow");
  shadow.setAttribute("dx", "0");
  shadow.setAttribute("dy", "1.5");
  shadow.setAttribute("stdDeviation", "2.5");
  shadow.setAttribute("flood-color", "#101828");
  shadow.setAttribute("flood-opacity", ".18");
  filter.append(shadow);
  return filter;
}

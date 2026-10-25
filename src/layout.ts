import type { Group, LayoutNode } from "./types";

/** Where one group is dropped relative to another. */
export type Side = "left" | "right" | "top" | "bottom";

/** Every group, in reading order. */
export function groupsOf(node: LayoutNode): Group[] {
  return node.kind === "group" ? [node] : node.children.flatMap(groupsOf);
}

export function findGroup(node: LayoutNode, id: string): Group | undefined {
  return groupsOf(node).find((g) => g.id === id);
}

export function mapGroups(node: LayoutNode, fn: (group: Group) => Group): LayoutNode {
  return node.kind === "group"
    ? fn(node)
    : { ...node, children: node.children.map((c) => mapGroups(c, fn)) };
}

/**
 * Tidy a tree after an edit: empty splits disappear, single-child splits are
 * replaced by their child, and a row inside a row (or column inside a column)
 * is flattened into its parent. Returns null if nothing is left.
 */
export function normalize(node: LayoutNode): LayoutNode | null {
  if (node.kind === "group") return node;
  const children = node.children.flatMap((child) => {
    const tidy = normalize(child);
    if (!tidy) return [];
    return tidy.kind === "split" && tidy.direction === node.direction ? tidy.children : [tidy];
  });
  if (children.length === 0) return null;
  if (children.length === 1) return children[0];
  return { ...node, children };
}

export function removeGroup(node: LayoutNode, id: string): LayoutNode | null {
  if (node.kind === "group") return node.id === id ? null : node;
  return normalize({
    ...node,
    children: node.children.flatMap((c) => removeGroup(c, id) ?? []),
  });
}

/** Place `incoming` on one side of the group `targetId`. */
export function insertBeside(
  node: LayoutNode,
  targetId: string,
  incoming: LayoutNode,
  side: Side,
): LayoutNode {
  const direction = side === "left" || side === "right" ? "row" : "column";
  const before = side === "left" || side === "top";

  if (node.kind === "group") {
    if (node.id !== targetId) return node;
    return {
      kind: "split",
      id: crypto.randomUUID(),
      direction,
      children: before ? [incoming, node] : [node, incoming],
    };
  }

  // Already in a split going the right way: just become a sibling.
  const index = node.children.findIndex((c) => c.kind === "group" && c.id === targetId);
  if (index !== -1 && node.direction === direction) {
    const children = [...node.children];
    children.splice(before ? index : index + 1, 0, incoming);
    return { ...node, children };
  }

  return {
    ...node,
    children: node.children.map((c) => insertBeside(c, targetId, incoming, side)),
  };
}

/**
 * How much horizontal room a node wants, in grid columns. Side-by-side groups
 * share width in proportion, so cells come out roughly the same size everywhere.
 */
export function layoutWeight(node: LayoutNode): number {
  if (node.kind === "group") return node.columns;
  const weights = node.children.map(layoutWeight);
  return node.direction === "row"
    ? weights.reduce((a, b) => a + b, 0)
    : Math.max(...weights);
}

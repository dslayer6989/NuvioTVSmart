// Updates a region from new HTML but keeps every child whose markup didn't change, so a
// remote key press only redraws the few guide rows it touched (no logo flicker, less work
// for older TVs). Children are matched by `data-ltv-key`; containers marked
// `data-ltv-deep` are patched the same way one level further down.

function keyOf(node) {
  return node?.dataset?.ltvKey || "";
}

/** Remembers the markup a node was built from (and, for deep containers, its children's). */
function stamp(node) {
  node.__ltvHtml = node.outerHTML;
  if (node.hasAttribute?.("data-ltv-deep")) Array.from(node.children).forEach(stamp);
}

function syncAttributes(target, source) {
  Array.from(target.attributes).forEach((attribute) => {
    if (!source.hasAttribute(attribute.name)) target.removeAttribute(attribute.name);
  });
  Array.from(source.attributes).forEach((attribute) => {
    if (target.getAttribute(attribute.name) !== attribute.value)
      target.setAttribute(attribute.name, attribute.value);
  });
}

function patchChildren(parent, nextParent) {
  const previous = new Map();
  Array.from(parent.children).forEach((child) => {
    const key = keyOf(child);
    if (key) previous.set(key, child);
  });
  const result = Array.from(nextParent.children).map((next) => {
    const key = keyOf(next);
    const old = key ? previous.get(key) : null;
    if (!old) {
      stamp(next);
      return next;
    }
    previous.delete(key);
    const html = next.outerHTML;
    if (old.__ltvHtml === html) return old;
    if (next.hasAttribute("data-ltv-deep") && old.hasAttribute("data-ltv-deep")) {
      syncAttributes(old, next);
      patchChildren(old, next);
      old.__ltvHtml = html;
      return old;
    }
    stamp(next);
    return next;
  });
  // Put the children in order, moving kept nodes instead of recreating them.
  result.forEach((node, index) => {
    const current = parent.children[index];
    if (current !== node) parent.insertBefore(node, current || null);
  });
  while (parent.children.length > result.length) parent.removeChild(parent.lastElementChild);
}

export function patchRegion(container, html) {
  if (!container) return;
  if (container.__ltvRegionHtml === html) return;
  container.__ltvRegionHtml = html;
  const template = document.createElement("div");
  template.innerHTML = html;
  const allKeyed = Array.from(template.children).every((child) => keyOf(child));
  if (!allKeyed || !container.children.length) {
    container.innerHTML = "";
    Array.from(template.children).forEach((child) => {
      stamp(child);
      container.appendChild(child);
    });
    return;
  }
  patchChildren(container, template);
}

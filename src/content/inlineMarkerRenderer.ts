import type { InlineAnnotation } from "../shared/messages";

const INLINE_MARKER_PATTERN = /\[(\/?)HTP_INLINE_(\d+)\]/g;

type MarkerTreeChild = string | MarkerTreeMarker;

type MarkerTreeRoot = {
  type: "root";
  children: MarkerTreeChild[];
};

type MarkerTreeMarker = {
  type: "marker";
  id: string;
  children: MarkerTreeChild[];
};

function stripInlineMarkerTokens(text: string): string {
  return text.replace(INLINE_MARKER_PATTERN, "");
}

export function parseInlineMarkerTree(text: string): MarkerTreeRoot | null {
  const root: MarkerTreeRoot = {
    type: "root",
    children: []
  };
  const stack: Array<MarkerTreeRoot | MarkerTreeMarker> = [root];
  let cursor = 0;

  for (const match of text.matchAll(INLINE_MARKER_PATTERN)) {
    const matchIndex = match.index ?? 0;
    const current = stack[stack.length - 1];
    const before = text.slice(cursor, matchIndex);

    if (before) {
      current.children.push(before);
    }

    const isClosing = match[1] === "/";
    const id = match[2];

    if (isClosing) {
      const openMarker = stack[stack.length - 1];

      if (openMarker.type !== "marker" || openMarker.id !== id) {
        return null;
      }

      stack.pop();
    } else {
      const marker: MarkerTreeMarker = {
        type: "marker",
        id,
        children: []
      };
      current.children.push(marker);
      stack.push(marker);
    }

    cursor = matchIndex + match[0].length;
  }

  if (stack.length !== 1) {
    return null;
  }

  const after = text.slice(cursor);

  if (after) {
    root.children.push(after);
  }

  return root;
}

function createAnnotatedElement(annotation: InlineAnnotation): HTMLElement {
  const element = document.createElement(annotation.kind);

  if (annotation.kind === "a" && annotation.href) {
    const anchor = element as HTMLAnchorElement;
    anchor.href = annotation.href;

    if (annotation.target) {
      anchor.target = annotation.target;
    }

    if (annotation.rel) {
      anchor.rel = annotation.rel;
    }
  }

  if (annotation.className) {
    element.className = annotation.className;
  }

  if (annotation.styleText) {
    element.setAttribute("style", annotation.styleText);
  }

  return element;
}

function validateMarkerTree(
  children: MarkerTreeChild[],
  annotationById: Map<string, InlineAnnotation>,
  seenIds: Set<string>
): boolean {
  for (const child of children) {
    if (typeof child === "string") {
      continue;
    }

    if (!annotationById.has(child.id) || seenIds.has(child.id)) {
      return false;
    }

    seenIds.add(child.id);

    if (!validateMarkerTree(child.children, annotationById, seenIds)) {
      return false;
    }
  }

  return true;
}

function appendTreeChildren(
  parent: Node,
  children: MarkerTreeChild[],
  annotationById: Map<string, InlineAnnotation>
): void {
  for (const child of children) {
    if (typeof child === "string") {
      parent.appendChild(document.createTextNode(child));
      continue;
    }

    const annotation = annotationById.get(child.id);

    if (!annotation) {
      parent.appendChild(document.createTextNode(child.children.join("")));
      continue;
    }

    const element = createAnnotatedElement(annotation);
    appendTreeChildren(element, child.children, annotationById);
    parent.appendChild(element);
  }
}

function appendExactAnnotationFallback(
  fragment: DocumentFragment,
  text: string,
  annotations: InlineAnnotation[]
): boolean {
  const remainingAnnotations = [...annotations];
  let remainingText = text;
  let renderedAnnotation = false;

  while (remainingAnnotations.length > 0) {
    const nextMatch = remainingAnnotations
      .map((annotation) => ({
        annotation,
        index: remainingText.indexOf(annotation.text)
      }))
      .filter(({ index }) => index >= 0)
      .sort((left, right) => left.index - right.index)[0];

    if (!nextMatch) {
      break;
    }

    const before = remainingText.slice(0, nextMatch.index);

    if (before) {
      fragment.appendChild(document.createTextNode(before));
    }

    const element = createAnnotatedElement(nextMatch.annotation);
    element.textContent = nextMatch.annotation.text;
    fragment.appendChild(element);
    renderedAnnotation = true;
    remainingText = remainingText.slice(
      nextMatch.index + nextMatch.annotation.text.length
    );
    remainingAnnotations.splice(
      remainingAnnotations.indexOf(nextMatch.annotation),
      1
    );
  }

  if (remainingText) {
    fragment.appendChild(document.createTextNode(remainingText));
  }

  return renderedAnnotation;
}

export function createInlineMarkerFragment(
  text: string,
  annotations: InlineAnnotation[] = []
): DocumentFragment {
  const fragment = document.createDocumentFragment();

  if (annotations.length === 0) {
    fragment.appendChild(document.createTextNode(text));
    return fragment;
  }

  const annotationById = new Map(
    annotations.map((annotation) => [annotation.id, annotation])
  );
  const tree = parseInlineMarkerTree(text);
  const seenIds = new Set<string>();

  if (
    tree &&
    validateMarkerTree(tree.children, annotationById, seenIds) &&
    seenIds.size === annotations.length
  ) {
    appendTreeChildren(fragment, tree.children, annotationById);
    return fragment;
  }

  if (appendExactAnnotationFallback(fragment, stripInlineMarkerTokens(text), annotations)) {
    return fragment;
  }

  fragment.appendChild(document.createTextNode(stripInlineMarkerTokens(text)));
  return fragment;
}

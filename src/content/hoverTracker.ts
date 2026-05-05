import { findNearestTranslatableElement } from "./translatableElement";

export class HoverTracker {
  private currentElement: Element | null = null;

  start(): void {
    document.addEventListener("mouseover", this.handleMouseOver, true);
  }

  stop(): void {
    document.removeEventListener("mouseover", this.handleMouseOver, true);
    this.currentElement = null;
  }

  getCurrentElement(): Element | null {
    return this.currentElement;
  }

  private readonly handleMouseOver = (event: MouseEvent): void => {
    const target = event.target;

    if (!(target instanceof Element)) {
      this.currentElement = null;
      return;
    }

    if (
      target.closest("[data-hover-trans-port-bubble]") ||
      target.closest("[data-hover-trans-port-inline]")
    ) {
      this.currentElement = null;
      return;
    }

    this.currentElement = findNearestTranslatableElement(target);
  };
}

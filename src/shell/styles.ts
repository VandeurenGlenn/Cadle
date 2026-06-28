import { css } from '@vandeurenglenn/lite'

export const shellStyles = css`
  :host {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    --custom-top-app-bar-height: var(--cadle-header-height);
  }

  .shell-frame {
    display: grid;
    grid-template-rows: minmax(0, 1fr) var(--cadle-status-bar, 28px);
    width: 100%;
    height: 100%;
    min-height: 0;
  }

  .layout {
    display: grid;
    grid-template-columns:
      var(--cadle-rail-left, 272px)
      minmax(0, 1fr)
      var(--cadle-rail-right, 320px);
    grid-template-rows: 1fr;
    width: 100%;
    height: 100%;
    min-height: 0;
  }

  .left-rail,
  .right-rail {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    background: var(--md-sys-color-surface-container);
  }

  /* Inner panes still scroll, but the rail itself stays overflow:visible
     so floating menus (project-actions File/Help dropdown, context menus)
     can escape the rail rectangle. */
  .left-rail project-pane,
  .right-rail object-pane {
    overflow: hidden;
  }

  .left-rail {
    border-right: 1px solid var(--md-sys-color-outline-variant);
  }

  cadle-header project-actions {
    width: 100%;
  }

  .right-rail {
    border-left: 1px solid var(--md-sys-color-outline-variant);
  }

  .center-stage {
    background: var(--cadle-canvas-surface);
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    position: relative;
  }

  .center-stage-toolbar {
    display: flex;
    align-items: center;
    gap: var(--cadle-space-3);
    height: var(--cadle-header-height);
    min-height: var(--cadle-header-height);
    padding: 0 var(--cadle-space-3);
    background: var(--cadle-glass-bg-strong);
    backdrop-filter: blur(var(--cadle-glass-blur));
    -webkit-backdrop-filter: blur(var(--cadle-glass-blur));
    border-bottom: 1px solid var(--md-sys-color-outline-variant);
    box-shadow: var(--cadle-glass-shadow);
    flex: 0 0 auto;
    z-index: 2;
  }

  .center-stage-toolbar cadle-actions {
    flex: 1 1 auto;
    min-width: 0;
  }

  .center-stage-toolbar design-mode-toggle {
    flex: 0 0 auto;
  }

  .left-rail project-pane,
  .right-rail object-pane {
    position: static !important;
    top: auto !important;
    right: auto !important;
    bottom: auto !important;
    width: 100% !important;
    height: 100% !important;
  }

  .right-rail object-pane {
    border-left: 0;
  }

  /* Icon-only segmented control at the top of the left rail. Replaces the
     old bottom <custom-tabs> strip — saves ~40px of vertical chrome and
     keeps the rail self-identifying. */
  .rail-tabs {
    display: flex;
    flex-direction: row;
    align-items: stretch;
    height: 36px;
    padding: 0 var(--cadle-space-2);
    gap: var(--cadle-space-1);
    background: var(--md-sys-color-surface-container);
    border-bottom: 1px solid var(--md-sys-color-outline-variant);
    flex: 0 0 auto;
  }

  .rail-tab {
    flex: 1 1 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: 0;
    padding: 0;
    margin: 0;
    cursor: pointer;
    color: var(--md-sys-color-on-surface-variant);
    border-bottom: 2px solid transparent;
    transition:
      color var(--cadle-motion-fast),
      background-color var(--cadle-motion-fast),
      border-color var(--cadle-motion-fast);
  }

  .rail-tab:hover {
    background: color-mix(in srgb, var(--md-sys-color-on-surface) 6%, transparent);
    color: var(--md-sys-color-on-surface);
  }

  .rail-tab[aria-selected='true'] {
    color: var(--md-sys-color-primary);
    border-bottom-color: var(--md-sys-color-primary);
  }

  .rail-tab:focus-visible {
    outline: none;
    box-shadow: var(--cadle-focus-ring);
    border-radius: var(--cadle-radius-sm);
  }

  .rail-tab custom-icon {
    --custom-icon-color: currentColor;
  }

  section {
    display: flex;
    flex-direction: column;
  }

  custom-pages {
    display: flex;
    width: 100%;
    height: calc(100% - 1px);
    min-width: 0;
    min-height: 0;
  }

  projects-field,
  home-field,
  add-page-field,
  create-project-field,
  settings-field {
    flex: 1 1 auto;
    min-width: 0;
    min-height: 0;
    width: 100%;
    height: 100%;
  }

  flex-row.main {
    width: calc(100% - 2px);
    height: calc(100% - var(--cadle-header-height));
  }

  .file-controls {
    width: 230px;
    pointer-events: auto;
  }

  input[type='color'] {
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
  }

  @media (max-width: 1280px) {
    .layout {
      grid-template-columns:
        240px
        minmax(0, 1fr)
        280px;
    }
  }

  @media (max-width: 1024px) {
    .layout {
      grid-template-columns:
        220px
        minmax(0, 1fr);
    }

    .right-rail {
      display: none;
    }
  }
`

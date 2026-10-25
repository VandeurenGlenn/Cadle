import { css } from '@vandeurenglenn/lite'

export const shellStyles = css`
  :host {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    --custom-top-app-bar-height: var(--cadle-header-height);
  }

  .drive-auth-notice {
    position: fixed;
    z-index: 20000;
    right: 20px;
    bottom: 20px;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto auto;
    align-items: center;
    gap: 12px;
    width: min(560px, calc(100vw - 40px));
    box-sizing: border-box;
    padding: 14px;
    border: 1px solid var(--md-sys-color-outline-variant);
    border-radius: 16px;
    color: var(--md-sys-color-on-surface);
    background: var(--md-sys-color-surface-container-high);
    box-shadow: var(--cadle-elevation-3);
  }

  .drive-auth-notice custom-icon { color: var(--md-sys-color-error); }
  .drive-auth-notice strong, .drive-auth-notice span { display: block; }
  .drive-auth-notice span { margin-top: 3px; color: var(--md-sys-color-on-surface-variant); font-size: 13px; }
  .drive-auth-notice button { min-height: 36px; padding: 0 14px; border: 0; border-radius: 999px; color: var(--md-sys-color-on-primary); background: var(--md-sys-color-primary); font: inherit; font-weight: 650; cursor: pointer; }
  .drive-auth-notice .notice-close { width: 36px; padding: 0; color: var(--md-sys-color-on-surface-variant); background: transparent; font-size: 22px; }

  @media (max-width: 640px) {
    .drive-auth-notice { left: 12px; right: 12px; bottom: 12px; grid-template-columns: auto minmax(0, 1fr) auto; width: auto; }
    .drive-auth-notice > button:not(.notice-close) { grid-column: 1 / -1; }
    .drive-auth-notice .notice-close { grid-column: 3; grid-row: 1; }
  }

  .route-only {
    display: flex;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    background: var(--md-sys-color-background);
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
      var(--cadle-rail-left, 224px)
      minmax(0, 1fr);
    grid-template-rows: 1fr;
    width: 100%;
    height: 100%;
    min-height: 0;
    position: relative;
  }

  .layout[data-circuit-schedule='true'] {
    grid-template-columns: var(--cadle-rail-left, 224px) minmax(0, 1fr);
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
    box-sizing: border-box;
    position: absolute;
    z-index: 10025;
    top: calc(var(--cadle-header-height) + var(--cadle-space-3));
    right: var(--cadle-space-3);
    bottom: var(--cadle-space-3);
    width: min(var(--cadle-rail-right, 288px), calc(100% - var(--cadle-rail-left, 224px) - 48px));
    overflow: hidden;
    visibility: hidden;
    opacity: 0;
    transform: translateX(16px);
    border: 1px solid var(--md-sys-color-outline-variant);
    border-radius: var(--cadle-radius-md);
    background: var(--cadle-glass-bg-strong);
    box-shadow: var(--cadle-elevation-3);
    backdrop-filter: blur(var(--cadle-glass-blur));
    -webkit-backdrop-filter: blur(var(--cadle-glass-blur));
    transition:
      opacity var(--cadle-motion-fast),
      transform var(--cadle-motion-standard),
      visibility 0s linear var(--cadle-motion-standard);
  }

  .right-rail[data-open='true'] {
    visibility: visible;
    opacity: 1;
    transform: translateX(0);
    transition-delay: 0s;
  }

  .object-inspector-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: var(--cadle-header-height);
    padding: 0 var(--cadle-space-2) 0 var(--cadle-space-3);
    border-bottom: 1px solid var(--md-sys-color-outline-variant);
    background: color-mix(in srgb, var(--cadle-glass-bg-strong) 92%, transparent);
  }

  .object-inspector-header strong {
    font: var(--md-sys-typescale-title-small);
  }

  .object-inspector-header button,
  .object-action-rail button {
    appearance: none;
    display: grid;
    place-items: center;
    width: var(--cadle-control-height);
    height: var(--cadle-control-height);
    padding: 0;
    border: 0;
    border-radius: var(--cadle-radius-sm);
    color: var(--md-sys-color-on-surface);
    background: transparent;
    cursor: pointer;
  }

  .object-inspector-header button:hover,
  .object-action-rail button:hover {
    background: color-mix(in srgb, var(--md-sys-color-primary) 10%, transparent);
  }

  .object-inspector-header button:focus-visible,
  .object-action-rail button:focus-visible {
    outline: none;
    box-shadow: var(--cadle-focus-ring);
  }

  .object-action-rail {
    position: absolute;
    z-index: 10024;
    top: calc(var(--cadle-header-height) + var(--cadle-space-3));
    right: var(--cadle-space-3);
    display: grid;
    gap: var(--cadle-space-1);
    padding: var(--cadle-space-1);
    border: 1px solid var(--md-sys-color-outline-variant);
    border-radius: var(--cadle-radius-md);
    background: var(--cadle-glass-bg-strong);
    box-shadow: var(--cadle-glass-shadow);
    backdrop-filter: blur(var(--cadle-glass-blur));
    -webkit-backdrop-filter: blur(var(--cadle-glass-blur));
    transition: right var(--cadle-motion-standard);
  }

  .object-action-rail[data-inspector-open='true'] {
    right: calc(var(--cadle-rail-right, 288px) + var(--cadle-space-5));
  }

  .object-action-rail button {
    position: relative;
  }

  .object-action-rail button[aria-expanded='true'] {
    color: var(--md-sys-color-primary);
    background: color-mix(in srgb, var(--md-sys-color-primary) 12%, transparent);
  }

  .object-action-rail button:disabled {
    opacity: 0.38;
    cursor: default;
  }

  .selection-badge {
    position: absolute;
    top: 2px;
    right: 2px;
    min-width: 16px;
    height: 16px;
    padding: 0 4px;
    border-radius: 8px;
    background: var(--md-sys-color-primary);
    color: var(--md-sys-color-on-primary);
    font: var(--md-sys-typescale-label-small);
    line-height: 16px;
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
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--cadle-space-2);
    height: var(--cadle-header-height);
    min-height: var(--cadle-header-height);
    padding: 0 var(--cadle-space-2);
    background: var(--cadle-glass-bg-strong);
    backdrop-filter: blur(var(--cadle-glass-blur));
    -webkit-backdrop-filter: blur(var(--cadle-glass-blur));
    border-bottom: 1px solid var(--md-sys-color-outline-variant);
    box-shadow: var(--cadle-glass-shadow);
    flex: 0 0 auto;
    z-index: 10030;
    overflow: visible;
  }

  .editor-actions {
    display: flex;
    align-items: center;
    flex: 1 1 auto;
    min-width: 0;
    overflow-x: auto;
    overscroll-behavior-x: contain;
    scrollbar-width: none;
  }

  .editor-actions::-webkit-scrollbar {
    display: none;
  }

  .editor-actions cadle-actions,
  .editor-actions onewire-actions {
    flex: 0 0 auto;
  }

  .editor-actions cadle-actions {
    width: max-content;
    overflow: visible;
  }

  .center-stage-toolbar onewire-actions {
    flex: 0 0 auto;
  }

  .center-stage-toolbar > span {
    flex: 1 1 auto;
    min-width: 0;
    text-align: center;
  }

  .split-view-toggle {
    appearance: none;
    display: grid;
    place-items: center;
    flex: 0 0 auto;
    width: var(--cadle-control-height);
    height: var(--cadle-control-height);
    padding: 0;
    border: 0;
    border-radius: var(--cadle-radius-sm);
    color: var(--md-sys-color-on-surface-variant);
    background: transparent;
    cursor: pointer;
  }

  .split-view-toggle:hover,
  .split-view-toggle[aria-pressed='true'] {
    color: var(--md-sys-color-primary);
    background: color-mix(in srgb, var(--md-sys-color-primary) 12%, transparent);
  }

  .split-view-toggle:focus-visible {
    outline: none;
    box-shadow: var(--cadle-focus-ring);
  }

  .split-view-toggle:disabled {
    opacity: 0.38;
    cursor: default;
  }

  .editor-workspace {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
  }

  .editor-workspace[data-split='true'] {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .editor-pane {
    position: relative;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }

  .linked-editor-pane {
    border-left: 1px solid var(--md-sys-color-outline-variant);
  }

  .editor-pane cadle-app {
    width: 100%;
    height: 100%;
  }

  .linked-editor-pane cadle-app {
    pointer-events: none;
  }

  .editor-pane-label {
    position: absolute;
    z-index: 4;
    top: var(--cadle-space-2);
    left: 50%;
    display: flex;
    align-items: center;
    gap: var(--cadle-space-2);
    max-width: calc(100% - 120px);
    padding: var(--cadle-space-1) var(--cadle-space-2);
    overflow: hidden;
    transform: translateX(-50%);
    border: 1px solid var(--md-sys-color-outline-variant);
    border-radius: var(--cadle-radius-sm);
    color: var(--md-sys-color-on-surface);
    background: var(--cadle-glass-bg-strong);
    box-shadow: var(--cadle-glass-shadow);
    font: var(--md-sys-typescale-label-medium);
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .editor-pane-label span {
    color: var(--md-sys-color-on-surface-variant);
  }

  .mobile-drawer-toggle,
  .mobile-drawer-backdrop {
    display: none;
  }

  .object-action-rail .symbol-picker-toggle {
    color: var(--md-sys-color-on-primary-container);
    background: var(--md-sys-color-primary-container);
  }

  .mobile-drawer-toggle {
    appearance: none;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    color: var(--md-sys-color-on-surface);
    background: transparent;
    cursor: pointer;
  }

  .mobile-drawer-toggle:hover {
    background: color-mix(in srgb, var(--md-sys-color-on-surface) 8%, transparent);
  }

  .mobile-drawer-toggle:focus-visible {
    outline: none;
    box-shadow: var(--cadle-focus-ring);
  }

  .left-rail project-pane {
    position: static !important;
    top: auto !important;
    right: auto !important;
    bottom: auto !important;
    width: 100% !important;
    height: 100% !important;
  }

  .right-rail object-pane {
    flex: 1 1 auto;
    min-height: 0;
    width: 100%;
    border-left: 0;
  }

  /* Icon-only segmented control at the top of the left rail. Replaces the
     old bottom <custom-tabs> strip — saves ~40px of vertical chrome and
     keeps the rail self-identifying. */
  .rail-tabs {
    display: flex;
    flex-direction: row;
    align-items: stretch;
    width: 100%;
    min-width: 0;
    height: var(--cadle-control-height-compact);
    box-sizing: border-box;
    padding: 0 var(--cadle-space-2);
    gap: var(--cadle-space-1);
    overflow: hidden;
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

  .settings-navigation {
    display: grid;
    flex: 0 0 auto;
    place-items: center;
    width: 40px;
    height: 40px;
    margin-left: auto;
    padding: 0;
    border: 0;
    border-radius: 50%;
    color: var(--md-sys-color-on-surface-variant);
    background: transparent;
    cursor: pointer;
    transition: color var(--cadle-motion-fast), background-color var(--cadle-motion-fast);
  }

  .settings-navigation:hover {
    color: var(--md-sys-color-on-surface);
    background: var(--md-sys-color-surface-container-high);
  }

  .settings-navigation:focus-visible {
    outline: none;
    box-shadow: var(--cadle-focus-ring);
  }

  input[type='color'] {
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
  }

  @media (max-width: 1280px) {
    .layout {
      grid-template-columns:
        224px
        minmax(0, 1fr);
    }
  }

  @media (max-width: 1024px) {
    .layout {
      grid-template-columns:
        220px
        minmax(0, 1fr);
    }
  }

  @media (max-width: 720px) {
    .layout {
      grid-template-columns: minmax(0, 1fr);
    }

    .left-rail {
      position: fixed;
      z-index: 12020;
      inset: 0 auto var(--cadle-status-bar, 28px) 0;
      width: min(86vw, 320px);
      transform: translateX(-102%);
      visibility: hidden;
      box-shadow: var(--cadle-elevation-3);
      transition:
        transform var(--cadle-motion-standard),
        visibility 0s linear var(--cadle-motion-standard);
    }

    .left-rail[data-mobile-open='true'] {
      transform: translateX(0);
      visibility: visible;
      transition-delay: 0s;
    }

    .mobile-drawer-toggle {
      display: inline-flex;
      flex: 0 0 auto;
    }

    .center-stage-toolbar > span {
      display: none;
    }

    .mobile-drawer-backdrop {
      position: fixed;
      z-index: 12010;
      inset: 0 0 var(--cadle-status-bar, 28px);
      width: auto;
      height: auto;
      padding: 0;
      border: 0;
      background: rgb(0 0 0 / 38%);
      opacity: 0;
      pointer-events: none;
      transition: opacity var(--cadle-motion-standard);
    }

    .mobile-drawer-backdrop[data-open='true'] {
      display: block;
      opacity: 1;
      pointer-events: auto;
    }

    .right-rail {
      position: fixed;
      z-index: 12030;
      inset: auto 0 var(--cadle-status-bar, 28px);
      width: 100%;
      height: min(72dvh, 680px);
      border-radius: var(--cadle-radius-lg) var(--cadle-radius-lg) 0 0;
      transform: translateY(24px);
    }

    .right-rail[data-open='true'] {
      transform: translateY(0);
    }

    .object-action-rail,
    .object-action-rail[data-inspector-open='true'] {
      top: calc(var(--cadle-header-height) + var(--cadle-space-2));
      right: var(--cadle-space-2);
    }

    .object-inspector-header button,
    .object-action-rail button,
    .split-view-toggle {
      width: 40px;
      height: 40px;
    }

    .editor-workspace[data-split='true'] {
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: repeat(2, minmax(0, 1fr));
    }

    .linked-editor-pane {
      border-top: 1px solid var(--md-sys-color-outline-variant);
      border-left: 0;
    }
  }
`

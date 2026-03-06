import { css } from 'lit'

export const objectItemStyles = css`
  :host {
    display: block;
    border-top: 1px solid var(--md-sys-color-outline);
  }

  .item {
    cursor: pointer;
    padding: 12px;
    box-sizing: border-box;
  }

  .dropdown {
    box-sizing: border-box;
    height: 0;
    opacity: 0;
    pointer-events: none;
  }

  :host([active]) .dropdown {
    height: auto;
    opacity: 1;
    pointer-events: auto;
    padding: 6px 12px;
  }

  custom-icon {
    margin-right: 12px;
  }
`

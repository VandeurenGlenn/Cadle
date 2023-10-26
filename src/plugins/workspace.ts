/**
 * parts of this code are based on
 * https://github.com/nihaojob/vue-fabric-editor/blob/main/src/core/plugin/WorkspacePlugin.ts
 */

import { Canvas, Rect, iMatrix, Point, Object } from "fabric";
import type { DrawField } from "../fields/draw.js";

export default class WorkspacePlugin {
  workspace: Rect
  field: DrawField
  canvas
  width: number
  height: number

  init({field, width, height, canvas}) {
    const workspace = new Rect({
      fill: 'rgba(255,255,255,1)',
      width,
      height,
      id: 'workspace',
    });
    this.width = width
    this.height = height
    workspace.set('selectable', false);
    workspace.set('hasControls', false);
    workspace.hoverCursor = 'default';
    canvas.add(workspace);
    canvas.renderAll();

    this.canvas = canvas

    this.workspace = workspace;
    this.field = field
    this.autoZoom();
  }

  setCenterFromObject(obj: fabric.Rect) {
    const { canvas } = this;
    const objCenter = obj.getCenterPoint();
    const viewportTransform = canvas.viewportTransform;
    if (canvas.width === undefined || canvas.height === undefined || !viewportTransform) return;
    viewportTransform[4] = canvas.width / 2 - objCenter.x * viewportTransform[0];
    viewportTransform[5] = canvas.height / 2 - objCenter.y * viewportTransform[3];
    canvas.setViewportTransform(viewportTransform);
    canvas.renderAll();
  }

  setZoomAuto(scale: number, cb?: (left?: number, top?: number) => void) {

    const width = this.field.offsetWidth;
    const height = this.field.offsetHeight;
    this.canvas.setWidth(width);
    this.canvas.setHeight(height);
    const center = this.canvas.getCenter();
    this.canvas.setViewportTransform(iMatrix.concat());
    this.canvas.zoomToPoint(new Point(center.left, center.top), scale);
    if (!this.workspace) return;
    this.setCenterFromObject(this.workspace);

    this.workspace.clone((cloned: Rect) => {
      this.canvas.clipPath = cloned;
      this.canvas.requestRenderAll();
    });
    if (cb) cb(this.workspace.left, this.workspace.top);
  }

  #getScale() {
    const viewPortWidth = this.field.offsetWidth;
    const viewPortHeight = this.field.offsetHeight;
   
    if (viewPortWidth / viewPortHeight < this.width / this.height) {
      return viewPortWidth / this.width;
    }
    return viewPortHeight / this.height;
  }

  autoZoom() {
    const scale = this.#getScale();
    this.setZoomAuto(scale - 0.08);
  }

  #initBackground() {
    this.canvas.backgroundImage = '';
    this.canvas.setWidth(this.field.offsetWidth);
    this.canvas.setHeight(this.field.offsetHeight);
  }

  setSize(width: number, height: number) {
    this.#initBackground();
    this.width = width;
    this.height = height;
    this.workspace.set('width', width);
    this.workspace.set('height', height);
    this.autoZoom();
  }
}